// Usage (from the repo root, app running with TICKET_TEST_HANDLER=1 and real storage): node scripts/manual-supabase-run.mts [baseUrl]
// WARNING: resets the local Docker database (tests/fixtures.ts reset()).
// Manual Supabase run, part 2 (design Verification Plan, E2E): the real app (next start, TICKET_TEST_HANDLER=1,
// real Supabase Storage) over HTTP, as the browser would call it: upload request, PUT to storage, raise, approve at
// two levels, download. Local Docker database with the test fixtures. Prints a JSON report.
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { reset, tkToken } from "../tests/fixtures.ts";

const BASE = process.argv[2] ?? "http://localhost:3106";
const out: Record<string, unknown> = {};
const db = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
const cookie = (t: string) => ({ cookie: `__Host-gems_session=${t}`, origin: BASE });
const form = (t: string, path: string, fields: [string, string][]) => fetch(`${BASE}${path}`, {
  method: "POST", redirect: "manual", headers: { ...cookie(t), "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields),
});
const pdf = new TextEncoder().encode("%PDF-1.7\n%GEMS OMNIX manual Supabase run: certificate scan stand-in\n%%EOF\n");

await reset();
await db.connect();
try {
  await db.query(fs.readFileSync("tests/sql/ticket-test-handler.sql", "utf8"));
  const cat = (await q(`insert into app.ticket_category (name) values ('Student') returning id`))[0].id;
  const typeId = (await q(`insert into app.ticket_type (code, name, category_id, document_required, handler_key, number_prefix, active)
    values ('FNC', 'Name correction (test)', $1, true, 'test.counter', 'TK-26', true) returning id`, [cat]))[0].id;
  await q(`insert into app.ticket_type_level values ($1, 1, null, 11), ($1, 2, '00000000-0000-0000-0000-0000000000c3', null)`, [typeId]);

  // CSP on a real page carries the storage origin for uploads and the download redirect
  const csp = (await fetch(`${BASE}/login`)).headers.get("content-security-policy") ?? "";
  const origin = new URL(process.env["SUPABASE_URL"]!).origin;
  out.cspConnectSrcHasStorage = csp.includes(`connect-src 'self' ${origin}`);
  out.cspFormActionHasStorage = csp.includes(`form-action 'self' ${origin}`);

  // the raise form lists the type (handler registered by TICKET_TEST_HANDLER=1)
  const newPage = await fetch(`${BASE}/tickets/new?type=${typeId}&centre=1`, { headers: cookie(tkToken("raiser")) });
  out.raiseFormStatus = newPage.status;
  out.raiseFormShowsField = (await newPage.text()).includes('name="p.key"');

  // 1. upload request, 2. browser PUTs straight to Supabase
  const up = await fetch(`${BASE}/tickets/uploads`, { method: "POST", headers: { ...cookie(tkToken("raiser")), "content-type": "application/json" },
    body: JSON.stringify({ typeId, centreId: 1, fileName: "certificate.pdf", size: pdf.length, contentType: "application/pdf" }) });
  out.uploadRequest = up.status;
  const { uploadId, url } = (await up.json()) as { uploadId: string; url: string };
  out.uploadUrlOnStorage = url.startsWith(`${origin}/storage/v1/`);
  out.putToStorage = (await fetch(url, { method: "PUT", headers: { "content-type": "application/pdf" }, body: pdf })).status;

  // 3. raise
  const ticketId = randomUUID();
  const raised = await form(tkToken("raiser"), "/tickets/create", [["ticketId", ticketId], ["typeId", String(typeId)], ["centreId", "1"],
    ["p.key", "e2e"], ["uploadId", uploadId]]);
  out.raise = `${raised.status} -> ${new URL(raised.headers.get("location") ?? "/", BASE).pathname}`;
  out.raiseAgainSameFormId = `${(await form(tkToken("raiser"), "/tickets/create", [["ticketId", ticketId], ["typeId", String(typeId)], ["centreId", "1"],
    ["p.key", "e2e"]])).status} (redirect to the existing ticket, no second ticket)`;
  const [t] = await q(`select number, status::text, version from app.ticket where id = $1`, [ticketId]);
  out.ticket = t;
  out.ticketsCreated = (await q(`select count(*)::int n from app.ticket`))[0].n;
  out.document = (await q(`select content_type, size_bytes::int from app.ticket_document where ticket_id = $1`, [ticketId]))[0];

  // 4. approve at both levels through the act route
  const a1 = await form(tkToken("l1"), `/tickets/${ticketId}/act`, [["action", "approve"], ["seenVersion", "1"]]);
  const a2 = await form(tkToken("l2"), `/tickets/${ticketId}/act`, [["action", "approve"], ["seenVersion", "2"]]);
  out.approveLevel1 = `${a1.status} -> ${new URL(a1.headers.get("location") ?? "/", BASE).search || "(no error)"}`;
  out.approveLevel2 = `${a2.status} -> ${new URL(a2.headers.get("location") ?? "/", BASE).search || "(no error)"}`;
  out.afterApproval = (await q(`select status::text, current_level, version from app.ticket where id = $1`, [ticketId]))[0];
  out.domainChangeApplied = (await q(`select value from app.test_ticket_counter where key = 'e2e'`))[0]?.value;

  // 5. download: POST, 303 to a signed URL on storage, which returns the same bytes
  const docId = (await q(`select id from app.ticket_document where ticket_id = $1`, [ticketId]))[0].id;
  const dl = await form(tkToken("raiser"), `/tickets/${ticketId}/documents/${docId}`, []);
  const signed = dl.headers.get("location") ?? "";
  out.download = `${dl.status} -> ${signed.startsWith(`${origin}/storage/v1/object/sign/`) ? "signed storage URL" : signed.slice(0, 40)}`;
  const file = await fetch(signed);
  out.downloadedBytesMatch = file.status === 200 && Buffer.from(await file.arrayBuffer()).equals(Buffer.from(pdf));
  out.audit = (await q(`select action, outcome::text, count(*)::int n from app.audit_log where action like 'ticket.%' group by 1, 2 order by 1, 2`));

  // tidy: the uploaded object
  const key = (await q(`select storage_key from app.ticket_upload where id = $1`, [uploadId]))[0].storage_key;
  const s = process.env["SUPABASE_SERVICE_KEY"]!;
  out.cleanupStorage = (await fetch(`${origin}/storage/v1/object/${process.env["TICKET_BUCKET"]}`, { method: "DELETE",
    headers: { authorization: `Bearer ${s}`, apikey: s, "content-type": "application/json" }, body: JSON.stringify({ prefixes: [key] }) })).status;
} finally {
  await db.end();
}
console.log(JSON.stringify(out, null, 2));
