-- Person, admission and registration core (docs/designs/person-core/person-core.md, item 4).
-- Generated part (prisma migrate diff at 0010), except the counter rename, which is hand-edited because
-- Prisma would drop and recreate ticket_number_series and lose the counter.

-- ---------- Counter rename: ticket_number_series -> global_number_series (series TICKET) ----------
alter table app.ticket_number_series rename to global_number_series;
alter table app.global_number_series add column series text not null default 'TICKET';
alter table app.global_number_series alter column series drop default;
alter table app.global_number_series drop constraint ticket_number_series_pkey;
alter table app.global_number_series add constraint global_number_series_pkey primary key (series, period);

-- CreateEnum
CREATE TYPE "app"."Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "app"."RegistrationStatus" AS ENUM ('ACTIVE', 'DROP', 'LEAVE', 'TRANSFER');

-- CreateTable
CREATE TABLE "app"."person" (
    "id" UUID NOT NULL,
    "given_name" TEXT NOT NULL,
    "family_name" TEXT,
    "gender" "app"."Gender",
    "date_of_birth" DATE,
    "mobile" TEXT,
    "email" TEXT,
    "match_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."admission" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "centre_id" INTEGER NOT NULL,
    "academic_year" TEXT NOT NULL,
    "admission_no" TEXT NOT NULL,
    "admitted_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."registration" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "centre_id" INTEGER NOT NULL,
    "course_code" TEXT NOT NULL,
    "register_no" TEXT NOT NULL,
    "status" "app"."RegistrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "join_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_match_key_idx" ON "app"."person"("match_key");

-- CreateIndex
CREATE UNIQUE INDEX "admission_admission_no_key" ON "app"."admission"("admission_no");

-- CreateIndex
CREATE INDEX "admission_person_id_idx" ON "app"."admission"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_id_centre_id_key" ON "app"."admission"("id", "centre_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_register_no_key" ON "app"."registration"("register_no");

-- CreateIndex
CREATE INDEX "registration_admission_id_idx" ON "app"."registration"("admission_id");

-- AddForeignKey
ALTER TABLE "app"."admission" ADD CONSTRAINT "admission_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "app"."person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."admission" ADD CONSTRAINT "admission_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "app"."centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."registration" ADD CONSTRAINT "registration_admission_id_centre_id_fkey" FOREIGN KEY ("admission_id", "centre_id") REFERENCES "app"."admission"("id", "centre_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."registration" ADD CONSTRAINT "registration_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "app"."centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Hand-written part ----------

-- Duplicate-check key (G2). Name part: the words of given and family name, lower-cased, letters plus Indic
-- combining marks only, sorted, so order and a missing family name do not matter. Date as yyyymmdd by
-- arithmetic (to_char is not immutable). Null on partial data, so no match is claimed.
create function app.person_match_key(given text, family text, dob date, mobile text) returns text
language sql immutable
set search_path = pg_catalog
as $$
  select case
    when name = '' or dob is null or mobile is null or mobile !~ '^\d{10}$' then null
    else name || '|' || (extract(year from dob) * 10000 + extract(month from dob) * 100 + extract(day from dob))::int::text
      || '|' || mobile
  end
  from (select array_to_string(array(
    select w from regexp_split_to_table(lower(coalesce(given, '') || ' ' || coalesce(family, '')),
      '[^[:alpha:]\u0300-\u036f\u0900-\u0dff]+') w
    where w <> '' order by w), ' ') as name) n
$$;

create function app.person_set_match_key() returns trigger
language plpgsql
set search_path = pg_catalog, app
as $$
begin
  new.match_key := app.person_match_key(new.given_name, new.family_name, new.date_of_birth, new.mobile);
  return new;
end $$;

create trigger person_match_key before insert or update of given_name, family_name, date_of_birth, mobile
  on app.person for each row execute function app.person_set_match_key();

-- Academic year YYYY-YY with consecutive years; the case keeps a malformed value away from the casts.
alter table app.admission add constraint admission_academic_year_check check (
  case when academic_year ~ '^\d{4}-\d{2}$'
    then right(academic_year, 2)::int = (left(academic_year, 4)::int + 1) % 100
    else false end);

-- ---------- Row-level security ----------
-- admission, registration: the 0002 loop by centre_id.
do $$
declare t text;
begin
  foreach t in array array['admission', 'registration'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format('create policy scope_select on app.%I for select using (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
    execute format('create policy scope_insert on app.%I for insert with check (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
    execute format('create policy scope_update on app.%I for update using (centre_id = any ((select app.visible_centre_ids())::int[])) with check (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
    execute format('create policy scope_delete on app.%I for delete using (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
  end loop;
end $$;

-- person has no centre_id: visible through an admission the caller can see (admission's own policy limits
-- the subquery to the caller's centres). Insert needs student.admit somewhere; no delete policy.
alter table app.person enable row level security;
alter table app.person force row level security;
create policy scope_select on app.person for select
  using (exists (select 1 from app.admission a where a.person_id = person.id));
create policy scope_update on app.person for update
  using (exists (select 1 from app.admission a where a.person_id = person.id))
  with check (exists (select 1 from app.admission a where a.person_id = person.id));
create policy scope_insert on app.person for insert
  with check ((select cardinality(app.scoped_centre_ids('student.admit')) > 0));

-- ---------- Permissions (sensitive = false: no step-up; PMC under D-SEC-4) ----------
insert into app.permission (key, description, sensitive) values
  ('student.view', 'View learners admitted at a centre in your scope', false),
  ('student.admit', 'Admit learners at a centre', false)
on conflict (key) do nothing;

-- ---------- Grants (deny by default) ----------
-- global_number_series keeps the grants of the renamed table. Identity columns of person are the only
-- updatable ones; by convention only changeIdentity writes them. No seed for REGISTER or ADMISSION:
-- the cutover script seeds them (DD-2, DD-7).
grant select, insert on app.person, app.admission, app.registration to gems_app;
grant update (given_name, family_name, gender, date_of_birth, mobile, email) on app.person to gems_app;
