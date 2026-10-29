# Certifications and special-case availability (seventh Stage 3 piece): input brief for `egm-draft`

Prepared 2026-10-29 from the audit pack, the WF PDF (p. 3) and the built code, as **input** for an EGM draft session. This is not a design.

The roadmap order (owner: "go in order") continues with WF2, the catalogue. Already built: the course master (E-040), the masters pages and centre classes (E-041). Still open in WF2 at Stage 3:
*   the certification master;
*   a course's certifications;
*   special-case availability.

Exam mapping (R-114) is Stage 6, and fee assignment (R-059) is Stage 4.

Evidence classes: SRC = stated in a source, INF = inferred, PRO = proposed, PMC = pending manager confirmation. Nothing here is approved.

## 1. What it is (SRC, INF)
- **WF2 (SRC, WF p. 3):** "A course is created once with its duration, fee heads, mandatory and optional certifications and exams, and the centre classes that may sell it … Availability is by centre class tier, with a special-case page for tie-up and Keltron courses that only named centres may offer."
- **R-092 (SRC):** the certification master. Its fields are name, type (required; Voucher or Licence), short code and description. The legacy system lists 57 bodies (the filters say 58; X4).
- **R-090 (SRC):** a course has "Mandatory Certification (multi, 58)" and "Optional Certification (multi)".
- **R-090.01 (SRC):** "Special Case - Assign Centre": assign special-case courses to region, area or centre classes. The WF wording is "only named centres may offer".
- **What exists:**
  - courses, with centre classes per course (`course_centre_class`), behind `catalogue.manage`;
  - availability by the centre's class, enforced in `admit()` and the admit form only while `CATALOGUE_GATES.enforceAvailability` is on (committed off);
  - the shared masters page (`/admin/catalogue/masters/[slug]`) with a per-kind permission registry;
  - a centre's class is set per centre (E-041).

## 2. Questions the design must answer
1. Certification types: a fixed list in code (Voucher, Licence) or a master.
2. A course's certifications: one link with a mandatory flag, or two lists.
3. Special cases: the named centres replace the class rule for that course, or add to it; and by centre only, or also by region and area.
4. Where it is edited: on the course page (as classes are), plus a certifications page.

## 3. Decisions taken under the owner's standing instruction (2026-10-29)

The owner said: "agree on the recommended option and work on everything planned". These are the recommended options, recorded as such, not as fresh owner signatures; all are PMC where they are business rules.

- **DD-1:** certifications are a master page (code, name, type, description, active), behind `catalogue.manage`. The type is a fixed list in code: VOUCHER, LICENCE (SRC values).
- **DD-2:** a course's certifications are one link table with a `mandatory` flag, edited on the course page and audited as codes.
- **DD-3:** special cases are named **centres** per course. When a course has any named centres, **only those centres** may offer it, and its class rule no longer applies (WF: "only named centres may offer"). Region and area special cases wait. Enforcement stays behind the same `enforceAvailability` switch.
- **DD-4:** no exams or fees in this piece.
