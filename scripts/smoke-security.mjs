// Real-server security smoke (T-SEC-001/005/012/014 + security headers), run by scripts/ci.sh against `next start`.
// Creates its own data and sessions directly in the database (ADMIN_DATABASE_URL). Prints PASS/FAIL lines; exit 1 on any FAIL.
// Usage: node scripts/smoke-security.mjs [baseUrl]
import { createHash, randomBytes } from "node:crypto";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
const BASE = process.argv[2] ?? "http://localhost:3101";
const db = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
const sha = (t) => createHash("sha256").update(t, "utf8").digest();
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const get = (path, token) => fetch(`${BASE}${path}`, { redirect: "manual", headers: token ? { cookie: `__Host-gems_session=${token}` } : {} });

await db.connect();
const ids = {};
try {
  // two regions, one centre each; a viewer for centre A only; a user whose display name is an XSS payload
  ids.r1 = (await db.query(`insert into app.region (code, name) values ('SR1', 'Smoke R1') returning id`)).rows[0].id;
  ids.r2 = (await db.query(`insert into app.region (code, name) values ('SR2', 'Smoke R2') returning id`)).rows[0].id;
  const a1 = (await db.query(`insert into app.area (region_id, name) values ($1, 'Smoke A1') returning id`, [ids.r1])).rows[0].id;
  const a2 = (await db.query(`insert into app.area (region_id, name) values ($1, 'Smoke A2') returning id`, [ids.r2])).rows[0].id;
  ids.A = (await db.query(`insert into app.centre (code, name, area_id, status) values ('SMK-A', 'Smoke Centre A', $1, 'ACTIVE') returning id`, [a1])).rows[0].id;
  ids.B = (await db.query(`insert into app.centre (code, name, area_id, status) values ('SMK-B', 'Smoke Centre B', $1, 'ACTIVE') returning id`, [a2])).rows[0].id;
  const role = (await db.query(`insert into app.role (key, name) values ('smoke_viewer', 'Smoke viewer') returning id`)).rows[0].id;
  await db.query(`insert into app.role_permission (role_id, permission_key) values ($1, 'org.centre.view'), ($1, 'org.centre.export')`, [role]);
  const user = async (login, display) => {
    const id = (await db.query(`insert into app.app_user (id, login, display_name) values (gen_random_uuid(), $1, $2) returning id`, [login, display])).rows[0].id;
    await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, $2, 'CENTRE', $3)`, [id, role, ids.A]);
    const token = randomBytes(32).toString("base64url");
    await db.query(`insert into app.app_session (token_hash, user_id, expires_at, step_up_at) values ($1, $2, now() + interval '1 hour', now())`, [sha(token), id]);
    return token;
  };
  const viewer = await user("smoke.viewer", "Smoke Viewer");
  const xss = await user("smoke.xss", `<script>alert("xss")</script><img src=x onerror=alert(1)>`);

  // security headers + CSP nonce on a public page
  const r1 = await get("/login");
  const r2 = await get("/login");
  const csp = r1.headers.get("content-security-policy") ?? "";
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  check("CSP present with a nonce, strict script-src, no unsafe-inline", !!nonce && /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp) && !csp.includes("unsafe-inline"), csp.slice(0, 80));
  check("nonce is fresh per request", !!nonce && nonce !== (r2.headers.get("content-security-policy") ?? "").match(/'nonce-([^']+)'/)?.[1]);
  const html = await r1.text();
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  check("every <script> carries the request nonce", scripts.length > 0 && scripts.every((s) => s.includes(`nonce="${nonce}"`)), `${scripts.length} scripts`);
  check("frame-ancestors 'none' and X-Frame-Options DENY", csp.includes("frame-ancestors 'none'") && r1.headers.get("x-frame-options") === "DENY");
  check("nosniff, referrer policy, HSTS, permissions policy", r1.headers.get("x-content-type-options") === "nosniff"
    && !!r1.headers.get("referrer-policy") && /max-age=\d+/.test(r1.headers.get("strict-transport-security") ?? "") && !!r1.headers.get("permissions-policy"));
  check("no X-Powered-By", !r1.headers.has("x-powered-by"));

  // T-SEC-001: out of scope and nonexistent are indistinguishable
  const inScope = await get(`/centres/${ids.A}`, viewer);
  const other = await get(`/centres/${ids.B}`, viewer);
  const missing = await get(`/centres/987654321`, viewer);
  const [otherBody, missingBody] = [await other.text(), await missing.text()];
  check("T-SEC-001 own centre 200", inScope.status === 200, String(inScope.status));
  // the pages may differ only in the per-request nonce and the echo of the requested id (which the client already knows)
  const normal = (b) => b.replace(/nonce="[^"]+"|'nonce-[^']+'/g, "").replace(/(\\"k\\":\\")\d+/g, "$1ID").replace(/("k":")\d+/g, "$1ID")
    .replace(/(\\"centres\\",\\")\d+/g, "$1ID").replace(/("centres",")\d+/g, "$1ID")
    .replace(/(\\"nonce\\":\\")[^\\"]+/g, "$1N").replace(/("nonce":")[^"]+/g, "$1N").replace(/\/centres\/\d+/g, "/centres/ID");
  const [no, nm] = [normal(otherBody), normal(missingBody)];
  let at = 0;
  while (at < Math.min(no.length, nm.length) && no[at] === nm[at]) at++;
  check("T-SEC-001 other centre 404 and identical to a missing one", other.status === 404 && missing.status === 404
    && no === nm && !otherBody.includes("SMK-B"), no === nm ? "" : `differs at ${at}: ${JSON.stringify(no.slice(at - 30, at + 30))} vs ${JSON.stringify(nm.slice(at - 30, at + 30))}`);

  // T-SEC-005: crafted filters on the list
  const list = await (await get(`/centres?centre=${ids.A}&centre=${ids.B}&region=${ids.r1}&region=${ids.r2}`, viewer)).text();
  check("T-SEC-005 crafted filters show only the in-scope centre", list.includes("SMK-A") && !list.includes("SMK-B"));
  const search = await (await get(`/centres?q=SMK-B`, viewer)).text();
  check("T-SEC-005 search cannot find out-of-scope rows", !search.includes("Smoke Centre B"));

  // T-SEC-014: stored script payload is rendered inert
  const home = await (await get("/", xss)).text();
  check("T-SEC-014 XSS payload escaped in HTML", home.includes("&lt;script&gt;alert(") && !home.includes(`<script>alert("xss")`) && !home.includes("<img src=x"));

  // T-SEC-012: an unexpected failure in a route yields a generic message and a reference only
  const bad = await fetch(`${BASE}/auth/login`, { method: "POST", redirect: "manual", headers: { origin: BASE, "content-type": "text/plain" }, body: "not a form" });
  const badBody = await bad.text();
  check("T-SEC-012 generic 500 with reference, no internals", bad.status === 500 && /^Something went wrong\. Reference: [0-9a-f-]{36}$/.test(badBody)
    && bad.headers.get("x-request-id") !== null, `${bad.status} ${badBody.slice(0, 60)}`);

  // T-SEC-006: export with crafted filters over real HTTP
  const exportReq = (origin) => fetch(`${BASE}/export/centres`, { method: "POST", redirect: "manual",
    headers: { cookie: `__Host-gems_session=${viewer}`, "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) },
    body: new URLSearchParams([["centre", String(ids.A)], ["centre", String(ids.B)], ["region", String(ids.r1)], ["region", String(ids.r2)]]) });
  check("T-SEC-006 export from a foreign origin is refused", (await exportReq("https://evil.example")).status === 403);
  const exp = await exportReq(BASE);
  const csv = await exp.text();
  check("T-SEC-006 export holds only in-scope rows, as an uncached attachment", exp.status === 200
    && /^attachment; filename="centres-/.test(exp.headers.get("content-disposition") ?? "") && exp.headers.get("cache-control") === "no-store"
    && csv.includes("SMK-A") && !csv.includes("SMK-B"), `${exp.status} ${csv.trimEnd().split(/\r?\n/).length - 1} data rows`);

  // T-AUD-001 over HTTP: the request id the user sees is the one on the audit row (support can trace a report)
  const rid = exp.headers.get("x-request-id");
  const auditRow = (await db.query(`select request_id from app.audit_log where action = 'export.centres' and outcome = 'OK' order by id desc limit 1`)).rows[0];
  check("T-AUD-001 response X-Request-Id equals the audit row's request_id", !!rid && /^[0-9a-f-]{36}$/.test(rid) && auditRow?.request_id === rid, `${rid} vs ${auditRow?.request_id}`);

  // unauthenticated access to scoped pages
  const anon = await get(`/centres/${ids.A}`);
  check("no session: scoped page redirects to /login", [303, 307, 308].includes(anon.status) && (anon.headers.get("location") ?? "").includes("/login"), String(anon.status));
} finally {
  await db.end();
}
console.log(failed ? `${failed} check(s) FAILED` : "all security smoke checks passed");
process.exit(failed ? 1 : 0);
