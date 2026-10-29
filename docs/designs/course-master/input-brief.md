# Course master (fourth Stage 3 piece): input brief for `egm-draft`

Prepared 2026-10-29 from the audit pack and the built code, as **input** for an EGM draft session. This is not a design: the design doc is written section by section with the design owner and then reviewed by `egm-review`.

Evidence classes: SRC = stated in a source, INF = inferred, PRO = proposed, PMC = pending manager confirmation. Nothing here is approved.

## 1. What it is (SRC, INF)
- **R-090 (SRC, SPEC pp. 6, 34–35):** the G-TEC course master: course name, display name, code, category (req), division (req), mandatory and optional certifications (58), duration type (Month, Week, Day, Not Applicable) with months/weeks/days/hours and a computed summary, capacity, fees split type, promotion sort order, department (req), curriculum, default status, mandatory and optional exams (59), centre classes (req, multi; 16), flags (course visibility, IT MAGIC, KELTRON + share, NO REG FEE, INTERNSHIP KELTRON, SELECTED COURSE, materials required, marklist required), fee rows per fee type, course duration settings.
- **R-090.01, R-091 (SRC, REC):** availability: courses assigned to centre classes, plus "special case" assignment to a region, area or centre; legacy `class_assign` crashes (renders every course for every centre).
- **R-092 (SRC):** certification master (name, type Voucher/Licence, short code, description; 57–58 bodies).
- **What exists (catalogue skeleton, E-034):** `app.course` (code, name, category, division, active), `course_category`, `course_division`, `centre_class`, `academic_year`; audited functions behind `catalogue.manage`; `centre.centre_class_id` (no write path yet, catalogue DD-7); `admit()` checks a course is active, not that the centre may sell it.
- **Why now (INF):** Stage 4 fees attach to courses per academic year (D-CAT-3), and centres must only sell courses their class allows (D-CAT-1); both need the course record and availability.

## 2. Requirements in scope (traceability matrix)
| Req | What | Stage | In this piece? (PRO, to settle) |
|---|---|---|---|
| R-090 | Course master fields | S3 | The descriptive fields; fee rows and exam mapping wait (Stage 4 / exams) |
| R-090.01 | Special-case availability | S3 | To decide |
| R-091 | Course ↔ centre-class assignment | S3 | Yes, if availability is in scope |
| R-090.02 | Course list with filters | S3 | A list and edit page |
| R-092 | Certification master | S3 | To decide (needed for mandatory/optional certifications) |
| R-152.01, R-033.09 | Subjects/modules, curriculum | S3 | No |

## 3. Open decisions (audit 04; all PMC)
| ID | Decision | Proposed default | Owner |
|---|---|---|---|
| D-CAT-1 | Centre class governs availability | Keep centre class + special cases | Academics |
| D-CAT-2 | Who approves new courses and fee heads | Course goes live via approval ticket | Academics, Accounts |
| D-CAT-3 | Versioning vs edit in place | AY-keyed fee structures; edits audited | Academics |
| D-ORG-2 | Centre class revisable | Via ticket with history | Operations |
| D-MIG-4 | Course name merge maps | Approved maps | Owners |

## 4. Questions the design should answer explicitly
1. **Which fields** of R-090 now; which wait for fees (Stage 4), exams and certifications.
2. **Availability:** does `admit()` start refusing a course the centre's class may not sell? Centres have no class yet (no write path): set it here, or keep availability advisory until they do.
3. **Special cases (R-090.01):** in this piece or later.
4. **Approval (D-CAT-2):** courses go live through a ticket (the engine now supports domain handlers), or `catalogue.manage` stays enough for Stage 3.
5. **Screens:** a course list and edit page under `/admin/catalogue`, or functions only.
6. **Migration:** a course mapping rule needs legacy data (Stage 0); out of scope.
