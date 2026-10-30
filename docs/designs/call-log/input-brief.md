# Phone call log (tenth Stage 3 piece, WF-X16): input brief for `egm-draft`

Prepared 2026-10-30 from the SPEC (pp. 5, 33–34), the enquiry design and the built code. Owner, 2026-10-30: "keep going with everything planned". Stage 3 in roadmap order: WF-X16 (front office and call log, R-080, R-084) is the last specified Stage 3 workflow.

Evidence classes: SRC, INF, PRO, PMC. Nothing here is approved.

## 1. What it is (SRC)
- **R-084 Phone Call Log** (SPEC p. 34):
  - Form fields: Centre (required), Name, Phone (required), Date, Description, Next Follow Up Date, Call Duration, Note, Call Type (required: Incoming, Outgoing), Tele Caller Name.
  - Table columns: Name, Phone, Date, Next Follow Up Date, Call Type, Action.
- **R-080 Set Up Front Office** (SPEC p. 33): four masters (visitor purpose, complaint type, source, reference), each with a name and a description. The matrix records "usage unchecked".

## 2. What exists (SRC, code)
- **The enquiry funnel (E-042).** The enquiry design records follow-ups on an enquiry as R-084. It names "a general call log not tied to an enquiry (R-084 standalone)" and "the front-office masters (R-080)" as non-goals (`docs/designs/enquiry/enquiry.md:29, :49`).
- **Permissions** `enquiry.view` and `enquiry.manage` (centre-scoped).
- **The append-only follow-up log**, with an actor trigger and immutability triggers (0018).
- **The counsellor picker** `app.enquiry_counsellors(centre)` and `app.enquiry_may_receive(centre, user)` (0018).
- **`phoneDigits`** (details.ts) and **`ownText`**.

## 3. Decisions taken under the owner's standing instruction (2026-10-29), re-confirmed 2026-10-30
These are recommended options, recorded as such, not as owner signatures.

- **DD-1: a general call log per centre** (R-084 standalone).
  - Fields:
    - phone (required, `phoneDigits`);
    - name (optional);
    - call date (default today, IST; not in the future);
    - call type (INCOMING, OUTGOING);
    - duration in minutes (0–600, PMC);
    - description and note (multiline, optional);
    - next follow-up date (optional, not before the call date);
    - tele-caller (a user who may receive enquiries at that centre; default the person logging).
  - The person logging is recorded by the database.
- **DD-2: reuse the enquiry permissions.** `enquiry.view` reads a centre's calls, and `enquiry.manage` logs them. Calls are front-office CRM work by the same people. An inactive centre logs no calls (centre onboarding DD-3).
- **DD-3: entries are append-only**, like enquiry follow-ups. A correction is a new entry, and the log is the audit trail.
- **DD-4: the list** shows a centre's calls, newest first. It filters by date range, call type, and "follow-up due by". A phone search counts against the search rate limit (T-SEC-015). A "New enquiry" link is shown, without pre-filled values: no personal data in URLs, as in the enquiry design.
- **DD-5: R-080 masters are deferred.** No specified screen uses visitor purpose or complaint type. Enquiry paths and types already cover source. Record them as PRO to confirm (D-GAP-2).
