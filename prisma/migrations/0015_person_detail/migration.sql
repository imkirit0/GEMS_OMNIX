-- Learner contact and family details (docs/designs/learner-details/learner-details.md): one row per person at most.
-- Identity stays on person (changeIdentity only); details are written by admit() and updateDetails().

-- CreateTable
CREATE TABLE "app"."person_detail" (
    "person_id" UUID NOT NULL,
    "current_address" TEXT,
    "current_place" TEXT,
    "current_pincode" TEXT,
    "permanent_address" TEXT,
    "permanent_place" TEXT,
    "permanent_pincode" TEXT,
    "blood_group" TEXT,
    "employment_status" TEXT,
    "qualification" TEXT,
    "father_name" TEXT,
    "father_occupation" TEXT,
    "father_phone" TEXT,
    "mother_name" TEXT,
    "mother_occupation" TEXT,
    "mother_phone" TEXT,
    "guardian_name" TEXT,
    "guardian_relation" TEXT,
    "guardian_phone" TEXT,
    "guardian_occupation" TEXT,
    "nationality" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "person_detail_pkey" PRIMARY KEY ("person_id")
);

-- AddForeignKey
ALTER TABLE "app"."person_detail" ADD CONSTRAINT "person_detail_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "app"."person"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------- Named checks, mirrored by detailField() in src/server/details.ts ----------
-- The whitespace class is the set JS trim() removes, written out: Postgres \s depends on the database locale.
-- No regex flag: AREs already match newlines with "." and anchor ^ and $ at the ends of the string.
do $$
declare
  ws constant text := '[\t\n\v\f\r    -     　﻿]';
  ctl constant text := '[\u0001-\u001f\u007f]';
  ctl_address constant text := '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]'; -- tab, newline, carriage return allowed
  c text; n int;
begin
  for c, n in select * from (values ('current_address', 500), ('permanent_address', 500), ('current_place', 100),
      ('permanent_place', 100), ('father_name', 100), ('mother_name', 100), ('guardian_name', 100), ('father_occupation', 100),
      ('mother_occupation', 100), ('guardian_occupation', 100), ('guardian_relation', 50)) v(c, n) loop
    execute format('alter table app.person_detail add constraint %I check (%I !~ %L and %I !~ %L and %I !~ %L and char_length(%I) between 1 and %s)',
      'person_detail_' || c || '_check', c, '^' || ws, c, ws || '$', c, case when c like '%address' then ctl_address else ctl end, c, n);
  end loop;
  foreach c in array array['current_pincode', 'permanent_pincode'] loop
    execute format('alter table app.person_detail add constraint %I check (%I ~ %L)', 'person_detail_' || c || '_check', c, '^[1-9][0-9]{5}$');
  end loop;
  foreach c in array array['father_phone', 'mother_phone', 'guardian_phone'] loop
    execute format('alter table app.person_detail add constraint %I check (%I ~ %L)', 'person_detail_' || c || '_check', c, '^[0-9]{10}$');
  end loop;
end $$;
-- format only: the app checks the code against the ISO list (design Z2)
alter table app.person_detail add constraint person_detail_nationality_check check (nationality ~ '^[A-Z]{2}$');
alter table app.person_detail add constraint person_detail_blood_group_check
  check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));
alter table app.person_detail add constraint person_detail_employment_status_check
  check (employment_status in ('STUDENT', 'EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'NOT_KNOWN')); -- PMC (DD-15)
alter table app.person_detail add constraint person_detail_qualification_check
  check (qualification in ('BELOW_SSLC', 'SSLC', 'PLUS_TWO', 'DIPLOMA', 'DEGREE', 'POSTGRADUATE', 'OTHER', 'NOT_KNOWN')); -- PMC

-- ---------- RLS: read as person; write only with student.admit at a centre where the person is admitted (D1) ----------
alter table app.person_detail enable row level security;
alter table app.person_detail force row level security;
create policy scope_select on app.person_detail for select
  using (exists (select 1 from app.admission a where a.person_id = person_detail.person_id));
create policy scope_insert on app.person_detail for insert
  with check (exists (select 1 from app.admission a where a.person_id = person_detail.person_id
    and a.centre_id = any ((select app.scoped_centre_ids('student.admit'))::int[])));
create policy scope_update on app.person_detail for update
  using (exists (select 1 from app.admission a where a.person_id = person_detail.person_id
    and a.centre_id = any ((select app.scoped_centre_ids('student.admit'))::int[])))
  with check (exists (select 1 from app.admission a where a.person_id = person_detail.person_id
    and a.centre_id = any ((select app.scoped_centre_ids('student.admit'))::int[])));
-- no delete policy

-- ---------- Grants (no update of person_id) ----------
grant select, insert on app.person_detail to gems_app;
grant update (current_address, current_place, current_pincode, permanent_address, permanent_place, permanent_pincode,
  nationality, blood_group, employment_status, qualification, father_name, father_occupation, father_phone, mother_name,
  mother_occupation, mother_phone, guardian_name, guardian_relation, guardian_phone, guardian_occupation, version)
  on app.person_detail to gems_app;
