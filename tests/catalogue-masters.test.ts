// Catalogue masters pages acceptance tests: T-MS-001…003 (audit 09; docs/designs/catalogue-masters/catalogue-masters.md).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { createElement } from "react";
import { AdminErrors, MASTER_FIELD_LABELS } from "../app/admin/catalogue/admin-errors";
import { POST as centresRoute } from "../app/admin/catalogue/centres/save/route";
import { POST as mastersRoute } from "../app/admin/catalogue/masters/[slug]/save/route";
import { POST as yearsRoute } from "../app/admin/catalogue/years/save/route";
import { ADMIN_MESSAGES } from "../src/server/admin-http";
import { Forbidden } from "../src/server/action";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import * as cat from "../src/server/catalogue";
import { admit, CATALOGUE_GATES, type AdmitInput } from "../src/server/people";
import { asAdmin, C, reset, rows, setStepUp, ST_TOKEN, T, tkToken } from "./fixtures";

const CA = "tok-catA";
const METRO = 1, APP = 2; // centre_class ids: fixture METRO, then A++ inserted below
const UA = "00000000-0000-0000-0000-00000000000a";
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const audit = async (action: string, outcome = "OK") => (await rows(action)).filter((r) => r.outcome === outcome);
const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({
  person: { givenName: "Learner", mobile: "9600000001" }, centreId: C.A, academicYear: "2026-27",
  admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });

let app: pg.Client; // gems_app with a session, as withScope connects
const as = async (tok: string, q: string) => {
  await app.query("begin");
  await app.query("select set_config('app.session_id', $1, true)", [tok]);
  try { return await app.query(q); } finally { await app.query("rollback"); }
};
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(async () => { await reset(); await setStepUp(CA, 0); });
afterEach(() => { CATALOGUE_GATES.enforceAvailability = false; });

describe("T-MS catalogue masters", () => {
  test("T-MS-001 master and year lists: every row by code, years newest first, canManage", async () => {
    await cat.createMaster(CA, "course_division", { code: "adv", name: "Advanced" });
    await cat.setMasterActive(CA, "course_division", 2, false, "merged");
    expect((await cat.listMasters(T.uA, "course_division")).rows).toEqual([
      { id: 2, code: "ADV", name: "Advanced", active: false }, { id: 1, code: "GEN", name: "General", active: true }]);
    expect((await cat.listMasters(T.uA, "course_category")).rows).toEqual([{ id: 1, code: "GEN", name: "General", active: true }]);
    expect((await cat.listMasters(T.uA, "centre_class")).rows).toEqual([{ id: 1, code: "METRO", name: "Metro", active: true }]);
    const y = await cat.listAcademicYears(T.uA);
    expect(y.years.map((r) => r.code)).toEqual(["2028-29", "2027-28", "2026-27", "2025-26", "2024-25"]);
    expect(y.years[0]).toEqual({ code: "2028-29", startsOn: "2028-06-01", endsOn: "2029-05-31", open: true });
    expect([(await cat.listMasters(CA, "centre_class")).canManage, (await cat.listMasters(T.uA, "centre_class")).canManage]).toEqual([true, false]);
    expect([(await cat.listAcademicYears(CA)).canManage, y.canManage]).toEqual([true, false]);
    // an unknown kind fails before any session is needed
    expect(await msg(cat.listMasters(undefined, "nope" as cat.MasterKind))).toBe("kind: unknown");
  });

  test("T-MS-002 a centre's class: set, change, clear; refusals; database gate; lock; visibility", async () => {
    await sql(`insert into app.centre_class (code, name) values ('A++', 'A plus plus'), ('OLD', 'Old')`); // ids 2, 3
    await sql(`update app.centre_class set active = false where code = 'OLD'`);
    // validation before the database
    expect(await msg(cat.setCentreClass(CA, NaN, METRO, "r"))).toBe("centreId: invalid");
    expect(await msg(cat.setCentreClass(CA, 1, 1.5, "r"))).toBe("classId: invalid");
    expect(await msg(cat.setCentreClass(CA, 1, METRO, " "))).toBe("reason: required");
    // set, change, clear
    await cat.setCentreClass(CA, C.A, METRO, "new metro centre");
    await cat.setCentreClass(CA, C.A, APP, "upgraded");
    await cat.setCentreClass(CA, C.A, null, "class withdrawn");
    expect((await audit("catalogue.centre.class")).map((r) => ({ type: r.target_type, id: r.target_id, centre: r.target_centre_id,
      reason: r.reason, before: r.before, after: r.after }))).toEqual([
      { type: "centre", id: "1", centre: null, reason: "new metro centre", before: { classCode: null }, after: { classCode: "METRO" } },
      { type: "centre", id: "1", centre: null, reason: "upgraded", before: { classCode: "METRO" }, after: { classCode: "A++" } },
      { type: "centre", id: "1", centre: null, reason: "class withdrawn", before: { classCode: "A++" }, after: { classCode: null } },
    ]);
    // refusals
    expect(await msg(cat.setCentreClass(CA, C.A, 3, "r"))).toBe("classId: inactive or unknown");
    expect(await msg(cat.setCentreClass(CA, C.A, 99, "r"))).toBe("classId: inactive or unknown");
    expect(await msg(cat.setCentreClass(CA, C.A, null, "r"))).toBe("nothing to change");
    expect(await thrown(cat.setCentreClass(CA, 999, METRO, "r"))).toMatchObject({ reason: "notfound", message: "centre not found" });
    // a class deactivated after it was set is kept (DD-7)
    await cat.setCentreClass(CA, C.A, APP, "again");
    await cat.setMasterActive(CA, "centre_class", APP, false, "retired");
    expect(await msg(cat.setCentreClass(CA, C.A, APP, "r"))).toBe("nothing to change");
    const l = await cat.listCentreClasses(CA);
    expect(l.centres.find((c) => c.id === C.A)).toMatchObject({ classId: APP, classCode: "A++" });
    expect(l.classes.map((k) => [k.code, k.active])).toEqual([["A++", false], ["METRO", true]]); // OLD unused: absent
    // with availability enforced, a set class makes its courses admissible (course-master DD-2)
    await sql(`insert into app.course_centre_class values (1, 1)`); // DCA: METRO
    CATALOGUE_GATES.enforceAvailability = true;
    await cat.setCentreClass(CA, C.A, METRO, "back to metro");
    await admit(ST_TOKEN.sa, input());
    CATALOGUE_GATES.enforceAvailability = false;

    // nobody else: the app, a centre-scoped catalogue.manage holder, and direct SQL
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 18, 'CENTRE', 1)`, [UA]);
    expect(await thrown(cat.setCentreClass(T.uA, C.A, null, "r"))).toBeInstanceOf(Forbidden);
    expect(await audit("catalogue.centre.class", "DENIED")).toHaveLength(1);
    expect((await as(T.uA, `update app.centre set centre_class_id = null where id = 1`)).rowCount).toBe(0);
    expect(await sql(`select centre_class_id id from app.centre where id = 1`)).toEqual([{ id: METRO }]);
    expect((await sql(`select column_name from information_schema.column_privileges where table_schema = 'app'
      and table_name = 'centre' and grantee = 'gems_app' and privilege_type = 'UPDATE' order by column_name`)).map((r) => r.column_name))
      .toEqual(["address", "agreement_from", "agreement_to", "area_id", "category", "centre_class_id", "email", "gst_enabled", "gst_supply",
        "gstin", "name", "opened_on", "ownership", "phone", "status"]); // never code or id (0020)

    // the lock: a key-share holder (an admission insert) does not delay it; a concurrent class write is waited for
    await asAdmin(async (db) => {
      await db.query("begin");
      await db.query("select 1 from app.centre where id = 1 for key share");
      try {
        const won = await Promise.race([cat.setCentreClass(CA, C.A, null, "race").then(() => "write"),
          new Promise((r) => setTimeout(() => r("timeout"), 3000))]);
        expect(won).toBe("write");
      } finally { await db.query("rollback"); }
    });
    await sql(`update app.centre_class set active = true where id = 2`);
    await asAdmin(async (db) => {
      await db.query("begin");
      await db.query("update app.centre set centre_class_id = 2 where id = 1");
      const p = cat.setCentreClass(CA, C.A, METRO, "concurrent");
      await new Promise((r) => setTimeout(r, 500));
      await db.query("commit");
      await p;
    });
    expect((await audit("catalogue.centre.class")).at(-1)).toMatchObject({ reason: "concurrent", before: { classCode: "A++" }, after: { classCode: "METRO" } });

    // who sees which centres (D1)
    expect((await cat.listCentreClasses(tkToken("viewer"))).centres).toEqual([]);
    expect((await cat.listCentreClasses(T.uA)).centres.map((c) => c.code)).toEqual(["KL2-25"]);
    expect((await cat.listCentreClasses(CA)).centres.map((c) => c.code)).toEqual(["KL2-25", "KL3-07", "TN1-03"]);
  });
  test("T-MS-003 admin routes: masters, years, centre class; step-up, origin, slugs, field details; the error line", async () => {
    const ORIGIN = "https://gems.test";
    const post = (path: string, body: Record<string, string>, origin: string | null = ORIGIN) => {
      const headers = new Headers({ "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${CA}` });
      if (origin) headers.set("origin", origin);
      return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: new URLSearchParams(body) });
    };
    const where = (r: Response) => { const u = new URL(r.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const master = (slug: string, body: Record<string, string>, origin?: string | null) =>
      mastersRoute(post(`/admin/catalogue/masters/${slug}/save`, body, origin), { params: Promise.resolve({ slug }) });
    const year = (body: Record<string, string>) => yearsRoute(post("/admin/catalogue/years/save", body));
    const centre = (body: Record<string, string>, origin?: string | null) => centresRoute(post("/admin/catalogue/centres/save", body, origin));
    const M = "/admin/catalogue/masters/classes";
    // masters: create, rename, deactivate
    expect(where(await master("classes", { op: "create", code: "a++", name: "A plus plus" }))).toBe(`${M}?saved=1`);
    expect(where(await master("classes", { op: "update", id: "2", name: "A double plus" }))).toBe(`${M}?saved=1`);
    expect(where(await master("classes", { op: "active", id: "2", active: "0", reason: "retired" }))).toBe(`${M}?saved=1`);
    expect((await rows("catalogue.deactivate"))[0]).toMatchObject({ target_type: "centre_class", target_id: "2", reason: "retired" });
    expect((await rows("catalogue.create"))[0]!.request_id).not.toBeNull(); // safeRoute set the request context
    expect(where(await master("classes", { op: "active", id: "2", active: "x", reason: "r" }))).toBe(`${M}?error=invalid&detail=active`);
    expect(where(await master("classes", { op: "create", code: "A++", name: "Again" }))).toBe(`${M}?error=catalogue.duplicate`);
    expect(ADMIN_MESSAGES["catalogue.duplicate"]).toBe("A record with that code already exists.");
    expect(where(await master("classes", { op: "nope" }))).toBe(`${M}?error=invalid`);
    expect(where(await master("divisions", { op: "create", code: "", name: "X" }))).toBe("/admin/catalogue/masters/divisions?error=invalid&detail=code");
    // unknown slugs are 404 whatever the Origin; a known slug from a foreign or missing Origin is 403
    for (const slug of ["nope", "constructor"]) for (const o of [ORIGIN, "https://evil.example"]) {
      expect((await master(slug, { op: "create", code: "X", name: "X" }, o)).status, `${slug} ${o}`).toBe(404);
    }
    expect((await master("classes", { op: "create", code: "X", name: "X" }, "https://evil.example")).status).toBe(403);
    expect((await master("classes", { op: "create", code: "X", name: "X" }, null)).status).toBe(403);
    // years: create, dates, close
    const Y = "/admin/catalogue/years";
    expect(where(await year({ op: "create", code: "2029-30", startsOn: "2029-06-01", endsOn: "2030-05-31" }))).toBe(`${Y}?saved=1`);
    expect(where(await year({ op: "update", code: "2029-30", startsOn: "2029-06-01", endsOn: "2030-04-30" }))).toBe(`${Y}?saved=1`);
    expect(where(await year({ op: "open", code: "2029-30", open: "0", reason: "closed" }))).toBe(`${Y}?saved=1`);
    expect(where(await year({ op: "open", code: "2029-30", open: "x", reason: "r" }))).toBe(`${Y}?error=invalid&detail=open`);
    expect(where(await year({ op: "update", code: "2029-30", endsOn: "2029-01-01" }))).toBe(`${Y}?error=invalid&detail=endsOn`);
    expect((await rows("catalogue.update")).filter((r) => r.target_type === "academic_year")[0]!.after).toMatchObject({ endsOn: "2030-04-30" });
    // centre class: set and clear (classId '' is none)
    const K = "/admin/catalogue/centres";
    expect(where(await centre({ op: "class", centreId: "1", classId: "1", reason: "metro" }))).toBe(`${K}?saved=1`);
    expect(where(await centre({ op: "class", centreId: "1", classId: "", reason: "withdrawn" }))).toBe(`${K}?saved=1`);
    expect((await audit("catalogue.centre.class")).map((r) => r.after)).toEqual([{ classCode: "METRO" }, { classCode: null }]);
    expect(where(await centre({ op: "class", centreId: "1", classId: "", reason: "again" }))).toBe(`${K}?error=invalid`); // nothing to change
    expect(where(await centre({ op: "class", centreId: "1", classId: "2", reason: "" }))).toBe(`${K}?error=invalid&detail=reason`);
    expect(where(await centre({ op: "x" }))).toBe(`${K}?error=invalid`);
    expect((await centre({ op: "class", centreId: "1", classId: "1", reason: "r" }, "https://evil.example")).status).toBe(403);
    await setStepUp(CA, 3600);
    expect(where(await centre({ op: "class", centreId: "1", classId: "1", reason: "r" }))).toBe(`/stepup?next=${encodeURIComponent(K)}`);
    // the error line: own keys only (D4)
    // react-dom ships no types here; one function is all the test needs
    const { renderToStaticMarkup } = (await import("react-dom/server" as string)) as { renderToStaticMarkup: (e: unknown) => string };
    const line = (error: string, detail?: string) => renderToStaticMarkup(createElement(AdminErrors, { error, detail, labels: MASTER_FIELD_LABELS }));
    expect(line("__proto__", "constructor")).toBe('<p role="alert">Some values were invalid.</p>');
    expect(line("invalid", "__proto__")).toBe('<p role="alert">Some values were invalid.</p>');
    expect(line("invalid", "classId")).toBe('<p role="alert">Some values were invalid. Check: Class</p>');
    expect(line("catalogue.duplicate")).toBe('<p role="alert">A record with that code already exists.</p>');
  });
});
