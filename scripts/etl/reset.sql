-- Reset between migration runs (design: Components, Reset). Run as the schema owner.
-- Clears raw rows, run records and migrated targets; KEEPS migration.rule and its approvals,
-- so the sequence dry run -> approve -> reset -> cutover run works on one database.
-- Enquiries reference admissions (enquiry design R1): cleared with them; the follow-up log's no-truncate trigger is
-- lifted for this statement only. Holds while no real enquiries are recorded before the legacy cutover.
alter table app.enquiry_followup disable trigger enquiry_followup_no_truncate;
truncate raw.legacy_centre, raw.legacy_admission, raw.legacy_course_row,
  migration.key_map, migration.exception, migration.reconciliation, migration.run,
  app.enquiry_followup, app.enquiry, app.registration, app.admission, app.person_detail, app.person;
alter table app.enquiry_followup enable trigger enquiry_followup_no_truncate;
delete from app.global_number_series where series in ('REGISTER', 'ADMISSION');
