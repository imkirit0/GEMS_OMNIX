// Course master acceptance tests: T-CM-001…006 (audit 09; docs/designs/course-master/course-master.md).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import pg from "pg";
import { POST as createRoute } from "../app/admin/catalogue/courses/create/route";
import { POST as saveRoute } from "../app/admin/catalogue/courses/[id]/save/route";
import { Forbidden } from "../src/server/action";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import * as cat from "../src/server/catalogue";
import { offeredCourses } from "../src/server/course-offer";
import { admit, admitOptions, CATALOGUE_GATES, type AdmitInput } from "../src/server/people";
import { asAdmin, C, reset, rows, setStepUp, ST_TOKEN, T } from "./fixtures";

const CA = "tok-catA";
const DCA = 1, TALLY = 2, METRO = 1; // fixture ids (restart identity)
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
let n = 0;
const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({
  person: { givenName: `Learner${++n}`, mobile: `97000${String(n).padStart(5, "0")}` }, centreId: C.A, academicYear: "2026-27",
  admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });
const tryAdmin = (q: string, p: unknown[] = []) => asAdmin(async (db) => {
  await db.query("begin");
  try { await db.query(q, p); return null; } catch (e) { return e as { code: string; constraint?: string }; } finally { await db.query("rollback"); }
});
const audit = async (action: string) => (await rows(action)).filter((r) => r.outcome === "OK").map((r) => ({ id: r.target_id, before: r.before, after: r.after }));

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

describe("T-CM course master", () => {
  test("T-CM-001 course fields: create and update, messages, Keltron on the merged row, checks, whole-row audit, summary", async () => {
    const full = { code: "web", name: "Web", categoryId: 1, divisionId: 1, displayName: " Web Design ", department: "IT",
      durationType: "MONTH" as const, durationMonths: 6, durationWeeks: null, durationDays: null, durationHours: 120, capacity: 30,
      examMinDays: 10, sortOrder: 5, visible: false, materialsRequired: true, marklistRequired: true, noRegFee: true, itMagic: true,
      keltron: true, internshipKeltron: true, selected: true, keltronShare: 1.15 };
    const w = await cat.createCourse(CA, full);
    const row = { ...full, id: w.id, code: "WEB", displayName: "Web Design", active: true };
    expect(await audit("catalogue.create")).toEqual([{ id: null, before: null, after: row }]);
    // a course with only the four keys takes every default
    const p = await cat.createCourse(CA, { code: "plain", name: "Plain", categoryId: 1, divisionId: 1 });
    expect((await audit("catalogue.create"))[1]!.after).toEqual({ id: p.id, code: "PLAIN", name: "Plain", categoryId: 1, divisionId: 1, active: true, ...cat.COURSE_DEFAULTS });

    // two decimals: accepted, normalised; a third refused, never rounded
    for (const s of [1.1, 4.35, 100, 1.1500000001]) await cat.updateCourse(CA, w.id, { keltronShare: s });
    expect(await sql(`select keltron_share::text s from app.course where id = $1`, [w.id])).toEqual([{ s: "1.15" }]);
    expect((await audit("catalogue.update")).map((a) => a.after.keltronShare)).toEqual([1.1, 4.35, 100, 1.15]);
    expect(await msg(cat.updateCourse(CA, w.id, { keltronShare: 12.345 }))).toBe("keltronShare: 0-100, two decimals");
    expect(await msg(cat.updateCourse(CA, w.id, { keltronShare: 100.01 }))).toBe("keltronShare: 0-100, two decimals");
    // absent keeps, null clears; null on a not-null field is invalid
    await cat.updateCourse(CA, w.id, { department: null });
    expect((await audit("catalogue.update")).at(-1)!.after).toMatchObject({ department: null, displayName: "Web Design", capacity: 30 });
    expect(await msg(cat.updateCourse(CA, w.id, { sortOrder: null as unknown as number }))).toBe("sortOrder: invalid");
    expect(await msg(cat.updateCourse(CA, w.id, { visible: null as unknown as boolean }))).toBe("visible: invalid");
    // each field's message
    const bad: [Record<string, unknown>, string][] = [
      [{ displayName: "  " }, "displayName: 1-200 characters"], [{ displayName: "x".repeat(201) }, "displayName: 1-200 characters"],
      [{ department: "x".repeat(101) }, "department: 1-100 characters"], [{ durationType: "YEAR" }, "durationType: invalid"],
      [{ durationMonths: 121 }, "durationMonths: 0-120"], [{ durationWeeks: -1 }, "durationWeeks: 0-520"],
      [{ durationDays: 3651 }, "durationDays: 0-3650"], [{ durationHours: 10001 }, "durationHours: 0-10000"],
      [{ capacity: 1.5 }, "capacity: 1-100000"], [{ capacity: 0 }, "capacity: 1-100000"], [{ examMinDays: 3651 }, "examMinDays: 0-3650"],
      [{ sortOrder: 100001 }, "sortOrder: 0-100000"], [{ capacity: 2 ** 53 }, "capacity: 1-100000"], [{ itMagic: "yes" }, "itMagic: invalid"],
      [{ keltronShare: "1.5" }, "keltronShare: 0-100, two decimals"],
    ];
    for (const [u, m] of bad) expect(await msg(cat.updateCourse(CA, w.id, u)), JSON.stringify(u)).toBe(m);
    // Keltron on the merged row: turning it off needs the share cleared in the same call
    expect(await msg(cat.updateCourse(CA, w.id, { keltron: false }))).toBe("keltronShare: only with Keltron");
    await cat.updateCourse(CA, w.id, { keltron: false, keltronShare: null });
    expect(await msg(cat.updateCourse(CA, w.id, { keltron: true }))).toBe("keltronShare: required with Keltron");
    expect(await msg(cat.updateCourse(CA, w.id, { keltronShare: 5 }))).toBe("keltronShare: only with Keltron");
    expect(await msg(cat.createCourse(CA, { code: "k", name: "K", categoryId: 1, divisionId: 1, keltron: true }))).toBe("keltronShare: required with Keltron");
    expect(await msg(cat.updateCourse(CA, w.id, { displayName: "Web Design", capacity: 30 }))).toBe("nothing to change");
    expect(await thrown(cat.updateCourse(CA, 999, { capacity: 3 }))).toMatchObject({ reason: "notfound" });

    // each named check refuses a direct insert (R12: out-of-range shares; 12.345 is the app's rule only)
    const checks: [string, string][] = [
      ["display_name", "' x'"], ["department", "''"], ["duration_type", "'YEAR'"], ["duration_months", "121"],
      ["duration_weeks", "521"], ["duration_days", "3651"], ["duration_hours", "10001"], ["capacity", "0"],
      ["exam_min_days", "-1"], ["sort_order", "100001"]];
    for (const [col, v] of checks) {
      expect(await tryAdmin(`insert into app.course (code, name, category_id, division_id, ${col}) values ('X', 'X', 1, 1, ${v})`), col)
        .toMatchObject({ code: "23514", constraint: `course_${col}_check` });
    }
    for (const [k, s] of [["true", "-1"], ["true", "100.01"], ["false", "5"], ["true", "null"]]) {
      expect(await tryAdmin(`insert into app.course (code, name, category_id, division_id, keltron, keltron_share) values ('X', 'X', 1, 1, ${k}, ${s})`), `${k} ${s}`)
        .toMatchObject({ code: "23514", constraint: "course_keltron_share_check" });
    }

    // the duration summary (DD-10)
    const none = { durationType: null, durationMonths: null, durationWeeks: null, durationDays: null, durationHours: null };
    expect(cat.durationSummary({ ...none, durationType: "MONTH", durationMonths: 6, durationHours: 120 })).toBe("6 months · 120 hours");
    expect(cat.durationSummary({ ...none, durationType: "WEEK", durationWeeks: 1, durationDays: 0 })).toBe("1 week");
    expect(cat.durationSummary({ ...none, durationType: "DAY", durationDays: 1, durationHours: 1 })).toBe("1 day · 1 hour");
    expect(cat.durationSummary({ ...none, durationType: "NA", durationMonths: 3 })).toBe("—");
    expect(cat.durationSummary(none)).toBe("—");
  });

  test("T-CM-002 centre classes: set, change, clear; inactive classes; refusals; the database gate", async () => {
    await sql(`insert into app.centre_class (code, name) values ('A++', 'A plus plus'), ('OLD', 'Old')`); // ids 2, 3
    await sql(`update app.centre_class set active = false where code = 'OLD'`);
    await cat.setCourseClasses(CA, DCA, [METRO]);
    await cat.setCourseClasses(CA, DCA, [2, METRO]);
    await cat.setCourseClasses(CA, DCA, []);
    expect(await audit("catalogue.course.classes")).toEqual([
      { id: "1", before: { classes: [] }, after: { classes: ["METRO"] } },
      { id: "1", before: { classes: ["METRO"] }, after: { classes: ["A++", "METRO"] } },
      { id: "1", before: { classes: ["A++", "METRO"] }, after: { classes: [] } },
    ]);
    expect(await msg(cat.setCourseClasses(CA, DCA, [3]))).toBe("classIds: inactive or unknown");
    expect(await msg(cat.setCourseClasses(CA, DCA, [99]))).toBe("classIds: inactive or unknown");
    expect(await msg(cat.setCourseClasses(CA, DCA, [METRO, METRO]))).toBe("classIds: duplicate");
    expect(await msg(cat.setCourseClasses(CA, DCA, ["x"] as unknown as number[]))).toBe("classIds: invalid");
    expect(await msg(cat.setCourseClasses(CA, DCA, []))).toBe("nothing to change");
    expect(await thrown(cat.setCourseClasses(CA, 999, [METRO]))).toMatchObject({ reason: "notfound" });
    // a class deactivated after assignment is kept (Z3)
    await cat.setCourseClasses(CA, DCA, [METRO, 2]);
    await sql(`update app.centre_class set active = false where code = 'A++'`);
    await cat.setCourseClasses(CA, DCA, [2]);
    expect(await sql(`select centre_class_id id from app.course_centre_class where course_id = 1`)).toEqual([{ id: 2 }]);
    expect(await msg(cat.setCourseClasses(CA, DCA, [2]))).toBe("nothing to change");
    // non-managers: refused by the app and by the database on a real row
    expect(await thrown(cat.setCourseClasses(T.uA, DCA, [METRO]))).toBeInstanceOf(Forbidden);
    expect((await as(T.uA, `delete from app.course_centre_class`)).rowCount).toBe(0);
    expect(await sql(`select count(*)::int n from app.course_centre_class`)).toEqual([{ n: 1 }]);
    expect(await thrown(as(T.uA, `insert into app.course_centre_class values (2, 1)`))).toMatchObject({ code: "42501" });
    const [r] = await sql(`select c.relrowsecurity rls, c.relforcerowsecurity force,
        array(select distinct cmd from pg_policies p where p.schemaname = 'app' and p.tablename = 'course_centre_class') cmds
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relname = 'course_centre_class'`);
    expect(r.rls && r.force).toBe(true);
    expect([...r.cmds].sort()).toEqual(["DELETE", "INSERT", "SELECT"]);
  });

  test("T-CM-003 availability: off admits every course; on, only the centre's active class; admit() and the form agree", async () => {
    expect(CATALOGUE_GATES.enforceAvailability).toBe(false); // committed off, on the value and in the source
    expect(fs.readFileSync("src/server/people.ts", "utf8")).toMatch(/CATALOGUE_GATES = \{ enforceAvailability: false \}/);
    await sql(`insert into app.centre_class (code, name) values ('A++', 'A plus plus')`); // id 2
    await sql(`update app.centre set centre_class_id = 1 where id = $1`, [C.A]); // A: METRO; A2: no class
    await sql(`insert into app.course_centre_class values (1, 1), (2, 1), (2, 2)`); // DCA: METRO; TALLY: both
    const sr = ST_TOKEN.sr; // region 1: centres A and A2
    // off: anything active and visible, anywhere
    await admit(sr, input({ centreId: C.A2, courses: [{ courseCode: "PYTHON", joinDate: "2026-11-01" }] }));
    const off = await admitOptions(sr);
    expect(off.enforced).toBe(false);
    expect(offeredCourses(off.courses, off.centres[1], off.enforced)).toHaveLength(5);
    // on
    CATALOGUE_GATES.enforceAvailability = true;
    const o = await admitOptions(sr);
    expect(o.enforced).toBe(true);
    expect(o.centres.map((c) => [c.code, c.classCode])).toEqual([["KL2-25", "METRO"], ["KL3-07", null]]);
    expect(Object.fromEntries(o.courses.map((c) => [c.code, c.classCodes]))).toEqual({ CCNA: [], DCA: ["METRO"], DTP: [], PYTHON: [], TALLY: ["A++", "METRO"] });
    expect(offeredCourses(o.courses, null, true)).toHaveLength(5); // no centre chosen: all listed, the server is the gate
    let accepted = 0, refused = 0;
    for (const centre of o.centres) {
      const offered = offeredCourses(o.courses, centre, true).map((c) => c.code);
      for (const course of o.courses) {
        const r = await admit(sr, input({ centreId: centre.id, courses: [{ courseCode: course.code, joinDate: "2026-11-01" }] })).then(() => "ok", (e: Error) => e.message);
        if (offered.includes(course.code)) { expect(r, `${centre.code} ${course.code}`).toBe("ok"); accepted++; }
        else { expect(r, `${centre.code} ${course.code}`).toBe("courses[0].courseCode: not offered at this centre"); refused++; }
      }
    }
    expect([accepted, refused]).toEqual([2, 8]); // DCA and TALLY at A; nothing at A2 (DD-7)
    // an assigned class deactivated later no longer sells (DD-15)
    await sql(`update app.centre set centre_class_id = 2 where id = $1`, [C.A]);
    await admit(sr, input({ courses: [{ courseCode: "TALLY", joinDate: "2026-11-01" }] }));
    await sql(`update app.centre_class set active = false where id = 2`);
    expect(await msg(admit(sr, input({ courses: [{ courseCode: "TALLY", joinDate: "2026-11-01" }] })))).toBe("courses[0].courseCode: not offered at this centre");
    const later = await admitOptions(sr);
    expect(later.courses.find((c) => c.code === "TALLY")!.classCodes).toEqual(["METRO"]);
    expect(offeredCourses(later.courses, later.centres[0], true)).toEqual([]);
  });

  test("T-CM-004 admin routes: create, details, classes, active; step-up, origin and field details", async () => {
    const ORIGIN = "https://gems.test";
    const post = (path: string, body: Record<string, string> | URLSearchParams, origin = ORIGIN) => new Request(`${ORIGIN}${path}`, {
      method: "POST", body: body instanceof URLSearchParams ? body : new URLSearchParams(body),
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${CA}`, origin } });
    const where = (r: Response) => { const u = new URL(r.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
    const form = { code: "web", name: "Web", categoryId: "1", divisionId: "1", displayName: " ", durationType: "MONTH",
      durationMonths: "6", sortOrder: "3", visible: "1", keltron: "1", keltronShare: "12.50" };
    expect(where(await createRoute(post("/admin/catalogue/courses/create", form)))).toBe("/admin/catalogue/courses/6?saved=1");
    expect((await audit("catalogue.create"))[0]!.after).toMatchObject({ code: "WEB", displayName: null, durationMonths: 6, sortOrder: 3,
      visible: true, keltron: true, keltronShare: 12.5, selected: false });
    const save = (body: Record<string, string> | URLSearchParams, origin?: string) => saveRoute(post("/admin/catalogue/courses/6/save", body, origin), params(6));
    expect(where(await save({ ...form, op: "details", name: "Web Design", keltron: "", keltronShare: "" })))
      .toBe("/admin/catalogue/courses/6?saved=1");
    expect((await audit("catalogue.update"))[0]!.after).toMatchObject({ name: "Web Design", keltron: false, keltronShare: null });
    expect(where(await save(new URLSearchParams([["op", "classes"], ["classId", "1"]])))).toBe("/admin/catalogue/courses/6?saved=1");
    expect((await audit("catalogue.course.classes"))[0]!.after).toEqual({ classes: ["METRO"] });
    expect(where(await save({ op: "active", active: "0", reason: "retired" }))).toBe("/admin/catalogue/courses/6?saved=1");
    expect(await audit("catalogue.deactivate")).toHaveLength(1);
    // a field error names the field; "1e2" is not a whole number; a prefix-less message carries no detail
    expect(where(await save({ ...form, op: "details", keltronShare: "" }))).toBe("/admin/catalogue/courses/6?error=invalid&detail=keltronShare");
    expect(where(await save({ ...form, op: "details", capacity: "1e2" }))).toBe("/admin/catalogue/courses/6?error=invalid&detail=capacity");
    expect(where(await save({ ...form, op: "details", keltronShare: "12.345" }))).toBe("/admin/catalogue/courses/6?error=invalid&detail=keltronShare");
    expect(where(await save({ op: "classes", classId: "1" }))).toBe("/admin/catalogue/courses/6?error=invalid");
    expect(where(await save({ op: "nope" }))).toBe("/admin/catalogue/courses/6?error=invalid");
    expect(where(await createRoute(post("/admin/catalogue/courses/create", form)))).toBe("/admin/catalogue/courses/new?error=catalogue.duplicate");
    // a foreign Origin; a stale step-up
    expect((await save({ op: "active", active: "1", reason: "back" }, "https://evil.example")).status).toBe(403);
    await setStepUp(CA, 3600);
    expect(where(await save({ op: "active", active: "1", reason: "back" }))).toBe(`/stepup?next=${encodeURIComponent("/admin/catalogue/courses/6")}`);
    expect(await audit("catalogue.activate")).toEqual([]);
  });

  test("T-CM-005 the KELTRON share: managers read it; nobody else, from the course or the list", async () => {
    await cat.updateCourse(CA, DCA, { keltron: true, keltronShare: 37.5 });
    expect((await cat.getCourse(CA, DCA)).course.keltronShare).toBe(37.5);
    const seen = await cat.getCourse(T.uA, DCA);
    expect(seen.course).toMatchObject({ code: "DCA", keltron: true, keltronShare: null, classes: [] });
    expect(seen.canManage).toBe(false);
    for (const tok of [CA, T.uA]) {
      const l = await cat.listCourses(tok);
      expect(l.courses).toHaveLength(5);
      for (const c of l.courses) expect(Object.keys(c)).not.toContain("keltronShare");
    }
    expect(await thrown(cat.getCourse(T.uA, 999))).toBeInstanceOf(Forbidden);
    // reads: order, filters, classes and picklists
    await cat.setCourseClasses(CA, TALLY, [METRO]);
    await cat.updateCourse(CA, TALLY, { sortOrder: 0, displayName: "Tally Prime" });
    await cat.setCourseActive(CA, DCA, false, "retired");
    const l = await cat.listCourses(CA, { q: "prime" });
    expect(l.courses.map((c) => [c.code, c.classes])).toEqual([["TALLY", ["METRO"]]]);
    expect((await cat.listCourses(CA, { active: false })).courses.map((c) => c.code)).toEqual(["DCA"]);
    expect((await cat.listCourses(CA, { q: "%" })).courses).toEqual([]);
    expect(l.canManage).toBe(true);
    expect(l.categories).toEqual([{ id: 1, code: "GEN", name: "General", active: true }]);
    expect(await cat.canManageCatalogue(CA)).toBe(true);
    expect(await cat.canManageCatalogue(T.uA)).toBe(false);
  });

  test("T-CM-006 an invisible course is not offered and not admitted; existing registrations stay", async () => {
    await admit(ST_TOKEN.sa, input());
    await cat.updateCourse(CA, DCA, { visible: false });
    expect((await admitOptions(ST_TOKEN.sa)).courses.map((c) => c.code)).toEqual(["CCNA", "DTP", "PYTHON", "TALLY"]);
    expect(await msg(admit(ST_TOKEN.sa, input()))).toBe("courses[0].courseCode: no such course");
    expect(await sql(`select count(*)::int n from app.registration where course_code = 'DCA'`)).toEqual([{ n: 1 }]);
  });
});
