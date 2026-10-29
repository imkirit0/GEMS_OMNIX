# Learner details (second Stage 3 piece): input brief for `egm-draft`

Prepared 2026-10-29 from the audit pack and the built code, as **input** for an EGM draft session. This is not a design: the design doc is written section by section with the design owner and then reviewed by `egm-review`.

Evidence classes: SRC = stated in a source, INF = inferred, PRO = proposed, PMC = pending manager confirmation. Nothing here is approved.

## 1. What it is (SRC, INF)
- **The admission form is built** (admission screens, E-037) with the person fields that existed in Stage 2 only: given and family name, gender, date of birth, mobile, email (admission-screens DD-1: "more person fields come by a later expand migration").
- **The legacy form collects much more** (SRC, SPEC pp. 30–31; R-150.02, R-150.04): employment status (req), pincode (req), academic qualification (req, list), course specialisation, course category, sub course category, contact no, age, nationality (253 values), blood group, SMS mobiles 1/2, current address and place, guardian occupation, father name/occupation, mother name/phone/occupation, permanent address with "same as current", previous marks (SSLC, Plus Two, Degree, Graduation: year of passing, mark %, institution, class/division).
- **Why now (INF):** the form is usable but thin; centres need contact and guardian data in daily work, and the migration will bring these fields from legacy rows.

## 2. Requirements in scope (traceability matrix)
| Req | What | Stage | Evidence | In this piece? (PRO, for the design to settle) |
|---|---|---|---|---|
| R-150.02 | Personal, parent, address sections | S3 | SRC | Yes, the non-sensitive fields |
| R-150.04 | Previous marks (SSLC, Plus Two, Degree, Graduation) | S3 | SRC | To decide |
| R-150.05 | Aadhaar, religion, caste, differently abled, last school, state, district, guardian block | S3 | SRC | Sensitive part no (D-SEC-4); guardian block, last school, state/district to decide |
| R-020.05, R-020.08 | Mother tongue (24), blood group (8) masters | S3 | SRC | Masters or fixed lists: to decide |
| R-033.01–.03 | Country (255), state (73), district (43) masters | S3 | SRC | Masters or free text: to decide |
| R-095 | Correction tickets (name, DOB, gender…) | S3 | SRC | No: separate piece; but which new fields are "identity" for D-ADM-3 matters here |

## 3. What exists today (built)
- `app.person` (id, given/family name, gender, date of birth, mobile, email, match key); RLS: a person is visible only through an admission in scope (0011).
- `identityField()` validates and normalises each identity field; `changeIdentity()` is the only path that changes identity fields (for correction handlers).
- The admission form (`app/students/new/form.tsx`, `src/server/admission-form.ts`: `FORM_NAMES`, mapping rules, field errors by input name) and the view page.
- The migration framework's admission rule maps the identity fields from `raw.legacy_admission`.
- The catalogue pattern for small masters (code, name, active; setup-table RLS; `catalogue.manage`; audited functions).

## 4. Data facts (DQR, audit 03, 08)
- Legacy masters carry duplicates and misspellings (religion 51 rows; caste 963; D-MIG-4 merge maps).
- Nationality 253 values, state 36–73, district 43–612 depending on the source (counts conflict).
- Previous-marks data quality is unknown until Stage 0 (legacy access).

## 5. Open decisions (audit 04; all PMC, none approved)
| ID | Decision | Proposed default | Owner |
|---|---|---|---|
| D-ADM-3 / D-STU-1 | Which fields are edited freely vs via ticket | Identity/contact fields via ticket only | PRO |
| D-SEC-4 | Aadhaar/caste/sensitive fields; DPDP duties | Masked + encrypted where justified; consent | IT + Legal |
| D-MIG-4 | Master dedupe maps | Approved merge maps | Owners |
| D-SEC-5 | Retention | PITR + daily dump | IT |

## 6. Questions the design should answer explicitly
1. **Which fields**, and which are required on the form (legacy marks employment status, pincode and qualification as required).
2. **Where they live:** columns on `person`, a separate `person_detail` table (1:1), and child tables for guardians and previous marks; whether address belongs to the person or the admission.
3. **Masters or text:** qualification, nationality, blood group, mother tongue, state, district: catalogue-style masters, fixed enums, or validated text.
4. **Identity vs details:** which new fields count as identity (corrected only by ticket, D-ADM-3) and which are freely editable details; whether this piece adds an edit path for details.
5. **Duplicate detection:** do any new fields join the match key (e.g. father's name)?
6. **The form:** sections, how the existing `FORM_NAMES` and error mapping extend, "same as current address".
7. **Migration fit:** mapping legacy columns into the new fields; the rule versions.
8. **Personal data:** guardian names and phones are other people's personal data: visibility, audit redaction (`app.redact`), exports.
