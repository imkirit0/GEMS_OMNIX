# ADR-002: Document storage for tickets

| Item | Value |
|---|---|
| Status | **Proposed** (2026-10-28). Becomes Accepted when the owner signs §7 |
| Date | 2026-10-28 |
| Decides | Where ticket documents are stored, how they are uploaded and downloaded, and which key the server uses (ticket-engine design DD-4, DD-6, DD-15, DD-16; Q9) |
| Source | `docs/designs/ticket-engine/ticket-engine.md` (Approved 2026-10-28), §Storage, §Actions › Raise, §Risks and Mitigations |
| Open decision | D-STO-1 (upload limits), owner IT + Legal (`docs/audit/04-manager-decision-register.md`) |

## 1. Context

Some ticket types need a supporting document, such as a certificate scan for a name correction (T-TKT-001). Documents may contain personal data (D-SEC-4). The application runs on Vercel, which caps a function's request body at 4.5 MB, and uses Supabase Postgres with its own first-party authentication (ADR-001), not Supabase Auth.

No ticket type goes live in Stage 2 (design DD-2). Storage is built now on purpose, to settle this decision early and to prove the upload path before domain modules depend on it (DD-4).

## 2. Decision

1.  **Store** documents in a **private Supabase Storage bucket** (`TICKET_BUCKET`). Our own code checks access: the bucket is never public and has no storage policies for end users.
2.  **Upload directly from the browser** with a signed upload URL per file (DD-6), because files must be allowed up to 10 MB and the function body cap is 4.5 MB.
    *   The server issues the URL only for a type that is active and requires a document (DD-16), so in Stage 2 every upload is refused.
    *   Upload URLs are created with `x-upsert: false`, so a stored object cannot be replaced after it is checked.
    *   Supabase sets the URL's validity; the manual Supabase run records it.
3.  **Check before attaching.** At raise, the server reads the first 16 bytes and the real total size of each object (a Range request), refuses it unless both match the limits, and stores the content type detected from the file signature, never the one the browser declared.
4.  **Download** through a same-origin POST that is authorised (`ticket.document.view`), audited (`ticket.document.download`), and answered with a 303 redirect to a **signed URL valid for 60 seconds**. The Content-Security-Policy allows the Supabase origin in `connect-src` (upload) and `form-action` (the redirect).
5.  **Server key.** The server holds the Supabase service key (`SUPABASE_SERVICE_KEY`) and never sends it to the browser; the client-bundle scan checks this (T-SEC-017). See §4 for its limits (DD-15).
6.  **CI and tests** use an in-memory fake driver (`STORAGE_DRIVER=fake`), which refuses to load on any Vercel deployment.
7.  **Bucket set-up** is done by hand once per environment with `scripts/storage-setup.mjs`, which takes the size and type limits from `TICKET_POLICY` (`src/server/tickets/policy.ts`).

## 3. Limits (D-STO-1, PMC, not approved)

| Limit | Proposed default |
|---|---|
| Maximum file size | 10 MB |
| Allowed types | PDF, JPEG, PNG, checked by file signature |
| Files per ticket | 5 |
| Unattached uploads | Deleted after 24 hours by a daily job: a **go-live gate** for the first type with `document_required` (DD-16) |
| Upload request rate | Per-user limit, reusing the export rate-limit pattern: a **go-live gate** (DD-16) |
| Retention of attached documents | Open: owner IT + Legal |
| Virus scan before go-live | Open: owner IT + Legal |

## 4. Consequences and risks

*   **Service-key blast radius (DD-15).** The service key can also reach Supabase's Data API, which bypasses row-level security.
    *   Before any production upload, a recorded check must confirm that the Data API does not expose schema `app` (our tables), and the result goes in the evidence log.
    *   If the check fails, or IT prefers it, use Supabase Storage's S3 access keys, which are storage-only, at the cost of request signing (SigV4) without an SDK.
*   **Signed URLs show the bucket name and object key.** Accepted: keys are random ids, the bucket is private, and download URLs expire after 60 seconds.
*   **A long-lived upload URL** can write only its own key, and only its requester can attach the result; checks run at attach.
*   **No new dependency.** Storage uses three `fetch` calls behind `src/server/storage.ts`, so Supabase can be swapped later.

## 5. Alternatives considered

The design's Alternatives G to J record these:
*   Document references only, or blocking types that need documents (G)
*   The Supabase JavaScript SDK (H): it assumes Supabase Auth
*   Uploading through our own server (I): blocked by the 4.5 MB body cap
*   Postgres `bytea`, Vercel Blob, or S3 keys (J)

## 6. Verification

The manual Supabase run (design, Verification Plan) confirms:
*   the three storage call shapes;
*   that Range requests are honoured;
*   that a second PUT to the same key is refused;
*   that the download redirect is followed;
*   the upload URL's validity period.

It also records the Data API check in §4. The results go in the evidence log.

**Result (2026-10-28, E-027, `evidence/manual-supabase-run-2026-10-28T130635.txt`):**
*   **Calls:** all three call shapes work through `src/server/storage.ts`.
*   **Range:** honoured (206, `bytes 0-15/64`).
*   **Overwrite:** a second PUT to the same key is refused (400), and so is a new upload link for an existing key.
*   **Limits:** the bucket's type limit refuses `text/plain` (400), and the anonymous public URL is refused (400).
*   **Upload link:** valid for **7,200 seconds** (2 hours), set by Supabase.
*   **Data API check (§4):** passed. The REST listing shows no `app` tables, and a request for schema `app` is refused (406, PGRST106).
*   **End to end:** the app (production build, test handler, real storage) completed upload, raise, approval at two levels and download over HTTP, and the downloaded bytes matched.
*   **Not yet checked:** a real browser following the download redirect under the CSP `form-action` rule, and the browser PUT under CORS. The CSP header carries the storage origin.

## 7. Approval

| Role | Name | Decision | Date |
|---|---|---|---|
| Project owner | | | |
| IT (owner) | | | |
| Legal (D-STO-1, D-SEC-4) | | | |
