// Real-server security smoke (T-SEC-001/005/012/014 + security headers), run by scripts/ci.sh against `next start`.
// Creates its own data and sessions directly in the database (ADMIN_DATABASE_URL). Prints PASS/FAIL lines; exit 1 on any FAIL.
// Usage: node scripts/smoke-security.mjs [baseUrl]
import { createHash, randomBytes, randomUUID } from "node:crypto";
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

  // T-SEC-001 for tickets: a ticket at a hidden centre and a missing one give identical 404 pages. Fixtures are
  // inserted in the order the guard triggers require: OPEN at level 1, version 1; levels; then the RAISE event.
  const uid = async (login) => (await db.query(`select id from app.app_user where login = $1`, [login])).rows[0].id;
  const [viewerId, xssId] = [await uid("smoke.viewer"), await uid("smoke.xss")];
  const cat = (await db.query(`insert into app.ticket_category (name) values ('Smoke') returning id`)).rows[0].id;
  const type = (await db.query(`insert into app.ticket_type (code, name, category_id, handler_key, number_prefix, active)
    values ('SMK', 'Smoke type', $1, 'smoke.none', 'TK-26', true) returning id`, [cat])).rows[0].id;
  const smokeTicket = async (number, centre, raiser) => {
    const id = (await db.query(`insert into app.ticket (id, number, type_id, centre_id, raised_by, level_count, payload)
      values (gen_random_uuid(), $1, $2, $3, $4, 1, '{}') returning id`, [number, type, centre, raiser])).rows[0].id;
    await db.query(`insert into app.ticket_level (ticket_id, centre_id, level, approver_role_id) values ($1, $2, 1, $3)`, [id, centre, role]);
    await db.query(`insert into app.ticket_event (ticket_id, centre_id, actor_id, action, level) values ($1, $2, $3, 'RAISE', 1)`, [id, centre, raiser]);
    return id;
  };
  const ownTicket = await smokeTicket("TK-26/SMK/1", ids.A, viewerId); // the viewer raised it, so may view it
  const hiddenTicket = await smokeTicket("TK-26/SMK/2", ids.B, xssId);
  const tOwn = await get(`/tickets/${ownTicket}`, viewer);
  const [tHidden, tMissing] = [await get(`/tickets/${hiddenTicket}`, viewer), await get(`/tickets/${randomUUID()}`, viewer)];
  // uuids first: normal() strips digits after "k":", which would otherwise cut a uuid that starts with digits
  const normalT = (b) => normal(b.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "UUID"));
  const [th, tm] = [normalT(await tHidden.text()), normalT(await tMissing.text())];
  check("T-SEC-001 own-centre ticket 200", tOwn.status === 200 && (await tOwn.text()).includes("TK-26/SMK/1"), String(tOwn.status));
  check("T-SEC-001 hidden-centre ticket 404 and identical to a missing one", tHidden.status === 404 && tMissing.status === 404
    && th === tm && !th.includes("SMK/2"), th === tm ? "" : "pages differ");

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

  // ---------- admission screens (T-ADM-005, 404 parity, resubmit, button order, no personal data in URLs) ----------
  // catalogue, numbering and a student role at SMK-A; a learner at SMK-B by SQL
  await db.query(`insert into app.course_category (code, name) values ('SMK', 'Smoke') on conflict do nothing`);
  await db.query(`insert into app.course_division (code, name) values ('SMK', 'Smoke') on conflict do nothing`);
  await db.query(`insert into app.course (code, name, category_id, division_id) select 'SMKC', 'Smoke course', c.id, d.id
    from app.course_category c, app.course_division d where c.code = 'SMK' and d.code = 'SMK' on conflict do nothing`);
  await db.query(`insert into app.academic_year (code, starts_on, ends_on) values ('2026-27', '2026-06-01', '2027-05-31') on conflict do nothing`);
  await db.query(`insert into app.global_number_series (series, period, current) values ('REGISTER', 'ALL', 1), ('ADMISSION', '2026-27', 0) on conflict do nothing`);
  const studentRole = (await db.query(`insert into app.role (key, name) values ('smoke_student', 'Smoke student admin') returning id`)).rows[0].id;
  await db.query(`insert into app.role_permission (role_id, permission_key) values ($1, 'student.view'), ($1, 'student.admit')`, [studentRole]);
  const stuId = (await db.query(`insert into app.app_user (id, login, display_name) values (gen_random_uuid(), 'smoke.student', 'Smoke Student') returning id`)).rows[0].id;
  await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, $2, 'CENTRE', $3)`, [stuId, studentRole, ids.A]);
  const stu = randomBytes(32).toString("base64url");
  await db.query(`insert into app.app_session (token_hash, user_id, expires_at, step_up_at) values ($1, $2, now() + interval '1 hour', now())`, [sha(stu), stuId]);
  const bPerson = randomUUID();
  await db.query(`insert into app.person (id, given_name) values ($1, 'Hidden')`, [bPerson]);
  await db.query(`insert into app.admission (id, person_id, centre_id, academic_year, admission_no, admitted_on)
    values (gen_random_uuid(), $1, $2, '2026-27', 'SMK-HIDDEN-1', '2026-10-01')`, [bPerson, ids.B]);

  // a real multipart action post: the hidden $ACTION_* fields and admissionId copied from a freshly rendered form
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const learner = { centreId: String(ids.A), academicYear: "2026-27", admittedOn: "2026-10-28", givenName: "Smoke", familyName: "Learner",
    dateOfBirth: "2000-01-01", mobile: "9000012345", "course.1.courseCode": "SMKC", "course.1.joinDate": "2026-11-01",
    currentPincode: "682001", employmentStatus: "STUDENT", qualification: "SSLC" };
  const renderedForm = async () => {
    const page = await (await get("/students/new", stu)).text();
    const hidden = [...page.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)].map((m) => [m[0].match(/name="([^"]*)"/)?.[1], m[0].match(/value="([^"]*)"/)?.[1] ?? ""]);
    return hidden.filter(([name]) => name).map(([name, value]) => [decode(name), decode(value)]);
  };
  const actionPost = (hidden, origin, extra = {}) => {
    const body = new FormData();
    for (const [k, v] of hidden) body.append(k, v);
    for (const [k, v] of Object.entries({ ...learner, ...extra })) body.append(k, v);
    return fetch(`${BASE}/students/new`, { method: "POST", redirect: "manual", body,
      headers: { cookie: `__Host-gems_session=${stu}`, ...(origin ? { origin } : {}) } });
  };
  const admissions = async () => (await db.query(`select count(*)::int n from app.admission where centre_id = $1`, [ids.A])).rows[0].n;
  const admitAudits = async () => (await db.query(`select outcome from app.audit_log where action = 'person.admit' order by id`)).rows.map((r) => r.outcome);
  const formFields = await renderedForm();
  check("T-ADM-005 the rendered form carries the action fields and a form id",
    formFields.some(([k]) => k.startsWith("$ACTION_")) && formFields.some(([k]) => k === "admissionId"), formFields.map(([k]) => k).join(","));
  const foreign = await actionPost(formFields, "https://evil.example");
  const noOrigin = await actionPost(formFields, null);
  check("T-ADM-005 foreign-Origin action post refused by Next, Origin-less refused by the app (404); nothing written",
    foreign.status >= 400 && noOrigin.status === 404 && await admissions() === 0 && (await admitAudits()).length === 0, `${foreign.status} ${noOrigin.status}`);
  const ok = await actionPost(formFields, BASE);
  const location = ok.headers.get("location") ?? "";
  check("T-ADM-005 same-origin post admits and answers 303 to the learner", ok.status === 303 && /\/students\/[0-9a-f-]{36}$/.test(location)
    && await admissions() === 1 && JSON.stringify(await admitAudits()) === '["OK"]', `${ok.status} ${location}`);
  check("no personal data in the redirect", !/Smoke|Learner|9000012345|2000-01-01/.test(location));
  const again = await actionPost(formFields, BASE);
  const againHtml = await again.text();
  check("T-ADM-006 the same form posted again (before hydration) admits nothing and says so", again.status === 200
    && againHtml.includes("This form was already saved") && await admissions() === 1, String(again.status));
  const dup = await actionPost(await renderedForm(), BASE);
  const dupHtml = await dup.text();
  const [admitAt, candAt] = [dupHtml.indexOf(">Admit</button>"), dupHtml.indexOf('name="existingId"')];
  check("T-ADM-002 duplicate list shown; the main Admit button comes before every candidate button", dup.status === 200
    && candAt > 0 && admitAt > 0 && admitAt < candAt, `${admitAt} ${candAt}`);

  // 404 parity for learners
  const own = location.replace(/^.*\/students\//, "");
  const sOwn = await get(`/students/${own}`, stu);
  const [sHidden, sMissing, sBad] = [await get(`/students/${bPerson}`, stu), await get(`/students/${randomUUID()}`, stu), await get(`/students/not-a-uuid`, stu)];
  const [sh, sm] = [normalT(await sHidden.text()), normalT(await sMissing.text())];
  check("T-ADM-004 own learner 200", sOwn.status === 200 && (await sOwn.text()).includes("SMKC"), String(sOwn.status));
  check("T-ADM-004 other centre's learner 404 and identical to a missing one; malformed id 404", sHidden.status === 404 && sMissing.status === 404
    && sBad.status === 404 && sh === sm && !sh.includes("Hidden"), sh === sm ? `${sBad.status}` : "pages differ");
  const listHtml = await (await get("/students", stu)).text();
  check("T-ADM-004 list shows the own learner only, and has no GET search form", listHtml.includes("Learner") && !listHtml.includes("SMK-HIDDEN")
    && !/<form\b[^>]*method="get"/i.test(listHtml));

  // ---------- learner details (T-LD-002 pages, DD-12 default, 404 parity, origin) ----------
  const newForm = await (await get("/students/new", stu)).text();
  check("T-LD-001 the admit form defaults nationality to India", /<option value="IN" selected="">/.test(newForm));
  const editPath = `/students/${own}/details`;
  const editPage = await get(editPath, stu);
  const editHtml = await editPage.text();
  check("T-LD-002 own learner's edit page 200 with a version", editPage.status === 200 && /name="version" value="\d+"/.test(editHtml), String(editPage.status));
  const [eHidden, eMissing] = [await get(`/students/${bPerson}/details`, stu), await get(`/students/${randomUUID()}/details`, stu)];
  const [eh, em] = [normalT(await eHidden.text()), normalT(await eMissing.text())];
  // a user who may see the learner but not edit: the edit page is the same 404 (the page's own guard, not getPerson's)
  const viewRole = (await db.query(`insert into app.role (key, name) values ('smoke_student_view', 'Smoke student viewer') returning id`)).rows[0].id;
  await db.query(`insert into app.role_permission (role_id, permission_key) values ($1, 'student.view')`, [viewRole]);
  const svId = (await db.query(`insert into app.app_user (id, login, display_name) values (gen_random_uuid(), 'smoke.sview', 'Smoke Viewer') returning id`)).rows[0].id;
  await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, $2, 'CENTRE', $3)`, [svId, viewRole, ids.A]);
  const sv = randomBytes(32).toString("base64url");
  await db.query(`insert into app.app_session (token_hash, user_id, expires_at, step_up_at) values ($1, $2, now() + interval '1 hour', now())`, [sha(sv), svId]);
  const [svView, svEdit] = [await get(`/students/${own}`, sv), await get(editPath, sv)];
  const svHtml = await svView.text();
  check("T-LD-002 a view-only user sees the learner without an edit link, and the edit page is 404",
    svView.status === 200 && !svHtml.includes("Edit details") && svEdit.status === 404, `${svView.status} ${svEdit.status}`);
  check("T-LD-002 other centre's edit page 404 and identical to a missing one", eHidden.status === 404 && eMissing.status === 404 && eh === em,
    eh === em ? "" : "pages differ");
  const editHidden = [...editHtml.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)]
    .map((m) => [m[0].match(/name="([^"]*)"/)?.[1], m[0].match(/value="([^"]*)"/)?.[1] ?? ""]).filter(([k]) => k).map(([k, v]) => [decode(k), decode(v)]);
  const detailsPost = (origin) => {
    const body = new FormData();
    for (const [k, v] of editHidden) body.append(k, v);
    for (const [k, v] of Object.entries({ currentPincode: "682001", employmentStatus: "STUDENT", qualification: "SSLC", currentPlace: "Smoke town" })) body.append(k, v);
    return fetch(`${BASE}${editPath}`, { method: "POST", redirect: "manual", body, headers: { cookie: `__Host-gems_session=${stu}`, ...(origin ? { origin } : {}) } });
  };
  const detailAudits = async () => (await db.query(`select outcome from app.audit_log where action = 'person.details.update' order by id`)).rows.map((r) => r.outcome);
  const dNo = await detailsPost(null);
  check("T-LD-002 Origin-less details post refused (404), nothing written", dNo.status === 404 && (await detailAudits()).length === 0, String(dNo.status));
  const dOk = await detailsPost(BASE);
  check("T-LD-002 same-origin details post saves and answers 303 to the learner", dOk.status === 303
    && (dOk.headers.get("location") ?? "").endsWith(`/students/${own}`) && JSON.stringify(await detailAudits()) === '["OK"]', String(dOk.status));
  check("T-LD-002 the learner's page shows the saved detail", (await (await get(`/students/${own}`, stu)).text()).includes("Smoke town"));

  // ---------- correction tickets (T-COR-001 raise page, DD-12 message, T-COR-004 review, T-COR-006 hidden) ----------
  // types inserted active by SQL (the go-live gates guard switching on through the app, not raising)
  const corCat = (await db.query(`insert into app.ticket_category (name) values ('Smoke corrections') returning id`)).rows[0].id;
  const corRole = (await db.query(`insert into app.role (key, name) values ('smoke_corr', 'Smoke correction raiser') returning id`)).rows[0].id;
  await db.query(`insert into app.role_permission (role_id, permission_key) values ($1, 'ticket.raise'), ($1, 'ticket.view')`, [corRole]);
  await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, $2, 'CENTRE', $3)`, [stuId, corRole, ids.A]);
  const apprRole = (await db.query(`insert into app.role (key, name) values ('smoke_corr_appr', 'Smoke correction approver') returning id`)).rows[0].id;
  await db.query(`insert into app.role_permission (role_id, permission_key) values ($1, 'ticket.approve'), ($1, 'ticket.view')`, [apprRole]);
  const apprId = (await db.query(`insert into app.app_user (id, login, display_name) values (gen_random_uuid(), 'smoke.appr', 'Smoke Approver') returning id`)).rows[0].id;
  await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, $2, 'CENTRE', $3)`, [apprId, apprRole, ids.A]);
  const appr = randomBytes(32).toString("base64url");
  await db.query(`insert into app.app_session (token_hash, user_id, expires_at, step_up_at) values ($1, $2, now() + interval '1 hour', now())`, [sha(appr), apprId]);
  const corType = async (code, handler) => {
    const id = (await db.query(`insert into app.ticket_type (code, name, category_id, handler_key, number_prefix, active)
      values ($1, $1, $2, $3, 'TK-26', true) returning id`, [code, corCat, handler])).rows[0].id;
    await db.query(`insert into app.ticket_type_level (type_id, level, approver_role_id) values ($1, 1, $2)`, [id, apprRole]);
    await db.query(`insert into app.ticket_type_viewer (type_id, user_id) values ($1, $2)`, [id, viewerId]);
    return id;
  };
  const fnc = await corType("FNC", "identity.givenName");
  const gdr = await corType("GDR", "identity.gender");
  const gdrPage = await (await get(`/tickets/new?type=${gdr}&centre=${ids.A}`, stu)).text();
  check("T-COR-001 the gender correction offers a select", /<select name="p\.newValue" required="">/.test(gdrPage) && gdrPage.includes('value="MALE"'));
  const raiseCor = (fields) => fetch(`${BASE}/tickets/create`, { method: "POST", redirect: "manual",
    headers: { cookie: `__Host-gems_session=${stu}`, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ticketId: randomUUID(), typeId: String(fnc), centreId: String(ids.A), ...fields }) });
  const unknown = await raiseCor({ "p.admissionNo": "NO-SUCH", "p.newValue": "Renamed" });
  const unknownAt = unknown.headers.get("location") ?? "";
  const unknownPage = await (await get(unknownAt.replace(/^https?:\/\/[^/]+/, ""), stu)).text();
  check("T-COR-001 an unknown Admission No shows the handler's own message", unknown.status === 303
    && unknownAt.includes("detail=admission.unknown") && unknownPage.includes("No admission with that number at this centre."), unknownAt);
  const [{ admission_no: ownNo }] = (await db.query(`select admission_no from app.admission where person_id = $1`, [own])).rows;
  const raised = await raiseCor({ "p.admissionNo": ownNo, "p.newValue": "Smokey" });
  const corId = (raised.headers.get("location") ?? "").replace(/^.*\/tickets\//, "");
  check("T-COR-001 a valid correction is raised", raised.status === 303 && /^[0-9a-f-]{36}$/.test(corId), String(raised.status));
  const asAppr = await (await get(`/tickets/${corId}`, appr)).text();
  const reviews = (await db.query(`select count(*)::int n from app.audit_log where action = 'ticket.review.duplicates' and target_id = $1`, [corId])).rows[0].n;
  check("T-COR-004 the approver sees the request and the duplicate check, audited", asAppr.includes(">Old value</th>") && asAppr.includes(">Smoke<")
    && asAppr.includes("Duplicate check") && reviews === 1, String(reviews));
  const asViewer = await (await get(`/tickets/${corId}`, viewer)).text();
  check("T-COR-006 a ticket viewer without student.view sees no values", asViewer.includes("Request hidden") && !asViewer.includes("Smokey"));

  // unauthenticated access to scoped pages
  const anon = await get(`/centres/${ids.A}`);
  check("no session: scoped page redirects to /login", [303, 307, 308].includes(anon.status) && (anon.headers.get("location") ?? "").includes("/login"), String(anon.status));
} finally {
  await db.end();
}
console.log(failed ? `${failed} check(s) FAILED` : "all security smoke checks passed");
process.exit(failed ? 1 : 0);
