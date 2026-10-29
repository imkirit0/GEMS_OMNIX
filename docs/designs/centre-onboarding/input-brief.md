# Centre onboarding (eighth Stage 3 piece, WF3): input brief for `egm-draft`

Prepared 2026-10-29 from the WF PDF (pp. 5–7), the SPEC and the built code. The roadmap order (owner: "go in order") continues with WF3 after WF1 (enquiry to admission, E-042) and WF2 (catalogue, E-040, E-041, E-043).

Evidence classes: SRC, INF, PRO, PMC. Nothing here is approved.

## 1. What it is (SRC, INF)
- **WF3 (SRC, WF pp. 5–6):** "A centre goes live only after HO creates it, sets permissions and prefixes."
  - Head office:
    1. create the centre record (code, class, region);
    2. set GST, category and parent centre;
    3. send login credentials;
    4. set permissions and mobile settings;
    5. set prefixes and counters;
    6. assign courses and the fee structure.
  - Decision: centre status Active? If not, the centre's login is blocked. If so, the centre logs in and completes setup (logo, QR code, bank, staff), creates batches and faculty, then enquiries and admissions begin.
- **R-023 (SRC):** the Centre Creation form.
  - Identity: name, code, email, address, phone (required), affiliation and accreditation numbers, website, logo.
  - Classification: board, centre type, centre category (School, College), centre class (required), category level, parent centre.
  - Location: country → state → district → region → area (required), with quick-add.
  - Finance: account number, GST enable (required), state or interstate, GST number.
  - Default Permission.
- **R-022 / R-022.02 / R-228 (SRC):** the centre list and view, credentials resend, and a status toggle.
- **Decisions (audit 04, PMC):**
  - D-ORG-1: centres are created Inactive and activated through a checklist and an approver.
  - D-ORG-2: the class can be revised (built: E-041).
  - D-ORG-3: Active status alone is enough to admit.
  - D-ORG-4: which of the ~60 flags are used.
  - D-ORG-5: region semantics.
  - D-ORG-6: lifecycle fields (status, open/close, franchise/own, agreement dates).
- **What exists:**
  - `app.centre` (code, name, area, class, `status` INACTIVE/ACTIVE, default INACTIVE), with RLS by scope. The app may change only `centre_class_id` (0017).
  - `region` and `area`: no RLS; `gems_app` has select only (T-SEC-007).
  - Centre list and view pages (read-only), and users, roles and assignments (WF-X13).
  - `admit()` and `createEnquiry()` do not check the centre's status.

## 2. Decisions taken under the owner's standing instruction (2026-10-29)

These are the recommended options, recorded as such, not as owner signatures. Business rules among them stay PMC.

- **DD-1:** head office creates and edits centres with a new permission, `org.centre.manage` (sensitive, ALL scope).
  - Fields: code, name, area, email, phone (required), address, centre category (SCHOOL, COLLEGE), GST (enabled; supply STATE or INTERSTATE and a GSTIN when enabled), ownership (FRANCHISE, OWN), agreement from/to, opened on.
  - Later: board, affiliation and accreditation, website, logo (needs storage, ADR-002), parent centre, account number.
- **DD-2:** a new centre is INACTIVE (D-ORG-1 default).
  - Activation needs `org.centre.manage`, a reason, and a checklist: a class is set, and the GST details are complete when GST is enabled.
  - Deactivation (soft close) needs a reason. History is the audit trail.
- **DD-3:** an INACTIVE centre cannot trade.
  - `admit()` and `createEnquiry()` refuse new admissions and enquiries there (D-ORG-3 default).
  - Existing records stay. Sign-in is not blocked: users of an inactive centre can still sign in, but cannot trade there.
- **DD-4:** regions and areas get quick-add pages under `org.centre.manage` (R-023's quick-add).
- **DD-5:** out of scope: credentials (use the existing user administration; the centre page links to it), the ~60 permission flags (D-ORG-4), prefixes and counters (unsigned numbering policy), and the QR code and logo (storage).
