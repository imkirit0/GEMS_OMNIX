# Catalogue masters pages (fifth Stage 3 piece): input brief for `egm-draft`

Prepared 2026-10-29 from the audit pack and the built code, as **input** for an EGM draft session. This is not a design: the design doc is written section by section with the design owner and then reviewed by `egm-review`.

Evidence classes: SRC = stated in a source, INF = inferred, PRO = proposed, PMC = pending manager confirmation. Nothing here is approved.

## 1. What it is (SRC, INF)
- **R-033.06, R-033.07, R-033.08 (SRC):** the centre class (15 rows; filters say 16), course category (11 active; filters say 12) and course division (22 rows; filters say 23) masters.
- **R-028 (SRC):** the academic year master: year, from and to dates, sort order, status; the legacy list also shows a login status and an "active academic year" chosen in a header modal.
- **R-020 (SRC):** the legacy masters dashboard: 10 tiles of simple masters (semester/section, student category, religion, caste, mother tongue, category, support login, blood group, and others). None of these tables exist yet.
- **What exists (catalogue skeleton E-034, course master E-040):** tables `course_category`, `course_division`, `centre_class` (code, name, active) and `academic_year` (code, dates, open); audited server functions `createMaster`, `updateMaster`, `setMasterActive`, `openAcademicYear`, `updateAcademicYear`, `setAcademicYearOpen`, all behind `catalogue.manage` with step-up; no read functions for the masters and **no screens**: a new category, division, class or year can be added only by SQL today. The course pages (`/admin/catalogue/courses`) list the masters' active entries in their pickers.
- **Not settable anywhere yet (INF):** a centre's class (`centre.centre_class_id`; catalogue DD-7: set by the Stage 3 centre form or a class-revision ticket). Course availability (course-master DD-2) is useless until centres have classes.
- **Why now (INF):** the course pages need categories, divisions and classes that someone can maintain; the masters are the smallest piece that makes the catalogue usable without SQL.

## 2. Requirements in scope (traceability matrix)
| Req | What | Stage | In this piece? (PRO, to settle) |
|---|---|---|---|
| R-033.06–.08 | Centre class, course category, course division pages | S3 | Yes |
| R-028 | Academic year page | S3 | Yes (dates, open/closed); "active year" and login status to decide |
| R-020.01–.08 | Other simple masters (religion, caste, blood group…) | S3 | To decide: new tables, and some overlap the fixed lists of learner details (learner-details DD-2) |
| R-023 (part) | Setting a centre's class | S3 | To decide: here, or with centre creation |

## 3. Open decisions (audit 04; all PMC)
| ID | Decision | Proposed default | Owner |
|---|---|---|---|
| D-ORG-2 | Centre class revisable | Via ticket with history | Operations |
| D-YEAR-3 | AY vs FY | Keep both | Accounts |
| D-CAT-2 | Who approves catalogue changes | `catalogue.manage` stays enough for Stage 3 | Academics |

## 4. Questions the design should answer explicitly
1. **Which masters:** only the four that exist, or also new R-020 masters.
2. **Centre class on a centre:** a page here (audited, `catalogue.manage`), or wait for centre creation / the class-revision ticket (D-ORG-2).
3. **Academic year extras:** sort order and an "active year" (R-028), or dates and open/closed only.
4. **Screens:** one page per master or one shared page; who may read them.
5. **Read functions:** the masters need list reads (with inactive entries) for their own pages.

## 5. Owner decisions before drafting (2026-10-29)
- **DD-1:** the four existing masters only (course category, course division, centre class, academic year); the other R-020 masters wait.
- **DD-2:** a catalogue manager sets or changes a centre's class through an audited edit with step-up; the audit rows are its history (D-ORG-2's ticket stays possible later).
- **DD-3:** academic years: dates and open/closed only (no sort order, no "active year").
- **DD-4:** any signed-in user reads the masters pages; only `catalogue.manage` changes them.
