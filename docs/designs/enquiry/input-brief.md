# Enquiry to admission (sixth Stage 3 piece): input brief for `egm-draft`

Prepared 2026-10-29 from the audit pack, the WF PDF (p. 2) and the built code, as **input** for an EGM draft session. This is not a design: the design doc is written section by section with the design owner and then reviewed by `egm-review`. The roadmap order (owner, 2026-10-29: "go in order") puts WF1 first in Stage 3; its admission half is built (E-037, E-038), its enquiry half is not.

Evidence classes: SRC = stated in a source, INF = inferred, PRO = proposed, PMC = pending manager confirmation. Nothing here is approved.

## 1. What it is (SRC, INF)
- **WF1 (SRC, WF p. 2):** "An enquiry becomes an admission only when the centre enrols it." Centre lane:
  1. Enquiry captured (Enquiry Form or CRM lead).
  2. Follow-up calls and reminders (Phone Call Log, CRM reminder date, last contact).
  3. Converts? If no, the lead stays Not Enrolled, Lost or Junk (CRM status; Enquiry Conversion Report). If yes, "Enroll Student" from the enquiry list opens the admission form.
  4. Admission saved, course registrations, fee dues (Stage 4), counted at head office.
- **R-081 (SRC):** the enquiry form.
  - **Fields:** centre, student name, address, pincode, contact no, mobile/WhatsApp, DOB (req), enquiry path (req; 16 values), academic qualification (18), last studied school, date, gender (req), enquiry type (req; Walk In, Online, Website, TeleCaller, Phone Enquiry, Other Ref, Direct call), Instagram ID, parent/guardian, remark.
  - **Course preference rows:** division, category, course (req), plus scheme, fees, discount, certificates, batch and dates.
  - **List:** filters by date and enrolment status, contact search.
  - **Enroll Student:** a modal that converts the enquiry to an admission.
- **R-085 (SRC list, REC detail):** the CRM leads: about 34,120 leads and 148 CRM logins. It has statuses (a master with colours and order), sources, assignment to a counsellor, reminder date and note, last contact, bulk status changes, a calendar and export.
- **R-084 (SRC):** the phone call log: centre, name, phone, date, description, next follow-up date, duration, note, call type (Incoming/Outgoing), tele-caller.
- **R-080 (SRC):** front office masters: purpose, complaint type, source, reference.
- **D-ADM-1 (PMC default):** "one merged enquiry/lead entity" instead of GEMS enquiries plus a separate CRM.
- **What exists:**
  - Persons, admissions and registrations, with duplicate detection by match key (person core).
  - The admit form, a Server Action with resubmit guard.
  - Learner details: the same fields as many enquiry fields (address, pincode, qualification, parent).
  - The catalogue: courses with categories and divisions; availability by centre class.
  - RBAC with centre scope, the ticket engine, audit, and numbering (`allocateGlobal`, gapless series).
- **What does not exist:** any enquiry or lead table, a lead status master, follow-ups, or the link from an admission back to its enquiry.

## 2. Requirements in scope (traceability matrix)
| Req | What | Stage | In this piece? (PRO, to settle) |
|---|---|---|---|
| R-081 | Enquiry form, list, Enroll Student | S3 | Yes |
| R-085 | CRM leads (status, source, counsellor, reminders, bulk, calendar, export) | S3 | Core only (status, source, counsellor, reminder); bulk, calendar, export to decide |
| R-084 | Phone call log / follow-ups | S3 | As follow-ups on an enquiry, to decide |
| R-080 | Front office masters | S3 | Only the lists the enquiry needs, to decide |
| R-081 preference rows: scheme, fees, discount | S3/S4 | No: fees are Stage 4 (G-FIN gate) |

## 3. Open decisions (audit 04; all PMC)
| ID | Decision | Proposed default | Owner |
|---|---|---|---|
| D-ADM-1 | Lead source: GEMS enquiry, CRM or both | One merged enquiry/lead entity | Admissions/PRO |
| D-ADM-4 | What creates an admission; which date sets its month | Record on save | Admissions + MIS |
| D-SEC-4 | Sensitive fields, PII | Enquiry contact data is PII; scoped by centre | IT |

## 4. Questions the design should answer explicitly
1. **One entity or two** (D-ADM-1): enquiry and CRM lead merged.
2. **Statuses:** a fixed list in code (Open, Enrolled, Lost, Junk…) or an editable master (R-085 has colours and order).
3. **Follow-ups:** a list of calls and reminders per enquiry, or one "next follow-up date" field.
4. **Enroll:** the admission form pre-filled from the enquiry and the admission linked back; one enquiry may enrol once or more than once.
5. **Who:** a new permission (`enquiry.manage`, centre-scoped) or reuse `student.admit`; counsellor assignment.
6. **Lists:** the fixed lists (enquiry path 16, enquiry type, qualification 18) in code like learner details, or masters.
7. **Duplicates:** warn on an existing enquiry or learner with the same mobile.
8. **Numbering:** an Enquiry No from a series, or the row id.

## 5. Legacy values (SRC, SPEC pp. 33, 54)
- **Enquiry path** (16; examples given): Social Media, Walk In, Direct Call, Message, Tele Calling, Alumnus/Alumna, Friends, G-TEC Student's, Notice Boards/Hoardings, TV Advertisements, Newspaper Advertisements, MAIL, staff, Other Ref.
- **Enquiry type:** Walk In, Online, Website, TeleCaller, Phone Enquiry, Other Ref, Direct call (plus individual telecaller names, which become the counsellor instead).
- **CRM statuses (examples):** Affordability, Converted, Enrolled; filters Lost, Junk. Status master: name, colour, order.
- **CRM mode of enquiry:** Phone, Email, Paper Advertisement, Facebook, Best Manager Contest, Reference, Website, Consultant.
- **CRM lead form:** candidate, parent/guardian, DOB, address, student and parent mobiles, landline, email, course completed, institution last attended, course interested, mode of enquiry, contact person, counsellor, enquiry date, reminder date and note, business segment, sub-segment, customer category.

## 6. Owner decisions before drafting (2026-10-29)
- **DD-1:** one merged enquiry entity (D-ADM-1 default); no separate CRM.
- **DD-2:** scope = core funnel (capture, list, status, counsellor, follow-ups, Enroll into the admission form, linked back) **plus bulk changes and a follow-up calendar**. Export later.
- **DD-3:** new permissions `enquiry.view` and `enquiry.manage`, centre-scoped; enrolling also needs `student.admit` at that centre; the system administrator holds them.
- **DD-4:** the lists (enquiry path, enquiry type, lead status) are **editable masters**.
