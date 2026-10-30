-- Reset between migration runs (design: Components, Reset). Run as the schema owner.
-- Clears raw rows, run records and migrated targets; KEEPS migration.rule and its approvals,
-- so the sequence dry run -> approve -> reset -> cutover run works on one database.
-- Enquiries reference admissions (enquiry design R1): cleared with them; the follow-up log's no-truncate trigger is
-- lifted for this statement only. Holds while no real enquiries are recorded before the legacy cutover.
-- Fee dues reference registrations (fee-dues design), and receipts reference both (fee-receipts D7): cleared with them the
-- same way; holds while no real dues or receipts exist, before the legacy cutover.
alter table app.enquiry_followup disable trigger enquiry_followup_no_truncate;
alter table app.fee_due disable trigger fee_due_no_truncate;
alter table app.journal_line disable trigger journal_line_no_truncate;
alter table app.fee_hold_event disable trigger fee_hold_event_no_truncate;
alter table app.fee_concession disable trigger fee_concession_no_truncate;
alter table app.fee_scheme_assignment disable trigger fee_scheme_assignment_no_truncate;
alter table app.journal_entry disable trigger journal_entry_no_truncate;
alter table app.receipt_allocation disable trigger receipt_allocation_no_truncate;
alter table app.receipt disable trigger receipt_no_truncate;
truncate raw.legacy_centre, raw.legacy_admission, raw.legacy_course_row,
  migration.key_map, migration.exception, migration.reconciliation, migration.run,
  app.enquiry_followup, app.enquiry, app.journal_line, app.journal_entry, app.fee_hold_event, app.fee_concession, app.fee_scheme_assignment, app.receipt_allocation, app.receipt, app.fee_due, app.registration, app.admission, app.person_detail, app.person;
alter table app.enquiry_followup enable trigger enquiry_followup_no_truncate;
alter table app.fee_due enable trigger fee_due_no_truncate;
alter table app.journal_line enable trigger journal_line_no_truncate;
alter table app.fee_hold_event enable trigger fee_hold_event_no_truncate;
alter table app.fee_concession enable trigger fee_concession_no_truncate;
alter table app.fee_scheme_assignment enable trigger fee_scheme_assignment_no_truncate;
alter table app.journal_entry enable trigger journal_entry_no_truncate;
alter table app.receipt_allocation enable trigger receipt_allocation_no_truncate;
alter table app.receipt enable trigger receipt_no_truncate;
delete from app.global_number_series where series in ('REGISTER', 'ADMISSION');
