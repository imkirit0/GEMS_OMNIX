-- Reset between migration runs (design: Components, Reset). Run as the schema owner.
-- Clears raw rows, run records and migrated targets; KEEPS migration.rule and its approvals,
-- so the sequence dry run -> approve -> reset -> cutover run works on one database.
truncate raw.legacy_centre, raw.legacy_admission, raw.legacy_course_row,
  migration.key_map, migration.exception, migration.reconciliation, migration.run,
  app.registration, app.admission, app.person;
delete from app.global_number_series where series in ('REGISTER', 'ADMISSION');
