-- Catalogue skeleton (docs/designs/catalogue-skeleton/catalogue-skeleton.md): five identity-only tables (DD-1),
-- links from centre, admission and registration, RLS, named checks, grants and the catalogue.manage permission.

-- centre.centre_class is read by no code; refuse to drop it if it ever holds values.
do $$ begin
  if exists (select 1 from app.centre where centre_class is not null) then
    raise exception 'centre.centre_class holds values; migrate them before 0012';
  end if;
end $$;

-- AlterTable
ALTER TABLE "app"."centre" DROP COLUMN "centre_class",
ADD COLUMN     "centre_class_id" INTEGER;

-- CreateTable
CREATE TABLE "app"."course_category" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."course_division" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."centre_class" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "centre_class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."course" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "division_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."academic_year" (
    "code" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "open" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_year_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_category_code_key" ON "app"."course_category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "course_division_code_key" ON "app"."course_division"("code");

-- CreateIndex
CREATE UNIQUE INDEX "centre_class_code_key" ON "app"."centre_class"("code");

-- CreateIndex
CREATE UNIQUE INDEX "course_code_key" ON "app"."course"("code");

-- AddForeignKey
ALTER TABLE "app"."centre" ADD CONSTRAINT "centre_centre_class_id_fkey" FOREIGN KEY ("centre_class_id") REFERENCES "app"."centre_class"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "app"."admission" ADD CONSTRAINT "admission_academic_year_fkey" FOREIGN KEY ("academic_year") REFERENCES "app"."academic_year"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "app"."registration" ADD CONSTRAINT "registration_course_code_fkey" FOREIGN KEY ("course_code") REFERENCES "app"."course"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "app"."course" ADD CONSTRAINT "course_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "app"."course_category"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "app"."course" ADD CONSTRAINT "course_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "app"."course_division"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------- Named checks (normCode() in src/server/people.ts mirrors the code check; DD-8) ----------
alter table app.course_category add constraint course_category_code_check
  check (code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30);
alter table app.course_division add constraint course_division_code_check
  check (code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30);
alter table app.centre_class add constraint centre_class_code_check
  check (code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30);
alter table app.course add constraint course_code_check
  check (code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30);
alter table app.course_category add constraint course_category_name_check check (name = btrim(name) and name <> '');
alter table app.course_division add constraint course_division_name_check check (name = btrim(name) and name <> '');
alter table app.centre_class add constraint centre_class_name_check check (name = btrim(name) and name <> '');
alter table app.course add constraint course_name_check check (name = btrim(name) and name <> '');
alter table app.academic_year add constraint academic_year_code_check check (
  case when code ~ '^\d{4}-\d{2}$' then right(code, 2)::int = (left(code, 4)::int + 1) % 100 else false end);
alter table app.academic_year add constraint academic_year_dates_check check (ends_on > starts_on);

-- ---------- RLS: setup-table policy (0009); no delete policy, rows are deactivated ----------
do $$
declare t text;
begin
  foreach t in array array['course_category', 'course_division', 'centre_class', 'course', 'academic_year'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format('create policy setup_select on app.%I for select using (true)', t);
    execute format('create policy setup_insert on app.%I for insert with check ((select app.has_permission(''catalogue.manage'', null)))', t);
    execute format('create policy setup_update on app.%I for update using ((select app.has_permission(''catalogue.manage'', null))) with check ((select app.has_permission(''catalogue.manage'', null)))', t);
  end loop;
end $$;

-- ---------- Permission; first holder is the system administrator (DD-12) ----------
insert into app.permission (key, description, sensitive) values
  ('catalogue.manage', 'Maintain the catalogue: courses, masters, academic years', true)
on conflict (key) do nothing;
insert into app.role_permission (role_id, permission_key)
  select id, 'catalogue.manage' from app.role where key = 'system_admin'
on conflict do nothing;

-- ---------- Grants (deny by default; codes are never updated) ----------
grant select, insert on app.course_category, app.course_division, app.centre_class, app.course, app.academic_year to gems_app;
grant update (name, active) on app.course_category, app.course_division, app.centre_class to gems_app;
grant update (name, category_id, division_id, active) on app.course to gems_app;
grant update (starts_on, ends_on, open) on app.academic_year to gems_app;
grant usage on sequence app.course_category_id_seq, app.course_division_id_seq, app.centre_class_id_seq,
  app.course_id_seq to gems_app;
