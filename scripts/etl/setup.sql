-- Migration framework: raw and migration schemas (docs/designs/migration-framework/migration-framework.md).
-- Runs once, as the schema owner, on a fresh database in a migration environment, after the gems_etl role exists
-- (scripts/etl/setup.mjs creates it). Never a Prisma migration: production never gets gems_etl after go-live.

create schema raw;
create schema migration;

-- The P8 source contract (synthetic, INF). Stage 0 replaces these with the real legacy shape in a new setup version.
create table raw.legacy_centre (source_key text primary key, code text, name text, status text);
create table raw.legacy_admission (source_key text primary key, centre_code text, admission_no text,
  academic_year text, admitted_on text, first_name text, last_name text, dob text, mobile text);
create table raw.legacy_course_row (source_key text primary key, admission_key text, course_code text,
  register_no text, join_date text, status text);

create table migration.run (
  run_id uuid primary key, mode text not null check (mode in ('dry', 'cutover')), source text not null,
  as_of date not null, input_hash text not null, lc_ctype text not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'PASSED', 'FAILED')), digest text);

create table migration.rule (
  rule_id text not null, version int not null, source_table text not null, entity_list text[] not null,
  description text not null, owner text not null, dispositions text[] not null, code_hash text not null,
  approved_by text, approved_at timestamptz,
  primary key (rule_id, version),
  check ((approved_by is null) = (approved_at is null)));

create table migration.key_map (
  id bigint generated always as identity primary key,
  run_id uuid not null references migration.run, entity text not null,
  source_system text not null, source_table text not null, source_key text not null, source_row_hash text not null,
  disposition text not null check (disposition in ('IMPORTED', 'MERGED', 'SPLIT', 'EXCLUDED', 'REJECTED')), -- ARCHIVED: DD-8
  rule_id text not null, rule_version int not null, target_table text, target_id text, survivor_target_id text,
  reason text, approved_by text, approved_at timestamptz,
  foreign key (rule_id, rule_version) references migration.rule);
-- one disposition per key and entity; only SPLIT may have more than one row (a mixed SPLIT key fails K2)
create unique index key_map_one_row on migration.key_map (run_id, entity, source_system, source_table, source_key)
  where disposition <> 'SPLIT';

create table migration.exception (
  id bigint generated always as identity primary key, run_id uuid not null references migration.run,
  entity text not null, source_system text not null, source_table text not null, source_key text not null,
  rule_id text not null, field text not null, value_fingerprint text, message text not null);

create table migration.reconciliation (
  id bigint generated always as identity primary key, run_id uuid not null references migration.run,
  "check" text not null check ("check" ~ '^K([1-9]|1[01])$'), scope jsonb not null default '{}',
  expected bigint, actual bigint, passed boolean, detail jsonb not null default '{}');

-- ---------- Lock-down (mirrors 0002 for app) ----------
revoke all on schema raw, migration from public;
revoke all on all tables in schema raw, migration from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema raw, migration from %I', r);
      execute format('revoke all on all tables in schema raw, migration from %I', r);
    end if;
  end loop;
end $$;

-- ---------- gems_etl: privileges only, owns nothing ----------
grant usage on schema raw, migration, app to gems_etl;
grant select, insert on raw.legacy_centre, raw.legacy_admission, raw.legacy_course_row,
  migration.exception, migration.reconciliation to gems_etl;
grant select, insert on migration.run to gems_etl;
grant update (finished_at, status, digest) on migration.run to gems_etl;
-- can register a mapping rule, never approve or change one
grant select on migration.rule to gems_etl;
grant insert (rule_id, version, source_table, entity_list, description, owner, dispositions, code_hash)
  on migration.rule to gems_etl;
grant select on migration.key_map to gems_etl;
grant insert (run_id, entity, source_system, source_table, source_key, source_row_hash, disposition, rule_id,
  rule_version, target_table, target_id, survivor_target_id, reason) on migration.key_map to gems_etl;
grant select on app.centre to gems_etl;
grant select on app.course, app.academic_year to gems_etl; -- catalogue skeleton: existence checks (DD-11)
grant select, insert on app.person, app.admission, app.registration, app.global_number_series to gems_etl;
grant insert on app.audit_log to gems_etl;
grant usage on sequence app.audit_log_id_seq to gems_etl;
grant execute on function app.person_match_key(text, text, date, text), app.redact(jsonb) to gems_etl;
