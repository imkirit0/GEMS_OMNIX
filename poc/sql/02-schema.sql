-- POC schema for P2 (RLS) and P3 (numbering). Owned by gems_owner; FORCE RLS makes the owner subject too.
set role gems_owner;
set search_path = app;

create table region (id int primary key, code text not null unique);
create table centre (id int primary key, code text not null unique, region_id int not null references region);
create table app_user (id int primary key, login text not null unique);

-- Not a tenant table: never granted to app roles, read only by the definer functions below.
create table user_scope (
  user_id int not null references app_user,
  kind text not null check (kind in ('ALL', 'REGION', 'CENTRE')),
  region_id int references region,
  scope_centre_id int references centre,
  check ((kind = 'ALL' and region_id is null and scope_centre_id is null)
      or (kind = 'REGION' and region_id is not null and scope_centre_id is null)
      or (kind = 'CENTRE' and scope_centre_id is not null and region_id is null))
);

-- Opaque session token; only its hash is stored.
create table app_session (
  token_hash bytea primary key,
  user_id int not null references app_user,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

-- The single scope source. Fails closed: no/blank/unknown/expired/revoked session => empty array.
create function visible_centre_ids() returns int[]
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select coalesce(array_agg(distinct c.id), '{}')
  from app_session s
  join user_scope us on us.user_id = s.user_id
  join centre c on us.kind = 'ALL'
    or (us.kind = 'REGION' and c.region_id = us.region_id)
    or (us.kind = 'CENTRE' and c.id = us.scope_centre_id)
  where s.token_hash = sha256(convert_to(nullif(current_setting('app.session_id', true), ''), 'UTF8'))
    and s.revoked_at is null
    and s.expires_at > now()
$$;

create function session_is_valid() returns boolean
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select exists (
    select 1 from app_session s
    where s.token_hash = sha256(convert_to(nullif(current_setting('app.session_id', true), ''), 'UTF8'))
      and s.revoked_at is null
      and s.expires_at > now())
$$;

revoke all on function visible_centre_ids(), session_is_valid() from public;

-- Tenant tables
create table student (
  id bigint generated always as identity primary key,
  centre_id int not null references centre,
  name text not null,
  unique (centre_id, id)
);

-- C-02.2: one row per (series key, period); allocation = UPDATE ... RETURNING inside the business tx.
create table number_series (
  centre_id int not null references centre,
  doc_type text not null,
  period text not null,
  gap_rule text not null check (gap_rule in ('GAPLESS', 'UNIQUE')),
  current bigint not null check (current >= 0),
  primary key (centre_id, doc_type, period)
);

create table receipt (
  id bigint generated always as identity primary key,
  centre_id int not null,
  student_id bigint not null,
  doc_type text not null,
  period text not null,
  number bigint not null,
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED')),
  idempotency_key text not null unique,
  unique (centre_id, doc_type, period, number),
  -- composite FK: RI checks bypass RLS, so a plain student_id FK would let centre A reference a B student
  foreign key (centre_id, student_id) references student (centre_id, id)
);

-- Pre-aggregated table (RLS-protected) vs materialized view (no RLS possible), see T-RLS-004.
create table centre_daily_total (
  centre_id int not null references centre,
  day date not null,
  amount_paise bigint not null,
  primary key (centre_id, day)
);
create materialized view centre_total_mv as
  select centre_id, sum(amount_paise) as amount_paise from receipt group by centre_id;

create view v_student with (security_invoker = true) as
  select id, centre_id, name from student;

-- Append-only audit. Not a tenant table (target_centre_id), insert-only for app roles.
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  session_hash bytea,
  action text not null,
  outcome text not null check (outcome in ('OK', 'DENIED')),
  target_centre_id int,
  detail jsonb not null default '{}'
);
create function audit_immutable() returns trigger
language plpgsql set search_path = pg_catalog
as $$ begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_no_update_delete before update or delete on audit_log
  for each row execute function audit_immutable();
create trigger audit_no_truncate before truncate on audit_log
  for each statement execute function audit_immutable();

-- RLS: one policy per command on every table with centre_id (T-RLS-002).
do $$
declare t text;
begin
  foreach t in array array['student', 'number_series', 'receipt', 'centre_daily_total'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy scope_select on %I for select using (centre_id = any ((select visible_centre_ids())::int[]))', t);
    execute format('create policy scope_insert on %I for insert with check (centre_id = any ((select visible_centre_ids())::int[]))', t);
    execute format('create policy scope_update on %I for update using (centre_id = any ((select visible_centre_ids())::int[])) with check (centre_id = any ((select visible_centre_ids())::int[]))', t);
    execute format('create policy scope_delete on %I for delete using (centre_id = any ((select visible_centre_ids())::int[]))', t);
  end loop;
end $$;

create index on student (centre_id, id);

-- Grants. Nothing on user_scope, app_session, centre_total_mv for app roles.
grant select on region, centre to gems_app, gems_job, gems_report_ro;
grant select, insert, update, delete on student to gems_app, gems_job;
grant select, update on number_series to gems_app, gems_job;
grant select, insert, update on receipt to gems_app, gems_job;
grant select on centre_daily_total, v_student to gems_app, gems_job;
grant select on student, receipt, number_series, centre_daily_total, v_student to gems_report_ro;
grant insert on audit_log to gems_app, gems_job;
grant execute on function visible_centre_ids(), session_is_valid() to gems_app, gems_job, gems_report_ro;
