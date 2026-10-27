// Exports (P7): T-SEC-006, T-SEC-015, T-RPT-010, T-RPT-011, T-RPT-012, T-RPT-013, T-RLS-011.
import { beforeEach, describe, expect, test } from "vitest";
import { Forbidden } from "../src/server/action";
import { csvCell, EXPORT_POLICY, exportCsv, RateLimited } from "../src/server/exports";
import { POST as exportRoute } from "../app/export/[dataset]/route";
import { SESSION_COOKIE } from "../src/server/auth/http";
import { asAdmin, C, reset, T } from "./fixtures";

const UA = "00000000-0000-0000-0000-00000000000a";
const HO = "00000000-0000-0000-0000-0000000000ff";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}
const lines = (csv: string) => csv.trimEnd().split("\r\n");
const lastExportAudit = () => asAdmin((db) => db.query(`select outcome, detail from app.audit_log where action like 'export.%' order by id desc limit 1`).then((r) => r.rows[0]));

beforeEach(async () => {
  await reset();
  await asAdmin(async (db) => {
    await db.query(`insert into app.permission (key, description, sensitive) values
      ('org.centre.export', 'Export centres', false), ('rbac.user.export', 'Export users', true), ('pii.export', 'PII in exports', true)`);
    await db.query(`insert into app.role (id, key, name) values (91, 'centre_exporter', 'Centre exporter'), (92, 'user_exporter', 'User exporter'), (93, 'pii', 'PII')`);
    await db.query(`insert into app.role_permission values (91, 'org.centre.export'), (92, 'rbac.user.export'), (93, 'pii.export')`);
    await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 91, 'CENTRE', 1)`, [UA]);
    await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind) values ($1, 91, 'ALL'), ($1, 92, 'ALL')`, [HO]);
  });
});

describe("exports", () => {
  test("T-SEC-006 / T-RLS-011 tampered filters export only in-scope rows; T-RPT-010 audit records the actual scope", async () => {
    const filters = { centreIds: [C.A, C.B, C.A2], regionIds: [1, 2] };
    const { stream } = await exportCsv(T.uA, "centres", filters);
    const out = lines(await readAll(stream));
    expect(out[0]).toBe("Code,Name,Area,Region,Status");
    expect(out.slice(1)).toEqual(["KL2-25,Centre A,A1,R1,ACTIVE"]);
    const audit = await lastExportAudit();
    expect(audit.outcome).toBe("OK");
    expect(audit.detail).toMatchObject({ requested: filters, scope: [C.A], rows: 1, columns: ["code", "name", "area", "region", "status"], piiOmitted: [], cancelled: false });
  });

  test("export permission is required; denials are audited", async () => {
    for (const tok of [T.uB, T.hoR1]) await expect(exportCsv(tok, "centres")).rejects.toBeInstanceOf(Forbidden);
    await expect(exportCsv(T.uA, "users")).rejects.toBeInstanceOf(Forbidden);
    await expect(exportCsv(T.uA, "no-such-dataset")).rejects.toBeInstanceOf(Forbidden);
    expect((await asAdmin((db) => db.query(`select count(*)::int n from app.audit_log where action like 'export.%' and outcome = 'DENIED'`))).rows[0].n).toBe(3);
  });

  test("T-RPT-011 personal-data columns only with pii.export; otherwise left out and the audit says so", async () => {
    const without = await exportCsv(T.hoAll, "users");
    expect(lines(await readAll(without.stream))[0]).toBe("Status,Two-step required,Roles");
    expect((await lastExportAudit()).detail.piiOmitted).toEqual(["login", "display_name"]);
    await asAdmin((db) => db.query(`insert into app.role_assignment (user_id, role_id, scope_kind) values ($1, 93, 'ALL')`, [HO]));
    const withPii = await exportCsv(T.hoAll, "users");
    const out = lines(await readAll(withPii.stream));
    expect(out[0]).toBe("Login,Name,Status,Two-step required,Roles");
    expect(out.some((l) => l.startsWith("hoall,HO All,ACTIVE"))).toBe(true);
  });

  test("T-RPT-012 batch boundaries never duplicate or lose a row", async () => {
    await asAdmin((db) => db.query(`insert into app.centre (code, name, area_id, status) select 'PG-' || g, 'Paged ' || g, 1, 'ACTIVE' from generate_series(1, 1234) g`));
    const { stream } = await exportCsv(T.hoAll, "centres", {}, { batch: 100 });
    const rows = lines(await readAll(stream)).slice(1);
    const expected = await asAdmin((db) => db.query(`select count(*)::int n from app.centre`).then((r) => r.rows[0].n));
    expect(rows).toHaveLength(expected);
    expect(new Set(rows.map((r) => r.split(",")[0])).size).toBe(expected);
  });

  test("T-RPT-013 200,000 rows stream with bounded memory and respect a slow reader", async () => {
    // realistic shape: many rows, few centres (production has ~327 centres; big tables are per-centre rows)
    await asAdmin((db) => db.query(`insert into app.app_user (id, login, display_name) select gen_random_uuid(), 'bulk' || g, 'Bulk user number ' || g from generate_series(1, 200000) g`));
    let fetched = 0;
    const { stream } = await exportCsv(T.hoAll, "users", {}, { batch: 1000, onBatch: () => { fetched++; } });
    const reader = stream.getReader();
    const t0 = Date.now();
    const base = process.memoryUsage().heapUsed;
    let peak = 0, bytes = 0, rows = 0;
    // read one chunk, then pause: a producer without backpressure would race ahead and buffer the table
    const first = await reader.read();
    bytes += first.value!.byteLength;
    await new Promise((r) => setTimeout(r, 500));
    const fetchedWhilePaused = fetched;
    const afterPause = (await asAdmin((db) => db.query(`select count(*)::int n from app.audit_log where action = 'export.users'`))).rows[0].n;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      rows += new TextDecoder().decode(value).split("\r\n").length - 1;
      peak = Math.max(peak, process.memoryUsage().heapUsed - base);
    }
    const ms = Date.now() - t0;
    console.log(`T-RPT-013 ${bytes} bytes, ${fetched} batches, ${fetchedWhilePaused} fetched while the reader was stalled, peak heap growth ${(peak / 1048576).toFixed(1)} MB, ${ms} ms`);
    expect(afterPause).toBe(0); // export not finished while the reader paused
    expect(fetchedWhilePaused).toBeLessThanOrEqual(3); // stalled reader => producer stops at the queue limit (bounded by construction)
    expect(rows).toBeGreaterThanOrEqual(200_000);
    expect(peak).toBeLessThan(512 * 1048576); // PERF-04 PROPOSED threshold (01 C-06); heap peaks without forced GC are noisy
    expect(ms).toBeLessThan(EXPORT_POLICY.timeoutMs);
  }, 180_000);

  test("a reader that cancels leaves an audit row with the rows actually sent", async () => {
    await asAdmin((db) => db.query(`insert into app.centre (code, name, area_id, status) select 'CX-' || g, 'C' || g, 1, 'ACTIVE' from generate_series(1, 5000) g`));
    const { stream } = await exportCsv(T.hoAll, "centres", {}, { batch: 100 });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    let audit;
    for (let i = 0; i < 50 && !audit; i++) { audit = await lastExportAudit(); if (!audit) await new Promise((r) => setTimeout(r, 100)); }
    expect(audit.detail.cancelled).toBe(true);
    expect(audit.detail.rows).toBeLessThan(5000);
  });

  test("an export that is never read opens no transaction (no connection or locks held)", async () => {
    const before = await asAdmin((db) => db.query(`select count(*)::int n from pg_stat_activity where usename = 'gems_app' and state like 'idle in transaction%'`).then((r) => r.rows[0].n));
    const { stream } = await exportCsv(T.uA, "centres");
    await new Promise((r) => setTimeout(r, 300));
    const during = await asAdmin((db) => db.query(`select count(*)::int n from pg_stat_activity where usename = 'gems_app' and state like 'idle in transaction%'`).then((r) => r.rows[0].n));
    expect(during).toBe(before);
    await stream.cancel();
  });

  test("T-SEC-015 exports are rate limited per user", async () => {
    for (let i = 0; i < EXPORT_POLICY.perWindow; i++) await readAll((await exportCsv(T.uA, "centres")).stream);
    await expect(exportCsv(T.uA, "centres")).rejects.toBeInstanceOf(RateLimited);
    await expect(exportCsv(T.hoAll, "centres")).resolves.toBeTruthy(); // other users unaffected
  });

  test("spreadsheet formula injection is neutralised", async () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    for (const s of ["+1", "-1", "@SUM(A1)", "\tx"]) expect(csvCell(s).replace(/^"|"$/g, "").startsWith("'")).toBe(true);
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(null)).toBe("");
    await asAdmin((db) => db.query(`update app.centre set name = '=cmd|calc' where id = 1`));
    const out = lines(await readAll((await exportCsv(T.uA, "centres")).stream));
    expect(out[1]).toContain(",'=cmd|calc,");
  });

  test("HTTP route: same-origin POST, attachment, no-store; 404 for unknown or forbidden; 429 with Retry-After", async () => {
    const req = (dataset: string, { origin = "https://gems.test" as string | null, token = T.uA } = {}) => {
      const headers = new Headers({ "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${token}` });
      if (origin) headers.set("origin", origin);
      return exportRoute(new Request(`https://gems.test/export/${dataset}`, { method: "POST", headers, body: new URLSearchParams([["centre", "2"]]) }),
        { params: Promise.resolve({ dataset }) });
    };
    expect((await req("centres", { origin: "https://evil.example" })).status).toBe(403);
    expect((await req("centres", { origin: null })).status).toBe(403);
    const ok = await req("centres");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toMatch(/^attachment; filename="centres-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(lines(await ok.text())).toEqual(["Code,Name,Area,Region,Status"]); // filter for centre B: nothing in scope
    expect((await req("no-such")).status).toBe(404);
    expect((await req("users")).status).toBe(404); // forbidden looks like unknown
    for (let i = 0; i < EXPORT_POLICY.perWindow; i++) await (await req("centres")).text();
    const limited = await req("centres");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe(String(EXPORT_POLICY.windowMinutes * 60));
  });
});
