# Person, admission and registration core: input brief for `egm-draft`

Prepared 2026-10-28 from the audit pack, as **input** for an EGM draft session. This is not a design: the design doc is written section by section with the owner and then reviewed by `egm-review`.

Evidence classes: SRC = stated in a source, INF = inferred, PRO = proposed, PMC = pending manager confirmation. Nothing here is approved.

## 1. What it is (SRC, INF)
- **Domain spine** (audit 01 §29, PRO): person → admission → course registration. The identity model is decided by D-STU-4. An academic-year-keyed fee structure and a double-entry ledger (audit 07) hang off it later.
- **Admission form** (R-150, SPEC pp. 30–31, SRC):
  - three tabs: Student Details, Additional Information, Documents Upload;
  - **multi-course enrolment**, where one admission has repeatable course rows (R-150.01): course (about 1,200), scheme, scheme rule, amounts and discounts, batch, join and end dates, course mode, and course status (Active, Drop, Leave, Transfer);
  - the Admission No is generated from the course prefix.
- **Personal data** (R-150.02/.05): name, gender, DOB, contacts, addresses, parents/guardian, qualifications. It also includes **Aadhaar, religion, caste, differently-abled**, which fall under D-SEC-4 (IT + Legal, ⛔ prod-gate).
- **Enquiry** (R-081, SPEC pp. 5, 33): its own record, with course preferences, converted by "Enroll Student". Whether the lead source is the GEMS enquiry, the CRM, or both is D-ADM-1.
- **Corrections** (R-095, WF p14): the centre states the old and new value plus proof, HO approves, and the system rewrites the record. These are the ticket types FNC, LNC, MNC, GPC, FPC, SMS, GDR, EMC, GNC, NC, built on the Stage 2 ticket engine. Which fields need a ticket and which are editable freely is D-ADM-3 / D-STU-1.

## 2. Requirements in scope (traceability matrix)
| Req | What | Stage | Evidence |
|---|---|---|---|
| R-029 | Admission No and Register No prefixes per centre and class: start number and current number. Register `2000001`, current **2,064,112**; admission prefix `GTEC2627`, current **43,887**; "counters reset per academic year prefix" | **S2** | SRC |
| R-028 | Academic Year / Admitted Year; the Academic Year Master (sessions) | S2 | SRC |
| R-150, R-150.01–.06 | Admission form, course grid, personal, school-ERP, marks and document sections | S3 (consumers of this core) | SRC |
| R-081 | Enquiry form and list; Enroll Student | S3 | SRC |
| R-095 | Student correction tickets | S3 (handlers) | SRC |

**Stage placement** (audit 10): Stage 2 delivers the **person/admission/registration core** (data model, identity, numbering, scope). The forms, lists and handlers are Stage 3 and must be able to sit on it unchanged.

## 3. The identity question (open)
- **DR-05 (High, Open):** repeated names appear under different register numbers. It is unknown whether a register number belongs to a course registration or to a person (REQ C6).
- **X11:** the legacy API reports 56,336 student records, but the home page shows 43,513. The difference is consistent with one record per registration rather than per person (INF).
- **X1 / NP-2 / NP-7:** register numbers reset per year (SPEC pp. 14–15) or run globally (p18)?
- **D-STU-4 proposed default (PMC):** a person entity, then an admission, then a course registration, with the **register number per registration**. This matches the observed duplicates.
- **Consequence either way:** the model must be able to count people (MIS) and registrations (certification) separately, and migration must map legacy rows to persons with an approved dedupe map (D-MIG-4, T-MIG-004).

## 4. Acceptance tests already defined (audit 09)
- **T-XM-01:** counting persons vs registrations (D-STU-4).
- **T-MIG-004:** dedupe maps applied as approved.
- **T-NUM-007, T-NUM-010** (via R-029): period selection and continuing legacy counters.
- **T-E2E-001/002/003/007:** enquiry → admission → registration → correction. These run at Stage 3, on top of this core.
- **The cross-centre suites (T-RLS, T-SEC)** must cover every new table.

## 5. Open decisions (audit 04; all PMC, none approved)
| ID | Decision | Proposed default | Owner |
|---|---|---|---|
| D-STU-4 | Person vs registration identity; register-number scope | Person → admission → registration; register number per registration | Admissions/PRO |
| NP-2, NP-7, NP-8 | Reset period; register-number scope; continuing legacy counters | Unset (parameters) | Accounts + Certification |
| D-ADM-1 | Lead source: GEMS enquiry, CRM, or both | One merged enquiry/lead entity | Admissions/PRO |
| D-ADM-2 / D-ADM-4 | When an admission counts and which date sets its month | Store both states; reports use fee-paid | Admissions + MIS |
| D-ADM-3 / D-STU-1 | Which fields need a correction ticket | Identity and contact fields via ticket only | PRO |
| D-SEC-4 ⛔ | Aadhaar/PAN/caste storage; DPDP Act duties | Masked and encrypted where justified; consent | IT + Legal |
| D-MIG-4 | Master dedupe maps | Approved merge maps | Owners |
| D-YEAR-3 | Academic year handling | (see audit 04) | Accounts/IT |

## 6. Platform the design must fit (built and tested; E-014…E-031)
- **Scope and isolation:** RLS on every table with `centre_id` (the 0002 loop); `app.visible_centre_ids`, `app.has_permission(perm, centre)`; filters only narrow; 404 for out-of-scope records.
- **Writes:** `scopedAction()` (authorise, change, audit in one transaction); privileged writes as definer functions that re-check in the database (0005 pattern); step-up for sensitive actions.
- **Audit:** `app.audit()` only. Redaction masks Aadhaar, PAN and similar in audit data and logs (T-AUD-005). Every action is catalogued and tested.
- **Numbering:** the `number_series` row-lock allocator (per centre, doc type and period). The ticket engine added a network-wide counter for the case where centre is not part of the series. NP policy stays a parameter.
- **Tickets:** the handler contract (`parse`, `validate`, `revalidate`, `apply`), so corrections plug in as handlers.
- **Exports:** a permission per dataset, PII columns only with `pii.export`, audited, rate-limited.
- **Connections:** `withScope` fails fast on lost connections and retries before commit (C-26).

## 7. Questions the design should answer explicitly
1. **Identity:** the person entity and what identifies a person (no national ID is mandatory; Aadhaar falls under D-SEC-4). How are duplicates prevented going forward, and how are they merged later (migration and corrections)?
2. **Admission vs registration:** what an admission is when one admission carries several course rows; where course status (Active, Drop, Leave, Transfer) lives; how a course change (CMC ticket) moves a registration.
3. **Numbers:** Admission No and Register No as number series (per centre? per class? per academic year?) with NP-2/NP-7/NP-8 as parameters, and what happens on transfer between centres.
4. **Scope:** a person can study at more than one centre over time. Which centre owns the person row, and how does RLS show it to each centre without leaking another centre's registrations?
5. **Personal data:** which fields are stored now, which wait for D-SEC-4, and how sensitive fields are protected (column-level, encryption, masking in exports and audit).
6. **What Stage 2 delivers** (tables, numbering, scope, a minimal create path for tests?) versus what Stage 3 builds (forms, enquiry, lists, correction handlers).
7. **Migration fit:** the shape must accept the legacy rows (43,513 or 56,336) with a dedupe map, without migration-only columns now.
