-- Security layer (audit 06 §3; proven in poc/ P2, E-008/E-010; findings v1.3 C-18/C-19, v1.4 C-25).
-- Runs as the migration owner. The runtime roles are never owners and never BYPASSRLS.

-- Runtime roles. Hosted environments give them LOGIN + password out of band (never in a migration).
do $$
declare r text;
begin
  foreach r in array array['gems_app', 'gems_job', 'gems_report_ro'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin nosuperuser nocreatedb nocreaterole nobypassrls noinherit', r);
    end if;
  end loop;
end $$;

revoke all on schema app from public;
grant usage on schema app to gems_app, gems_job, gems_report_ro;
-- Supabase API roles must never reach app data (C-15). They do not exist locally.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema app from %I', r);
      execute format('revoke all on all tables in schema app from %I', r);
    end if;
  end loop;
end $$;

-- Scope shape: exactly the column the kind needs.
alter table app.role_assignment add constraint role_assignment_scope_shape check (
     (scope_kind = 'ALL'    and region_id is null     and area_id is null     and scope_centre_id is null)
  or (scope_kind = 'REGION' and region_id is not null and area_id is null     and scope_centre_id is null)
  or (scope_kind = 'AREA'   and area_id is not null   and region_id is null   and scope_centre_id is null)
  or (scope_kind = 'CENTRE' and scope_centre_id is not null and region_id is null and area_id is null));

-- ---------- Scope functions: the single source of "who is this transaction acting for" ----------
-- They are SECURITY DEFINER and read app.centre, which itself has RLS calling them. That does not recurse
-- only because the owner (migration role) bypasses RLS: superuser locally, BYPASSRLS `postgres` on Supabase.
-- T-RLS-005 in tests/ asserts this precondition.
-- Fail closed: no, blank, unknown, expired or revoked session, or disabled user => nothing.

create function app.session_user_id() returns uuid
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select s.user_id
  from app.app_session s
  join app.app_user u on u.id = s.user_id and u.status = 'ACTIVE'
  where s.token_hash = sha256(convert_to(nullif(current_setting('app.session_id', true), ''), 'UTF8'))
    and s.revoked_at is null
    and s.expires_at > now()
$$;

-- Centres covered by any of the user's assignments, optionally limited to assignments granting p_permission.
create function app.scoped_centre_ids(p_permission text default null) returns int[]
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select coalesce(array_agg(distinct c.id), '{}')
  from app.role_assignment ra
  cross join app.centre c
  join app.area a on a.id = c.area_id
  where ra.user_id = app.session_user_id()
    and (p_permission is null or exists (
          select 1 from app.role_permission rp
          where rp.role_id = ra.role_id and rp.permission_key = p_permission))
    and (ra.scope_kind = 'ALL'
      or (ra.scope_kind = 'REGION' and a.region_id = ra.region_id)
      or (ra.scope_kind = 'AREA' and c.area_id = ra.area_id)
      or (ra.scope_kind = 'CENTRE' and c.id = ra.scope_centre_id))
$$;

create function app.visible_centre_ids() returns int[]
language sql stable security definer
set search_path = pg_catalog, app
as $$ select app.scoped_centre_ids(null) $$;

-- Permission check. With a centre: the permission must be held over a scope covering it.
-- Without a centre (network-wide actions such as RBAC): only an ALL-scope assignment counts.
create function app.has_permission(p_permission text, p_centre_id int default null) returns boolean
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select case
    when p_centre_id is null then exists (
      select 1 from app.role_assignment ra
      join app.role_permission rp on rp.role_id = ra.role_id and rp.permission_key = p_permission
      where ra.user_id = app.session_user_id() and ra.scope_kind = 'ALL')
    else p_centre_id = any (app.scoped_centre_ids(p_permission))
  end
$$;

revoke all on function app.session_user_id(), app.scoped_centre_ids(text), app.visible_centre_ids(),
  app.has_permission(text, int) from public;
grant execute on function app.session_user_id(), app.visible_centre_ids(), app.has_permission(text, int)
  to gems_app, gems_job, gems_report_ro;

-- ---------- Row-level security ----------
-- centre: rows are the centres themselves (key = id).
alter table app.centre enable row level security;
alter table app.centre force row level security;
create policy scope_select on app.centre for select using (id = any ((select app.visible_centre_ids())::int[]));

-- Every table with centre_id: ENABLE + FORCE + a policy per command (T-RLS-002).
do $$
declare t text;
begin
  foreach t in array array['number_series'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format('create policy scope_select on app.%I for select using (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
    execute format('create policy scope_insert on app.%I for insert with check (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
    execute format('create policy scope_update on app.%I for update using (centre_id = any ((select app.visible_centre_ids())::int[])) with check (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
    execute format('create policy scope_delete on app.%I for delete using (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
  end loop;
end $$;

-- ---------- Append-only audit ----------
create function app.audit_immutable() returns trigger
language plpgsql set search_path = pg_catalog
as $$ begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_no_update_delete before update or delete on app.audit_log
  for each row execute function app.audit_immutable();
create trigger audit_no_truncate before truncate on app.audit_log
  for each statement execute function app.audit_immutable();

-- ---------- Grants (deny by default; only what foundation code needs) ----------
grant select on app.region, app.area, app.centre, app.role, app.permission, app.role_permission
  to gems_app, gems_job, gems_report_ro;
grant select, update on app.number_series to gems_app, gems_job;
grant select on app.number_series to gems_report_ro;
grant insert on app.audit_log to gems_app, gems_job;
grant usage on sequence app.audit_log_id_seq to gems_app, gems_job;
-- app_user, role_assignment and app_session are read only through the definer functions above.
