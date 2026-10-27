-- User and role administration (WF-X13; FR-009/093/228; audit 06 §3 "RBAC admin"; T-AUTH-010, T-E2E-X13).
-- Every write is a SECURITY DEFINER function that re-checks the actor's permission and the no-over-grant rule
-- in the database, so the app-level authorize() and the DB are two independent gates.

-- Generated part (prisma migrate diff)
ALTER TABLE "app"."permission" ADD COLUMN "sensitive" BOOLEAN NOT NULL DEFAULT false;

-- ---------- Hand-written ----------

-- Logins are stored lowercase, so lookups by lower(login) can never match two accounts.
update app.app_user set login = lower(login) where login <> lower(login);
alter table app.app_user add constraint app_user_login_lowercase check (login = lower(login));

-- Permission catalogue for administration. The business role matrix itself is D-SEC-1 (PMC) and is data, not code.
insert into app.permission (key, description, sensitive) values
  ('rbac.view', 'View users, roles and assignments', false),
  ('rbac.user.manage', 'Create and disable users, assign and remove roles, issue set-up links', true),
  ('rbac.role.manage', 'Create roles and change their permissions', true)
on conflict (key) do update set sensitive = excluded.sensitive;

create function app.require_permission(p_permission text) returns void
language plpgsql stable security definer set search_path = pg_catalog, app
as $$
begin
  if not app.has_permission(p_permission, null) then
    raise exception 'permission % denied', p_permission using errcode = '42501';
  end if;
end $$;

-- Was the current session re-authenticated within p_seconds? (T-AUTH-015 for RBAC changes)
create function app.session_step_up_fresh(p_seconds int) returns boolean
language sql stable security definer set search_path = pg_catalog, app
as $$
  select exists (
    select 1 from app.app_session s
    where s.token_hash = sha256(convert_to(nullif(current_setting('app.session_id', true), ''), 'UTF8'))
      and s.revoked_at is null and s.step_up_at > now() - make_interval(secs => p_seconds))
$$;

-- Centres a target scope covers.
create function app.target_centre_ids(p_kind app."ScopeKind", p_region int, p_area int, p_centre int) returns int[]
language sql stable security definer set search_path = pg_catalog, app
as $$
  select coalesce(array_agg(c.id), '{}')
  from app.centre c join app.area a on a.id = c.area_id
  where p_kind = 'ALL' or (p_kind = 'REGION' and a.region_id = p_region)
     or (p_kind = 'AREA' and c.area_id = p_area) or (p_kind = 'CENTRE' and c.id = p_centre)
$$;

-- No over-grant: the actor must hold the permission over every centre the target scope covers;
-- an ALL-scope grant needs the permission network-wide.
create function app.can_grant_permission(p_permission text, p_kind app."ScopeKind", p_region int, p_area int, p_centre int) returns boolean
language sql stable security definer set search_path = pg_catalog, app
as $$
  select case when p_kind = 'ALL' then app.has_permission(p_permission, null)
              else app.target_centre_ids(p_kind, p_region, p_area, p_centre) <@ app.scoped_centre_ids(p_permission) end
$$;

-- Internal helpers (not granted to any app role)
create function app.revoke_user_sessions_internal(p_user uuid) returns void
language sql security definer set search_path = pg_catalog, app
as $$ update app.app_session set revoked_at = now() where user_id = p_user and revoked_at is null $$;

-- TOTP is mandatory for any scope wider than one centre, or any sensitive permission (06 §3 "HO 2FA").
create function app.recompute_requires_totp(p_user uuid) returns void
language sql security definer set search_path = pg_catalog, app
as $$
  update app.app_user u set requires_totp = exists (
    select 1 from app.role_assignment ra
    where ra.user_id = u.id and (ra.scope_kind <> 'CENTRE' or exists (
      select 1 from app.role_permission rp join app.permission p on p.key = rp.permission_key
      where rp.role_id = ra.role_id and p.sensitive)))
  where u.id = p_user
$$;

create function app.assert_can_grant_role(p_role int, p_kind app."ScopeKind", p_region int, p_area int, p_centre int) returns void
language plpgsql stable security definer set search_path = pg_catalog, app
as $$
declare missing text;
begin
  select string_agg(rp.permission_key, ', ' order by rp.permission_key) into missing
  from app.role_permission rp
  where rp.role_id = p_role and not app.can_grant_permission(rp.permission_key, p_kind, p_region, p_area, p_centre);
  if missing is not null then
    raise exception 'cannot grant beyond your own permissions: %', missing using errcode = '42501';
  end if;
end $$;

-- ---------- Administration API (granted to gems_app) ----------

create function app.rbac_create_user(p_login text, p_display_name text) returns uuid
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare v_id uuid;
begin
  perform app.require_permission('rbac.user.manage');
  insert into app.app_user (id, login, display_name, status) values (gen_random_uuid(), lower(trim(p_login)), trim(p_display_name), 'ACTIVE')
  returning id into v_id;
  return v_id;
end $$;

create function app.rbac_set_user_status(p_user uuid, p_status app."UserStatus") returns void
language plpgsql security definer set search_path = pg_catalog, app
as $$
begin
  perform app.require_permission('rbac.user.manage');
  if p_user = app.session_user_id() and p_status = 'DISABLED' then
    raise exception 'you cannot disable your own account' using errcode = '42501';
  end if;
  update app.app_user set status = p_status where id = p_user;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  if p_status = 'DISABLED' then perform app.revoke_user_sessions_internal(p_user); end if;
end $$;

create function app.rbac_assign(p_user uuid, p_role int, p_kind app."ScopeKind", p_region int, p_area int, p_centre int) returns int
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare v_id int;
begin
  perform app.require_permission('rbac.user.manage');
  perform app.assert_can_grant_role(p_role, p_kind, p_region, p_area, p_centre);
  insert into app.role_assignment (user_id, role_id, scope_kind, region_id, area_id, scope_centre_id)
  values (p_user, p_role, p_kind, p_region, p_area, p_centre) returning id into v_id;
  perform app.revoke_user_sessions_internal(p_user); -- new scope applies on the next sign-in (T-AUTH-010)
  perform app.recompute_requires_totp(p_user);
  return v_id;
end $$;

create function app.rbac_unassign(p_assignment int) returns uuid
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare a app.role_assignment;
begin
  perform app.require_permission('rbac.user.manage');
  select * into a from app.role_assignment where id = p_assignment;
  if not found then raise exception 'assignment not found' using errcode = 'P0002'; end if;
  -- symmetric rule: you may only remove what you could have granted
  perform app.assert_can_grant_role(a.role_id, a.scope_kind, a.region_id, a.area_id, a.scope_centre_id);
  delete from app.role_assignment where id = p_assignment;
  perform app.revoke_user_sessions_internal(a.user_id);
  perform app.recompute_requires_totp(a.user_id);
  return a.user_id;
end $$;

create function app.rbac_create_role(p_key text, p_name text) returns int
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare v_id int;
begin
  perform app.require_permission('rbac.role.manage');
  insert into app.role (key, name) values (lower(trim(p_key)), trim(p_name)) returning id into v_id;
  return v_id;
end $$;

-- Replace a role's permission set. You can only add or remove permissions you hold network-wide.
-- Every holder of the role is signed out and their TOTP requirement recomputed.
create function app.rbac_set_role_permissions(p_role int, p_permissions text[]) returns void
language plpgsql security definer set search_path = pg_catalog, app
as $$
declare changed text; u uuid;
begin
  perform app.require_permission('rbac.role.manage');
  if not exists (select 1 from app.role where id = p_role) then raise exception 'role not found' using errcode = 'P0002'; end if;
  select string_agg(k, ', ' order by k) into changed from (
    (select unnest(p_permissions) except select permission_key from app.role_permission where role_id = p_role)
    union
    (select permission_key from app.role_permission where role_id = p_role except select unnest(p_permissions))
  ) d(k) where not app.has_permission(k, null);
  if changed is not null then
    raise exception 'cannot change permissions you do not hold network-wide: %', changed using errcode = '42501';
  end if;
  delete from app.role_permission where role_id = p_role and permission_key <> all (p_permissions);
  insert into app.role_permission (role_id, permission_key) select p_role, k from unnest(p_permissions) k on conflict do nothing;
  for u in select distinct user_id from app.role_assignment where role_id = p_role loop
    perform app.revoke_user_sessions_internal(u);
    perform app.recompute_requires_totp(u);
  end loop;
end $$;

-- One-time set-up link for a new user (PR-12: credentials are never e-mailed or shown in plaintext).
create function app.rbac_issue_setup_token(p_user uuid, p_token_hash bytea, p_hours int) returns void
language plpgsql security definer set search_path = pg_catalog, app
as $$
begin
  perform app.require_permission('rbac.user.manage');
  if not exists (select 1 from app.app_user where id = p_user and status = 'ACTIVE') then
    raise exception 'user not found or disabled' using errcode = 'P0002';
  end if;
  insert into app.auth_reset (token_hash, user_id, expires_at) values (p_token_hash, p_user, now() + make_interval(hours => p_hours));
end $$;

revoke all on function app.require_permission(text), app.session_step_up_fresh(int),
  app.target_centre_ids(app."ScopeKind", int, int, int), app.can_grant_permission(text, app."ScopeKind", int, int, int),
  app.revoke_user_sessions_internal(uuid), app.recompute_requires_totp(uuid),
  app.assert_can_grant_role(int, app."ScopeKind", int, int, int),
  app.rbac_create_user(text, text), app.rbac_set_user_status(uuid, app."UserStatus"),
  app.rbac_assign(uuid, int, app."ScopeKind", int, int, int), app.rbac_unassign(int),
  app.rbac_create_role(text, text), app.rbac_set_role_permissions(int, text[]),
  app.rbac_issue_setup_token(uuid, bytea, int) from public;
grant execute on function app.session_step_up_fresh(int), app.can_grant_permission(text, app."ScopeKind", int, int, int),
  app.rbac_create_user(text, text), app.rbac_set_user_status(uuid, app."UserStatus"),
  app.rbac_assign(uuid, int, app."ScopeKind", int, int, int), app.rbac_unassign(int),
  app.rbac_create_role(text, text), app.rbac_set_role_permissions(int, text[]),
  app.rbac_issue_setup_token(uuid, bytea, int) to gems_app;

-- ---------- Reads for the admin screens ----------
-- gems_app may read user identity columns (never hashes or TOTP secrets) and assignments,
-- and RLS limits that to holders of rbac.view (or the user's own row).
grant select (id, login, display_name, status, created_at, requires_totp) on app.app_user to gems_app;
grant select on app.role_assignment to gems_app;
alter table app.app_user enable row level security;
alter table app.role_assignment enable row level security;
create policy rbac_read on app.app_user for select to gems_app
  using (app.has_permission('rbac.view', null) or id = app.session_user_id());
create policy rbac_read on app.role_assignment for select to gems_app
  using (app.has_permission('rbac.view', null) or user_id = app.session_user_id());
-- the authentication role keeps its existing access (it runs before any session exists)
create policy auth_all on app.app_user for all to gems_auth using (true) with check (true);
