// Usage (repo root, STORAGE_DRIVER unset, Supabase variables set): node scripts/manual-supabase-storage-probe.mts
// Manual Supabase run, part 1 (ADR-002 §6): storage call shapes through our own driver, overwrite refusal,
// Range support, type limit, upload URL validity, and the Data API exposure check (DD-15). Cleans up after itself.
import { randomUUID } from "node:crypto";
import { storage } from "../src/server/storage.ts";

const base = process.env.SUPABASE_URL!.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_KEY!;
const bucket = process.env.TICKET_BUCKET!;
const auth = { authorization: `Bearer ${key}`, apikey: key };
const out: Record<string, unknown> = {};
const pdf = new TextEncoder().encode("%PDF-1.7\n%probe document for the GEMS OMNIX ticket engine\n%%EOF\n");
const keys: string[] = [];
const fresh = () => { const k = `uploads/probe/${randomUUID()}`; keys.push(k); return k; };
const s = await storage();

try {
  // 1. signed upload URL + PUT
  const k1 = fresh();
  const url = await s.signedUploadUrl(k1);
  out.uploadUrlIsAbsoluteOnProject = url.startsWith(`${base}/storage/v1/`);
  const token = new URL(url).searchParams.get("token");
  if (token) { const p = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()); out.uploadUrlValiditySeconds = p.exp - p.iat; }
  const put1 = await fetch(url, { method: "PUT", headers: { "content-type": "application/pdf" }, body: pdf });
  out.put1 = put1.status;
  // 2. overwrite refused: the same URL again, and a new URL for the same key
  const put2 = await fetch(url, { method: "PUT", headers: { "content-type": "application/pdf" }, body: new TextEncoder().encode("%PDF-evil") });
  out.secondPutSameUrl = put2.status;
  const url2 = await s.signedUploadUrl(k1).catch((e: Error) => `refused: ${e.message}`);
  out.newUploadUrlSameKey = url2.startsWith("refused") ? url2 : (await fetch(url2, { method: "PUT", headers: { "content-type": "application/pdf" }, body: new TextEncoder().encode("%PDF-evil") })).status;
  // 3. Range: raw status, then our head()
  const raw = await fetch(`${base}/storage/v1/object/authenticated/${bucket}/${k1}`, { headers: { ...auth, range: "bytes=0-15" } });
  out.rangeStatus = raw.status;
  out.contentRange = raw.headers.get("content-range");
  await raw.arrayBuffer();
  const h = await s.head(k1, 16);
  out.headFirstBytesArePdf = !!h && new TextDecoder().decode(h.bytes).startsWith("%PDF-1.7");
  out.headTotalSizeMatches = h?.totalSize === pdf.length;
  out.contentUnchangedAfterOverwriteAttempts = !!h && new TextDecoder().decode(h.bytes).startsWith("%PDF-1.7");
  out.headMissingIsNull = (await s.head(`uploads/probe/${randomUUID()}`, 16)) === null;
  // 4. signed download
  const dl = await s.signedDownloadUrl(k1, 60);
  out.downloadUrlIsAbsoluteOnProject = dl.startsWith(`${base}/storage/v1/`);
  const got = await fetch(dl);
  out.downloadStatus = got.status;
  out.downloadBytesMatch = Buffer.from(await got.arrayBuffer()).equals(Buffer.from(pdf));
  // 5. bucket type limit
  const k2 = fresh();
  const u2 = await s.signedUploadUrl(k2);
  out.textPlainUpload = (await fetch(u2, { method: "PUT", headers: { "content-type": "text/plain" }, body: "hello" })).status;
  // 6. no anonymous access to the private bucket
  out.publicUrlStatus = (await fetch(`${base}/storage/v1/object/public/${bucket}/${k1}`)).status;
  // 7. DD-15: the Data API must not expose schema app
  const spec = await fetch(`${base}/rest/v1/`, { headers: { ...auth, accept: "application/openapi+json" } });
  const specText = await spec.text();
  out.restRootStatus = spec.status;
  out.openApiMentionsAppTables = /"\/(ticket|app_user|audit_log|centre|role_assignment)"/.test(specText);
  const asApp = await fetch(`${base}/rest/v1/app_user?select=id&limit=1`, { headers: { ...auth, "accept-profile": "app" } });
  out.appSchemaRequestStatus = asApp.status;
  out.appSchemaRequestCode = ((await asApp.json().catch(() => ({}))) as { code?: string }).code;
} finally {
  const del = await fetch(`${base}/storage/v1/object/${bucket}`, { method: "DELETE", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ prefixes: keys }) });
  out.cleanup = `${del.status}, ${keys.length} key(s)`;
}
console.log(JSON.stringify(out, null, 2));
