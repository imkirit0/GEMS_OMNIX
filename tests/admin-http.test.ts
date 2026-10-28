// Admin HTTP layer and first-admin bootstrap.
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as stepup } from "../app/auth/stepup/route";
import { POST as createUserRoute } from "../app/admin/users/create/route";
import { POST as assignRoute } from "../app/admin/users/[id]/assign/route";
import { POST as statusRoute } from "../app/admin/users/[id]/status/route";
import { POST as setupLinkRoute } from "../app/admin/users/[id]/setup-link/route";
import { POST as removeRoute } from "../app/admin/assignments/[id]/remove/route";
import { POST as createRoleRoute } from "../app/admin/roles/create/route";
import { POST as permissionsRoute } from "../app/admin/roles/[id]/permissions/route";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import { hashPassword } from "../src/server/auth";
import { safeNext } from "../src/server/admin-http";
import { bootstrapAdmin } from "../scripts/bootstrap-admin.mjs";
import { asAdmin, reset, setStepUp, T } from "./fixtures";

const ORIGIN = "https://gems.test";
const HO_ID = "00000000-0000-0000-0000-0000000000ff";
const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });
function post(path: string, body: URLSearchParams | Record<string, string>, { origin = ORIGIN as string | null, token = T.hoAll as string } = {}) {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${token}` });
  if (origin) headers.set("origin", origin);
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: body instanceof URLSearchParams ? body : new URLSearchParams(body) });
}
const where = (r: Response) => { const u = new URL(r.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };

beforeEach(async () => { await reset(); await setStepUp(T.hoAll, 0); });
afterAll(() => auth().close());

describe("admin routes", () => {
  test("T-AUTH-016 every admin POST rejects foreign and missing Origin with no side effects", async () => {
    const calls: [string, (r: Request) => Promise<Response>][] = [
      ["/auth/stepup", stepup], ["/admin/users/create", createUserRoute], ["/admin/roles/create", createRoleRoute],
      ["/admin/users/x/assign", (r) => assignRoute(r, params(HO_ID))], ["/admin/users/x/status", (r) => statusRoute(r, params(HO_ID))],
      ["/admin/users/x/setup-link", (r) => setupLinkRoute(r, params(HO_ID))], ["/admin/assignments/1/remove", (r) => removeRoute(r, params(1))],
      ["/admin/roles/1/permissions", (r) => permissionsRoute(r, params(1))],
    ];
    const count = () => asAdmin((db) => db.query(`select (select count(*) from app.app_user) + (select count(*) from app.role) + (select count(*) from app.role_assignment) + (select count(*) from app.audit_log) n`).then((r) => r.rows[0].n));
    const before = await count();
    for (const [path, call] of calls) for (const origin of ["https://evil.example", null]) {
      expect((await call(post(path, { login: "x", displayName: "x", key: "x", name: "x", status: "DISABLED" }, { origin }))).status, `${path} ${origin}`).toBe(403);
    }
    expect(await count()).toBe(before);
  });

  test("create user and assign through the routes; stale step-up redirects to /stepup and back", async () => {
    const created = await createUserRoute(post("/admin/users/create", { login: "Clerk", displayName: "Clerk One" }));
    expect(where(created)).toMatch(/^\/admin\/users\/[0-9a-f-]{36}\?created=1$/);
    const id = where(created).split("/")[3]!.split("?")[0]!;

    await setStepUp(T.hoAll, 301);
    const stale = await assignRoute(post(`/admin/users/${id}/assign`, { roleId: "2", scopeKind: "CENTRE", centreId: "1" }), params(id));
    expect(where(stale)).toBe(`/stepup?next=${encodeURIComponent(`/admin/users/${id}`)}`);

    await asAdmin(async (db) => db.query(`update app.app_user set password_hash = $2 where id = $1`, [HO_ID, await hashPassword("ho-pass-12345678")]));
    const wrong = await stepup(post("/auth/stepup", { password: "nope", next: `/admin/users/${id}` }));
    expect(where(wrong)).toMatch(/^\/stepup\?error=password/);
    const ok = await stepup(post("/auth/stepup", { password: "ho-pass-12345678", next: `/admin/users/${id}` }));
    expect(where(ok)).toBe(`/admin/users/${id}`);
    const rotated = ok.headers.getSetCookie()[0]!.split(";")[0]!.split("=")[1]!;
    expect(rotated).not.toBe(T.hoAll); // session id rotated on step-up (T-AUTH-014)

    const assigned = await assignRoute(post(`/admin/users/${id}/assign`, { roleId: "2", scopeKind: "CENTRE", centreId: "1", regionId: "2" }, { token: rotated }), params(id));
    expect(where(assigned)).toBe(`/admin/users/${id}`);
    const shape = await asAdmin((db) => db.query(`select scope_kind, region_id, scope_centre_id from app.role_assignment where user_id = $1`, [id]).then((r) => r.rows));
    expect(shape).toEqual([{ scope_kind: "CENTRE", region_id: null, scope_centre_id: 1 }]); // stray regionId ignored
  });

  test("over-grant through the route comes back as a visible error, not a crash", async () => {
    const r = await assignRoute(post(`/admin/users/${HO_ID}/assign`, { roleId: "1", scopeKind: "ALL" }), params(HO_ID));
    expect(where(r)).toBe(`/admin/users/${HO_ID}?error=forbidden`);
  });

  test("set-up link is shown once, uncached, and works exactly once", async () => {
    const r = await setupLinkRoute(post(`/admin/users/00000000-0000-0000-0000-00000000000b/setup-link`, {}), params("00000000-0000-0000-0000-00000000000b"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const token = decodeURIComponent((await r.text()).match(/token=([^<&"]+)/)![1]!);
    expect(await auth().confirmReset(token, "picked-by-the-user-1")).toBe(true);
    expect(await auth().confirmReset(token, "picked-by-the-user-2")).toBe(false);
  });

  test("role permissions form: checkboxes become the role's permission set", async () => {
    const created = await createRoleRoute(post("/admin/roles/create", { key: "viewer2", name: "Viewer 2" }));
    const roleId = where(created).split("/")[3]!;
    const body = new URLSearchParams([["permission", "org.centre.view"], ["permission", "rbac.view"]]);
    expect(where(await permissionsRoute(post(`/admin/roles/${roleId}/permissions`, body), params(roleId)))).toBe(`/admin/roles/${roleId}?saved=1`);
    const perms = await asAdmin((db) => db.query(`select array_agg(permission_key order by permission_key) p from app.role_permission where role_id = $1`, [roleId]).then((x) => x.rows[0].p));
    expect(perms).toEqual(["org.centre.view", "rbac.view"]);
  });

  test("safeNext blocks open redirects", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", undefined]) expect(safeNext(bad as string)).toBe("/");
    expect(safeNext("/admin/users/abc?x=1")).toBe("/admin/users/abc?x=1");
  });
});

describe("first-admin bootstrap", () => {
  test("refuses while an administrator exists; otherwise creates a TOTP-required admin with a one-time link", async () => {
    const db = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
    await db.connect();
    try {
      await expect(bootstrapAdmin(db, { login: "boss", displayName: "Boss" })).rejects.toThrow(/already exists/);
      await db.query(`delete from app.role_assignment where role_id = 3`); // no network-wide user admin left
      const { token } = await bootstrapAdmin(db, { login: "Boss", displayName: "Boss" });
      expect(await auth().confirmReset(token, "boss-chosen-password")).toBe(true);
      expect((await auth().signIn("boss", "boss-chosen-password", "10.8.0.1")).kind).toBe("enrol"); // TOTP before any access
      const actions = (await db.query(`select action from app.audit_log where action = 'rbac.bootstrap'`)).rowCount;
      expect(actions).toBe(1);
      await expect(bootstrapAdmin(db, { login: "boss2", displayName: "Boss 2" })).rejects.toThrow(/already exists/);
    } finally { await db.end(); }
  });
});
