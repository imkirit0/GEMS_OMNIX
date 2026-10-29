-- Centre onboarding (docs/designs/centre-onboarding/centre-onboarding.md, WF3): head office creates and edits centres
-- (DD-1), activates them through a checklist (DD-2) and adds regions and areas (DD-4). An inactive centre cannot trade
-- (DD-3); its centre-only staff already cannot sign in (0004 account_usable). Hand-written; the columns match schema.prisma.

-- ---------- Pre-checks: existing rows must pass the new named checks ----------
do $$ declare bad text; begin
  select string_agg(code, ', ' order by code) into bad from app.centre where not (code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30);
  if bad is not null then raise exception 'centre rows fail centre_code_check: %', bad; end if;
end $$;
do $$ declare bad text; begin
  select string_agg(code, ', ' order by code) into bad from app.region where not (code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30);
  if bad is not null then raise exception 'region rows fail region_code_check: %', bad; end if;
end $$;
do $$ declare bad text; begin
  select string_agg(code, ', ' order by code) into bad from app.region where not (name = btrim(name) and char_length(name) between 1 and 100);
  if bad is not null then raise exception 'region rows fail region_name_check: %', bad; end if;
end $$;
do $$ declare bad text; begin
  select string_agg(id::text, ', ' order by id::text) into bad from app.area where not (name = btrim(name) and char_length(name) between 1 and 100);
  if bad is not null then raise exception 'area rows fail area_name_check: %', bad; end if;
end $$;

-- ---------- Columns ----------
ALTER TABLE "app"."centre" ADD COLUMN "email" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "category" TEXT,
ADD COLUMN "gst_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "gst_supply" TEXT,
ADD COLUMN "gstin" TEXT,
ADD COLUMN "ownership" TEXT,
ADD COLUMN "agreement_from" DATE,
ADD COLUMN "agreement_to" DATE,
ADD COLUMN "opened_on" DATE;

-- ---------- Named checks (mirrored in src/server/centres.ts) ----------
alter table app.centre add constraint centre_code_check check (code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30);
alter table app.centre add constraint centre_email_check check (email ~ '^[^@]*@[^@]*$' and length(email) <= 200);
alter table app.centre add constraint centre_phone_check check (phone ~ '^[0-9]{10}$');
alter table app.centre add constraint centre_category_check check (category in ('SCHOOL', 'COLLEGE'));
alter table app.centre add constraint centre_gst_supply_check check (gst_supply in ('STATE', 'INTERSTATE'));
alter table app.centre add constraint centre_gstin_check check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'); -- PMC
alter table app.centre add constraint centre_ownership_check check (ownership in ('FRANCHISE', 'OWN'));
alter table app.centre add constraint centre_gst_check check (gst_enabled or (gst_supply is null and gstin is null));
alter table app.centre add constraint centre_agreement_check check (agreement_from is null or agreement_to is null or agreement_to >= agreement_from);
do $$
declare
  ws constant text := '[\t\n\v\f\r    -     　﻿]';
  ctl_address constant text := '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]'; -- tab, newline, carriage return allowed
begin
  execute format('alter table app.centre add constraint centre_address_check check (address !~ %L and address !~ %L and address !~ %L and char_length(address) between 1 and 500)',
    '^' || ws, ws || '$', ctl_address);
end $$;
alter table app.region add constraint region_code_check check (code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30);
alter table app.region add constraint region_name_check check (name = btrim(name) and char_length(name) between 1 and 100);
alter table app.area add constraint area_name_check check (name = btrim(name) and char_length(name) between 1 and 100);

-- ---------- RLS on region and area (first time): everyone reads, org.centre.manage (ALL) writes, no delete ----------
do $$
declare t text;
begin
  foreach t in array array['region', 'area'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format('create policy geo_select on app.%I for select using (true)', t);
    execute format('create policy geo_insert on app.%I for insert with check ((select app.has_permission(''org.centre.manage'', null)))', t);
    execute format('create policy geo_update on app.%I for update using ((select app.has_permission(''org.centre.manage'', null))) with check ((select app.has_permission(''org.centre.manage'', null)))', t);
  end loop;
end $$;

-- ---------- Centre policies, beside 0017's setup_update (catalogue.manage); permissive policies are OR-ed ----------
create policy centre_insert on app.centre for insert with check ((select app.has_permission('org.centre.manage', null)));
create policy centre_manage_update on app.centre for update using ((select app.has_permission('org.centre.manage', null)))
  with check ((select app.has_permission('org.centre.manage', null)));

-- Each permission keeps its own columns, in the database (D3): the class needs catalogue.manage, every other column
-- org.centre.manage. Only for the app role; owner and fixture writes are unaffected. Invoker rights (T-RLS-005 unchanged).
create function app.centre_write_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, app
as $$
begin
  if current_user = 'gems_app' then
    if new.centre_class_id is distinct from old.centre_class_id and not app.has_permission('catalogue.manage', null) then
      raise exception 'centre class needs catalogue.manage' using errcode = '42501';
    end if;
    if (to_jsonb(new) - 'centre_class_id') is distinct from (to_jsonb(old) - 'centre_class_id')
       and not app.has_permission('org.centre.manage', null) then
      raise exception 'centre fields need org.centre.manage' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger centre_write_guard before update on app.centre for each row execute function app.centre_write_guard();

-- ---------- Permission; the system administrator holds every permission (0013) ----------
insert into app.permission (key, description, sensitive) values
  ('org.centre.manage', 'Create and edit centres, regions and areas; activate and deactivate centres', true)
on conflict (key) do nothing;
insert into app.role_permission (role_id, permission_key) select id, 'org.centre.manage' from app.role where key = 'system_admin'
on conflict do nothing;

-- ---------- Grants (status and the class are never inserted; codes never change; areas never move) ----------
grant insert (id, code, name, area_id, email, phone, address, category, gst_enabled, gst_supply, gstin, ownership,
  agreement_from, agreement_to, opened_on) on app.centre to gems_app;
grant update (name, area_id, status, email, phone, address, category, gst_enabled, gst_supply, gstin, ownership,
  agreement_from, agreement_to, opened_on) on app.centre to gems_app;
grant insert (code, name), update (name) on app.region to gems_app;
grant insert (region_id, name), update (name) on app.area to gems_app;
grant usage on sequence app.region_id_seq, app.area_id_seq, app.centre_id_seq to gems_app;

-- ---------- Sequences past legacy explicit ids (D7) ----------
select setval('app.region_id_seq', coalesce((select max(id) from app.region), 0) + 1, false);
select setval('app.area_id_seq', coalesce((select max(id) from app.area), 0) + 1, false);
select setval('app.centre_id_seq', coalesce((select max(id) from app.centre), 0) + 1, false);
