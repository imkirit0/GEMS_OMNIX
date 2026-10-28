# Centre and catalogue skeleton: input brief for `egm-draft`

Prepared 2026-10-28 from the audit pack, as **input** for an EGM draft session. This is not a design: the design doc is written section by section with the design owner and then reviewed by `egm-review`.

Evidence classes: SRC = stated in a source, INF = inferred, PRO = proposed, PMC = pending manager confirmation. Nothing here is approved.

## 1. What it is (SRC, INF)
- **Roadmap Stage 2** (audit 10, row 2) lists a "centre/catalogue skeleton" next to the person core, numbering, audit, tickets and the ETL framework. It is the last Stage 2 piece still open (`docs/STATUS.md`).
- **Why a skeleton now (INF):** later stages point at courses and centre classes.
  - `registration.course_code` is free text today; the person-core design promised it gains a foreign key "by an expand migration" once a catalogue exists.
  - Course availability by centre class (D-CAT-1), fee structures per course and academic year (Stage 4, D-CAT-3) and the migration's course mapping (D-MIG-4: 196 multi-name codes) all need a course table with stable codes.
  - The Academic Year Master (R-028, S2) is held as checked text in the person core.
- **Full screens are Stage 3:** centre creation and list (R-022, R-023), centre permissions (~60 flags, R-024), course master with ~30 fields (R-090), centre-course assignment (R-090.01, R-091), category/division/class masters (R-033.06–.08), quick-add (R-008).

## 2. Requirements in scope (traceability matrix)
| Req | What | Stage | Evidence |
|---|---|---|---|
| R-090 | G-TEC course master: course name, display name, code, category (12), division (23), certifications, duration type and length, capacity, fees split type, department, curriculum, status… | S3 | SRC |
| R-090.01, R-091 | Special-case courses by region/area/centre class; centre-class course assignment (`class_assign` crashes in legacy) | S3 | SRC / REC |
| R-033.06, .07, .08 | Centre class (15 or 16), course category (11 or 12), course division (22 or 23) | S3 | SRC; counts conflict (X5) |
| R-022, R-023 | Centre master and creation: identity, board, type, category, **centre class (required)**, category level, address, contacts… | S3 | SRC |
| R-028 | Academic Year Master (sessions: year, from, to, sort order, active year) | **S2** | SRC |
| R-008 | Masters quick-add + refresh list (religion, caste, AY, course category, division, certification…) | **S2** | SRC |

## 3. What exists today (built; E-014…E-033)
- `app.region`, `app.area`, `app.centre` (`code` unique, `name`, `area_id`, `centre_class` **free text**, `status` INACTIVE/ACTIVE, default INACTIVE per D-ORG-1 default); RLS on `centre` by scope; the centre list page (`app/centres`) with search and rate limit.
- Person core: `registration.course_code text` with no foreign key; `admission.academic_year` checked `YYYY-YY` text.
- Migration framework: centre rule matches legacy codes to `app.centre.code`; no course rule yet.
- Platform: `scopedAction`, `app.audit`, the 0002 RLS loop, setup tables readable by all and writable by a manage permission (ticket types, 0009), the ticket engine for approvals.

## 4. Data facts (DQR, audit 03)
- **Courses:** 1,200 / 1,220 (API) / 1,350+ / 1,359 / 1,375 depending on the source (X5); 196 codes carry more than one name; whitespace codes, `/` and `&` in codes, empty codes; courses named "-delete" (EXCLUDED/ARCHIVED at migration).
- **Divisions** 22 or 23, **categories** 11 or 12 (X5). **Centre classes** 15 listed on creation, 16 in filters.
- **Centres:** 325–386 depending on the source (X2); 6 malformed codes; test centres (X14).

## 5. Open decisions (audit 04; all PMC, none approved)
| ID | Decision | Proposed default | Owner |
|---|---|---|---|
| D-CAT-1 | Centre class still governs availability | Keep centre class + special cases | Academics |
| D-CAT-2 | Who approves new courses and fee heads | Course goes live via approval ticket | Academics, Accounts |
| D-CAT-3 | Course versioning vs edit in place | AY-keyed fee structures; course edits audited | Academics |
| D-ORG-1 | Who creates centres; pre-login checks | Created Inactive; activation checklist + approver | Operations |
| D-ORG-2 | Centre class fixed or revisable | Revisable via ticket with history | Operations |
| D-ORG-5 | Region semantics and hierarchy | Separate geography from sales region | Operations |
| D-ORG-6 | Centre lifecycle fields | Add fields; soft close keeps history | Operations |
| D-YEAR-3 | Academic year vs financial year | Keep both | Accounts |
| D-MIG-4 | Master dedupe maps (incl. course names) | Approved merge maps | Owners |

## 6. Questions the design should answer explicitly
1. **Scope of the skeleton:** which tables Stage 2 creates (course, course category, division, centre class, academic year?) and which fields, versus what the Stage 3 screens add by expand migrations.
2. **Course identity:** is the course code the key (unique, normalised) or a surrogate id with a unique code; how multi-name codes (196) are represented; whether a course is network-wide (likely) and how availability by centre class (D-CAT-1) is modelled.
3. **Centre class:** promote `centre.centre_class` from text to a reference table, and whether class history (D-ORG-2) is needed now.
4. **Academic Year Master (R-028, S2):** a table that `admission.academic_year` references, or keep the checked text; who opens a year; how it fits the chained Admission No series (person-core DD-7).
5. **Writes:** who may create or change a course (D-CAT-2: through an approval ticket?) and whether Stage 2 needs a write path at all, or only seeds and the migration rule.
6. **The registration foreign key:** when `registration.course_code` gains its foreign key, and what that does to existing rows and to the P8 fixture.
7. **Migration fit:** a course mapping rule for the ETL framework (normalised codes, multi-name codes as MERGED or SPLIT?), or deferred to the stage that has course data.
8. **Scope and RLS:** catalogue tables have no `centre_id`; readable by every signed-in user, writable by a manage permission, as ticket types are.
