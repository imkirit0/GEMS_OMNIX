-- Test-only (T-AUTH-020): applied by the admin connection, never by migrations.
-- Fault injection for T-AUTH-020b: while a row exists here, every audit insert fails.
create table if not exists app.bakeoff_audit_fault (on_since timestamptz not null default now());
-- public: the trigger stays installed after the auth suite, so every role that writes audit rows
-- (gems_app, gems_auth, gems_etl, gems_job) must be able to read the (normally empty) flag table
grant select on app.bakeoff_audit_fault to public;
create or replace function app.bakeoff_audit_fault_check() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if exists (select 1 from app.bakeoff_audit_fault) then raise exception 'injected audit failure'; end if;
  return new;
end $$;
drop trigger if exists bakeoff_audit_fault on app.audit_log;
create trigger bakeoff_audit_fault before insert on app.audit_log for each row execute function app.bakeoff_audit_fault_check();
