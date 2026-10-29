# Admission screens (first Stage 3 piece): input brief for `egm-draft`

Prepared 2026-10-29 from the audit pack and the built Stage 2 code, as **input** for an EGM draft session. This is not a design: the design doc is written section by section with the design owner and then reviewed by `egm-review`.

Evidence classes: SRC = stated in a source, INF = inferred, PRO = proposed, PMC = pending manager confirmation. Nothing here is approved.

## 1. What it is (SRC, INF)
- **Roadmap Stage 3** (audit 10, row 3): centre, catalogue, enquiry, admission, student lifecycle (WF1, WF2, WF3, WF7, WF-X4, X13, X14, X16, X19). Stage 2 is built (`docs/STATUS.md`, E-023…E-036).
- **Why admission first (INF):** it is the centre's core daily action and the first screen on the Stage 2 core. `admit()`, `getPerson()` and `findMatches()` (person core) and the catalogue (courses, academic years) exist and are tested, but nothing calls them from a page (person-core DD-3: "the first screen is Stage 3"). Enquiry (R-081) converts *into* an admission, so the admission comes first; centre creation (R-023) and course master screens (R-090) are separate Stage 3 pieces.
- **The legacy form (SRC, SPEC pp. 9, 30–31):** three tabs (Student Details, Additional Information, Documents Upload), one SAVE, a "Missing Fields" panel, several courses per admission.

## 2. Requirements in scope (traceability matrix)
| Req | What | Stage | Evidence | In this piece? (PRO, for the design to settle) |
|---|---|---|---|---|
| R-150 | Admission form: first name (req), last name, academic year (req), G-TEC course (req), centre, Admission No (auto), admission date (req, default today); multi-course | S3 | SRC; centre behaviour REC | Yes: the fields `admit()` takes today |
| R-150.01 | Course grid: division, category, course, **scheme, discounts, totals, installments**, batch, join/end date, mode, status | S3 | SRC | Course, join date, end date only; fee fields are Stage 4 (G-FIN gate); batch needs R-155 |
| R-150.02 | Personal, parent, address sections (employment, pincode, qualification, nationality, blood group, addresses…) | S3 | SRC | To decide: none of these columns exist on `app.person` yet |
| R-150.04 | Previous marks (SSLC, Plus Two, Degree) | S3 | SRC | To decide |
| R-150.05 | Additional information: **Aadhaar**, religion, caste, differently abled… | S3 | SRC | No: blocked by D-SEC-4 (sensitive personal data) |
| R-150.06 | Documents upload: photo + five titled slots | S3 | SRC | To decide: the ticket engine's upload path (ADR-002, still Proposed) could be reused |
| R-001, R-229 | Search student, detailed view | S3 | SRC | A list and a view page at least (`getPerson()` exists) |
| R-095 | Student correction tickets (name, DOB, gender…) | S3 | SRC | No: separate piece (`changeIdentity()` + a ticket handler) |

## 3. What exists today (built)
- **Functions:** `admit(session, input)` (validates, refuses closed years and inactive courses, flags likely duplicates as `PossibleDuplicate` unless `confirmNew`, allocates Admission No and Register No, audits `person.admit`); `getPerson(session, id)` (scoped by `student.view`); `findMatches()`; `changeIdentity()` (for correction handlers only). Person fields today: given name, family name, gender, date of birth, mobile, email.
- **Catalogue:** `app.course` (5 seeded in tests, none on the hosted database), `app.academic_year`; readable by every signed-in user.
- **Screen patterns:** server-rendered pages with POST route handlers + 303 redirects, same-origin check on every POST, generic errors with reference ids, per-request CSP nonce (`app/tickets/*`, `app/admin/*`, `app/centres/*`). Screens are **unstyled on purpose** (STATUS: visual design waits for a design-system decision; ticket-engine DD-7 used screens as a test harness).
- **Permissions:** `student.admit`, `student.view` (both `sensitive = false`, PMC); the system administrator holds every permission (E-035).
- **Exports:** the generic export (E-021) could gain a students dataset, PII-gated by `pii.export`.

## 4. Data facts (DQR, audit 03, 08)
- Legacy admissions carry one person per admission; persons are counted separately from registrations (D-STU-4, T-XM-01).
- Duplicate learners exist in legacy data; the merge process is D-STU-5 (open). The person core flags likely duplicates at entry within the caller's scope only.
- Admission No: `GTEC` + year pair + sequence, network-wide per year (person-core DD-7, NP-* open); Register No network-wide.

## 5. Open decisions (audit 04; all PMC, none approved)
| ID | Decision | Proposed default | Owner |
|---|---|---|---|
| D-ADM-2 | Admission counted on save or on registration-fee paid | Store both states; reports use fee-paid | Admissions + MIS |
| D-ADM-3 | Who may edit an admission; which fields need tickets | Identity/contact fields via ticket only | PRO |
| D-ADM-4 | What creates an admission record; which date sets its month | Record on save | Admissions + MIS |
| D-STU-4 | Person vs registration identity | Person → admission → registration (used by person core) | Admissions/PRO |
| D-STU-5 | Merging duplicate persons | Allowed at entry; merged later | Admissions/PRO |
| D-SEC-4 | Aadhaar/caste/sensitive fields | Masked + encrypted where justified; consent | IT + Legal |
| D-SEC-5 | Document retention | PITR + daily dump | IT |
| NP-1…8 | Numbering policy | As built in the person core | Numbering owners |

## 6. Questions the design should answer explicitly
1. **Scope:** exactly which R-150 fields this piece ships, and which wait (fees: Stage 4; sensitive fields: D-SEC-4; batch: R-155). Whether new person columns (address, guardian, qualification) are added now by an expand migration, or the first screen uses only the existing fields.
2. **Pages:** admission form, admission list (search, filters, scope), person/admission view; URLs, and which permission each needs.
3. **Duplicate flow:** how `PossibleDuplicate` is shown (candidates in the caller's scope), how "admit this existing person" (`existingId`) and "this is a new person" (`confirmNew`) are chosen, and what is audited.
4. **Errors:** how `PersonError` field errors, `SeriesMissing`, closed years and inactive courses reach the user; the "Missing Fields" panel (R-150) versus server-side validation only.
5. **Course picker:** ~1,200 courses; a plain select, a search, or division/category filters (R-150.01); only active courses.
6. **Edits after save** (D-ADM-3): none in this piece (corrections via R-095 tickets later), or a limited edit path.
7. **Documents** (R-150.06): in or out; if in, reuse of the ticket upload path and ADR-002.
8. **Styling:** unstyled test-harness screens like the ticket engine, or wait for a design-system decision first.
9. **Tests:** real-server checks (smoke) for the form, scope parity (a B record gives 404, T-SEC-001), same-origin POST, and an end-to-end admission (T-E2E-001 part).
