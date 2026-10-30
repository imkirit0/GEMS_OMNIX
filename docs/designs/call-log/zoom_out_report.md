# Call log: EGM step 5 zoom-out report

Reviewed: commit d8d377d (2026-10-30), alongside steps 6 and 7.

**Verdict: revise.** A separate `app.call_log` table is right. Enquiry follow-ups need an open enquiry, and an enquiry needs DOB, gender, path and course. The design revision records how each finding below is resolved.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Blocker | The audit stores the phone and name, which contradicts enquiry DD-14 (field names only; `enquiry.ts:4, :204, :303`). | Audit `{ fields }` only. |
| Z2 | Major | The tele-caller trigger branch has no precedent: `setCounsellor` checks in the app only (`enquiry.ts:272-275`). | The guard sets only `by_user` and `at`. |
| Z3 | Major | The name resolution ("Staff") is invented. The R-084 table has no tele-caller or logger column. | Drop it, or add a `call_people` definer later. |
| Z4 | Major | The phone filter has no caller, and its index exists only for that filter. The POST-search pattern already exists (`enquiry.ts:324`). | Put the search on the page by POST, or delete the filter. |
| Z5 | Major | The insert grant lacks `id` while the insert passes an explicit id, so it fails with 42501. | Target the centre in the audit, use `returning id`, and drop the pre-flight. |
| Z6 | Major | `callCentres` duplicates `enquiryOptions().centres`, and the home link duplicates `canViewEnquiries`. | Reuse both. |
| Z7 | Nit | The call type values are INCOMING/OUTGOING, while follow-ups use CALL_IN/CALL_OUT. | Use CALL_IN/CALL_OUT. |
| Z8 | Nit | `name` uses `geoName`, which has no control-character rule. | Use `ownText` for name, description and note. |
| Z9 | Nit | The `ws`/`ctl` constants are local to a do-block in 0018. | Copy them into 0022. |
| Z10 | Nit | The fixtures use `session_replication_role`; only `reset.sql` toggles the trigger. | Fixtures: add the table to the truncate list. |
| Z11 | Nit | The driver-cause unwrap appears in a third copy. | Acceptable; a candidate for a shared helper later. |
| Z12 | Nit | The types and the message table are implementation detail. | Keep them, because later steps check against them. |
