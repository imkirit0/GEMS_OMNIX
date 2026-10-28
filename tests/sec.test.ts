// T-SEC: application-level isolation (audit 09 §T-SEC), the parts whose surfaces exist today.
// Real-server checks (headers, CSP nonce, XSS rendering, 404 parity) are in scripts/smoke-security.mjs (run by CI).
import { beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { getCentre, listCentres } from "../src/server/centres";
import { scopedAction } from "../src/server/action";
import { allocate } from "../src/server/numbering";
import { safeRoute } from "../src/server/safe-route";
import { buildCsp } from "../src/server/csp";
import { asAdmin, audits, C, PERIOD, reset, T } from "./fixtures";

const codes = (rows: { code: string }[]) => rows.map((r) => r.code);
const routeFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? routeFiles(path.join(dir, e.name)) : e.name === "route.ts" ? [path.join(dir, e.name)] : []));

beforeEach(() => reset());

describe("T-SEC application-level isolation", () => {
  test("T-SEC-001 a record outside scope looks exactly like a record that does not exist", async () => {
    expect(await getCentre(T.uA, C.A)).toMatchObject({ code: "KL2-25" });
    expect(await getCentre(T.uA, C.B)).toBeNull(); // exists, other centre
    expect(await getCentre(T.uA, 999_999)).toBeNull(); // does not exist
    expect(await getCentre(T.hoR1, C.A2)).toMatchObject({ code: "KL3-07" }); // region scope
    expect(await getCentre(T.hoR1, C.B)).toBeNull();
    expect(await getCentre(T.uB, C.B)).toMatchObject({ code: "TN1-03" });
    // second gate: in scope (RLS shows the row) but without org.centre.view, it is still invisible
    await asAdmin(async (db) => {
      await db.query(`insert into app.role (id, key, name) values (90, 'allocator', 'Allocator')`);
      await db.query(`insert into app.role_permission values (90, 'numbering.series.allocate')`);
      await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ('00000000-0000-0000-0000-00000000000b', 90, 'CENTRE', 1)`);
    });
    expect(await getCentre(T.uB, C.A)).toBeNull();
    expect(codes(await listCentres(T.uB))).toEqual(["TN1-03"]);
  });

  test("T-SEC-005 crafted list filters can only narrow, never widen", async () => {
    expect(codes(await listCentres(T.uA))).toEqual(["KL2-25"]);
    expect(codes(await listCentres(T.uA, { centreIds: [C.A, C.B, C.A2] }))).toEqual(["KL2-25"]);
    expect(codes(await listCentres(T.uA, { regionIds: [2] }))).toEqual([]);
    expect(codes(await listCentres(T.hoR1, { centreIds: [C.B] }))).toEqual([]);
    expect(codes(await listCentres(T.uA, { q: "TN1" }))).toEqual([]); // B's code
    expect(codes(await listCentres(T.uA, { q: "%' or 1=1 --" }))).toEqual([]); // parameterised, inert
    expect(codes(await listCentres(T.hoAll))).toEqual(["KL2-25", "KL3-07", "TN1-03"]);
  });

  test("T-SEC-007 HO-global masters cannot be mutated by the app role at all", async () => {
    const app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] });
    await app.connect();
    try {
      await app.query("begin");
      await app.query("select set_config('app.session_id', $1, true)", [T.hoAll]);
      for (const sql of ["insert into app.region (code, name) values ('R9', 'x')", "update app.area set name = 'x'",
        "update app.centre set status = 'INACTIVE'", "insert into app.permission (key, description) values ('x', 'x')",
        "update app.role set name = 'x'"]) {
        await app.query("savepoint s");
        await expect(app.query(sql), sql).rejects.toMatchObject({ code: "42501" });
        await app.query("rollback to savepoint s");
      }
      await app.query("rollback");
    } finally { await app.end(); }
    // role/user administration is covered by tests/rbac.test.ts (Forbidden without rbac.* permissions)
  });

  test("T-SEC-012 unexpected errors return a generic message and a reference, never SQL or a stack", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: unknown) => { logged.push(String(m)); });
    try {
      const handler = safeRoute(async () => { throw new Error('relation "app.secret" does not exist: SELECT password_hash FROM app.app_user'); });
      const res = await handler(new Request("https://gems.test/auth/login", { method: "POST" }));
      const body = await res.text();
      expect(res.status).toBe(500);
      expect(body).toMatch(/^Something went wrong\. Reference: [0-9a-f-]{36}$/);
      expect(body).not.toMatch(/select|password|relation|Error|at /i);
      const ref = res.headers.get("x-request-id")!;
      expect(body).toContain(ref);
      expect(logged.join("\n")).toContain(ref); // the server log can find the cause by the same reference
    } finally { spy.mockRestore(); }
    // every route handler goes through safeRoute
    for (const f of routeFiles("app")) expect(fs.readFileSync(f, "utf8"), f).toMatch(/export const POST = safeRoute\(/);
  });

  test("T-SEC-014 CSP: the storage origin is allowed only for uploads and the download redirect (ADR-002)", () => {
    const parts = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
    const without = parts(buildCsp("n0nce", false));
    expect(without["connect-src"]).toEqual(["'self'"]);
    expect(without["form-action"]).toEqual(["'self'"]);
    const withStorage = parts(buildCsp("n0nce", false, "https://abc.supabase.co/some/path"));
    expect(withStorage["connect-src"]).toEqual(["'self'", "https://abc.supabase.co"]);
    expect(withStorage["form-action"]).toEqual(["'self'", "https://abc.supabase.co"]);
    for (const d of ["default-src", "script-src", "img-src", "frame-ancestors"]) expect(withStorage[d], d).toEqual(without[d]);
    expect(withStorage["script-src"]).not.toContain("'unsafe-inline'");
  });

  test("T-SEC-013 no way to act as a centre: HO acts as themselves, within scope, and is audited as themselves", async () => {
    for (const f of routeFiles("app")) expect(f).not.toMatch(/impersonat|switch.*login|act-?as/i);
    const hoR1 = "00000000-0000-0000-0000-0000000000a1";
    await asAdmin((db) => db.query(`insert into app.role_assignment (user_id, role_id, scope_kind, region_id) values ($1, 1, 'REGION', 1)`, [hoR1]));
    const n = await scopedAction(T.hoR1, { action: "numbering.allocate", permission: "numbering.series.allocate", centreId: C.A },
      (tx) => allocate(tx, { centreId: C.A, docType: "FEEREC", period: PERIOD }));
    expect(n).toBe(1n);
    const row = await asAdmin((db) => db.query(`select user_id::text from app.audit_log where action = 'numbering.allocate'`).then((r) => r.rows[0]));
    expect(row.user_id).toBe(hoR1); // the HO user, not a centre identity
    await expect(scopedAction(T.hoR1, { action: "numbering.allocate", permission: "numbering.series.allocate", centreId: C.B },
      (tx) => allocate(tx, { centreId: C.B, docType: "FEEREC", period: PERIOD }))).rejects.toThrow(); // outside R1
    expect((await audits("numbering.allocate")).map((a) => a.outcome)).toEqual(["OK", "DENIED"]);
  });
});
