-- Local only: give the runtime roles logins before migrations run.
-- Migration 0001 creates the same roles NOLOGIN if they are missing (hosted environments set passwords separately).
create role gems_app login password 'dev_app_pw' nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
create role gems_job login password 'dev_job_pw' nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
create role gems_report_ro login password 'dev_ro_pw' nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
revoke all on database gems from public;
grant connect on database gems to gems_app, gems_job, gems_report_ro;
revoke all on schema public from public;
