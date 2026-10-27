-- Bake-off support, applied by the admin connection. Candidate-neutral.
-- gems_auth: the role authentication code runs as (before any session exists, so RLS scope cannot apply).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'gems_auth') then
    create role gems_auth login password 'dev_auth_pw' nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
  end if;
end $$;
grant connect on database gems to gems_auth;
grant usage on schema app to gems_auth;
grant select on app.app_user, app.role_assignment to gems_auth;
grant select, insert, update, delete on app.app_session to gems_auth;
grant insert on app.audit_log to gems_auth;
grant usage on sequence app.audit_log_id_seq to gems_auth;

-- Fault injection for T-AUTH-020b: while a row exists here, every audit insert fails.
create table if not exists app.bakeoff_audit_fault (on_since timestamptz not null default now());
grant select on app.bakeoff_audit_fault to gems_auth, gems_app;
create or replace function app.bakeoff_audit_fault_check() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if exists (select 1 from app.bakeoff_audit_fault) then raise exception 'injected audit failure'; end if;
  return new;
end $$;
drop trigger if exists bakeoff_audit_fault on app.audit_log;
create trigger bakeoff_audit_fault before insert on app.audit_log for each row execute function app.bakeoff_audit_fault_check();
