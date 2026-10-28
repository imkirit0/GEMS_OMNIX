// Create or update the private ticket-document bucket (ADR-002; design item 9a). Run by hand, once per environment,
// by whoever holds the Supabase service key. Not run by CI. The limits come from TICKET_POLICY, the one source.
// Usage: SUPABASE_URL=… SUPABASE_SERVICE_KEY=… TICKET_BUCKET=… node scripts/storage-setup.mjs
import { TICKET_POLICY } from "../src/server/tickets/policy.ts"; // Node 24 runs erasable TypeScript

const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_KEY;
const bucket = process.env.TICKET_BUCKET;
if (!base || !key || !bucket) {
  console.error("set SUPABASE_URL, SUPABASE_SERVICE_KEY and TICKET_BUCKET");
  process.exit(2);
}

const want = {
  public: false,
  file_size_limit: TICKET_POLICY.maxFileBytes,
  allowed_mime_types: TICKET_POLICY.fileTypes.map((f) => f.mime),
};
const headers = { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" };
const api = (path, init = {}) => fetch(`${base}/storage/v1${path}`, { ...init, headers });

const got = await api(`/bucket/${encodeURIComponent(bucket)}`);
if (got.status === 404 || got.status === 400) {
  const r = await api("/bucket", { method: "POST", body: JSON.stringify({ id: bucket, name: bucket, ...want }) });
  if (!r.ok) { console.error(`create failed: ${r.status}`); process.exit(1); }
  console.log(`created private bucket ${bucket}`, want);
} else if (got.ok) {
  const b = await got.json();
  const same = b.public === false && b.file_size_limit === want.file_size_limit
    && JSON.stringify([...(b.allowed_mime_types ?? [])].sort()) === JSON.stringify([...want.allowed_mime_types].sort());
  if (same) {
    console.log(`bucket ${bucket} already matches`, want);
  } else {
    const r = await api(`/bucket/${encodeURIComponent(bucket)}`, { method: "PUT", body: JSON.stringify(want) });
    if (!r.ok) { console.error(`update failed: ${r.status}`); process.exit(1); }
    console.log(`updated bucket ${bucket}`, { was: { public: b.public, file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types }, now: want });
  }
} else {
  console.error(`could not read bucket: ${got.status}`);
  process.exit(1);
}
