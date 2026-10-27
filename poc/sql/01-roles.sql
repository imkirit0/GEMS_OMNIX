-- Runs once as the bootstrap superuser. Mirrors the production role split (06 §3, C-15).
-- gems_etl (BYPASSRLS) is deliberately absent: this is the production-like environment (T-RLS-015).
create role gems_owner login password 'owner_pw' nosuperuser nocreatedb nocreaterole nobypassrls;
create role gems_app login password 'app_pw' nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
create role gems_job login password 'job_pw' nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
create role gems_report_ro login password 'ro_pw' nosuperuser nocreatedb nocreaterole nobypassrls noinherit;

revoke all on database gems from public;
grant connect on database gems to gems_owner, gems_app, gems_job, gems_report_ro;
grant create on database gems to gems_owner;
revoke all on schema public from public;

create schema app authorization gems_owner;
grant usage on schema app to gems_app, gems_job, gems_report_ro;
