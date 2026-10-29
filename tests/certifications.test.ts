// Certifications and special-case availability: T-CC-001…004 (audit 09; docs/designs/certifications/certifications.md).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as certRoute } from "../app/admin/catalogue/certifications/save/route";
import { POST as courseRoute } from "../app/admin/catalogue/courses/[id]/save/route";
import { Forbidden } from "../src/server/action";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import * as cat from "../src/server/catalogue";
import { offeredCourses } from "../src/server/course-offer";
import { admit, admitOptions, CATALOGUE_GATES, type AdmitInput } from "../src/server/people";
import { asAdmin, C, reset, rows, setStepUp, ST_TOKEN, T } from "./fixtures";

const CA = "tok-catA";
const DCA = 1, TALLY = 2, PYTHON = 3, CCNA = 5; // fixture course ids (restart identity)
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const sqlErr = (q: string, p: unknown[] = []) => asAdmin(async (db) => {
  await db.query("begin");
  try { await db.query(q, p); return null; } catch (e) { return e as { code: string; constraint?: string }; } finally { await db.query("rollback"); }
});
const audit = async (action: string) => (await rows(action)).filter((r) => r.outcome === "OK");
let n = 0;
const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({ person: { givenName: `Cc${++n}`, mobile: `93000${String(n).padStart(5, "0")}` },
  centreId: C.A, academicYear: "2026-27", admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });

let app: pg.Client; // gems_app with a session, as withScope connects
const as = async (tok: string, q: string, p: unknown[] = []) => {
  await app.query("begin");
  await app.query("select set_config('app.session_id', $1, true)", [tok]);
  try { return await app.query(q, p); } finally { await app.query("rollback"); }
};
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(async () => { await reset(); await setStepUp(CA, 0); });
afterEach(() => { CATALOGUE_GATES.enforceAvailability = false; });

describe("T-CC certifications and special-case availability", () => {
  test("T-CC-001 the certification master: fields, messages in order, checks, (de)activate, readers", async () => {
    expect(await cat.createCertification(CA, { code: "aws ccp", name: "AWS Cloud Practitioner", type: "VOUCHER", description: " Line one\nLine two " }))
      .toEqual({ id: 1, code: "AWS CCP" });
    expect((await audit("catalogue.create"))[0]).toMatchObject({ target_type: "certification",
      after: { id: 1, code: "AWS CCP", name: "AWS Cloud Practitioner", type: "VOUCHER", description: "Line one\nLine two", active: true } });
    const bad: [Record<string, unknown>, string][] = [
      [{ code: "", name: "", type: "X" }, "code: required"], [{ code: "OK", name: "", type: "X" }, "name: 1-200 characters"],
      [{ code: "OK", name: "N", type: "X" }, "type: one of VOUCHER, LICENCE"],
      [{ code: "OK", name: "N", type: "LICENCE", description: "a\u0001" }, "description: invalid characters"],
      [{ code: "OK", name: "N", type: "LICENCE", description: "x".repeat(1001) }, "description: 1-1000 characters"],
    ];
    for (const [c, m] of bad) expect(await msg(cat.createCertification(CA, c as never)), JSON.stringify(c)).toBe(m);
    expect(await thrown(cat.createCertification(CA, { code: "AWS CCP", name: "x", type: "VOUCHER" }))).toMatchObject({ key: "catalogue.duplicate" });
    // update: absent keeps, null clears; nothing to change compares normalised values
    await cat.updateCertification(CA, 1, { name: "AWS CCP", type: "LICENCE", description: null });
    expect((await audit("catalogue.update"))[0]).toMatchObject({ before: { type: "VOUCHER", description: "Line one\nLine two" },
      after: { name: "AWS CCP", type: "LICENCE", description: null } });
    expect(await msg(cat.updateCertification(CA, 1, { name: " AWS CCP ", description: "  " }))).toBe("nothing to change");
    expect(await msg(cat.updateCertification(CA, 1, {}))).toBe("nothing to change");
    expect(await thrown(cat.updateCertification(CA, 99, { name: "x" }))).toMatchObject({ reason: "notfound" });
    // (de)activate with a reason
    expect(await msg(cat.setCertificationActive(CA, 1, false, " "))).toBe("reason: required");
    await cat.setCertificationActive(CA, 1, false, "retired");
    expect(await msg(cat.setCertificationActive(CA, 1, false, "again"))).toBe("already inactive");
    await cat.setCertificationActive(CA, 1, true, "back");
    expect((await audit("catalogue.deactivate"))[0]).toMatchObject({ target_type: "certification", target_id: "1", reason: "retired" });
    expect(await audit("catalogue.activate")).toHaveLength(1);
    // readers and non-managers, also by SQL; the code never changes
    expect(await cat.listCertifications(T.uA)).toMatchObject({ canManage: false, rows: [{ code: "AWS CCP", active: true }] });
    expect(await thrown(cat.createCertification(T.uA, { code: "X", name: "X", type: "VOUCHER" }))).toBeInstanceOf(Forbidden);
    expect(await thrown(as(T.uA, `insert into app.certification (code, name, type) values ('X', 'X', 'VOUCHER')`))).toMatchObject({ code: "42501" });
    expect((await as(T.uA, `update app.certification set name = 'x'`)).rowCount).toBe(0);
    expect(await thrown(as(CA, `update app.certification set code = 'X'`))).toMatchObject({ code: "42501" });
    // each named check refuses a direct insert
    for (const [col, v] of [["code", "a b"], ["name", " x"], ["type", "X"], ["description", "x\n"]]) {
      const cols = { code: "'Z'", name: "'Z'", type: "'VOUCHER'", description: "null", [col!]: `'${v}'` };
      expect(await sqlErr(`insert into app.certification (code, name, type, description) values (${cols.code}, ${cols.name}, ${cols.type}, ${cols.description})`), col)
        .toMatchObject({ code: "23514", constraint: `certification_${col}_check` });
    }
  });

  test("T-CC-002 a course's certifications: mandatory and optional, kept inactive, refusals, database gate", async () => {
    for (const [c, nm] of [["AWS", "AWS"], ["MOS", "MOS"], ["OLD", "Old"]]) await cat.createCertification(CA, { code: c!, name: nm!, type: "VOUCHER" });
    await cat.setCertificationActive(CA, 3, false, "retired");
    await cat.setCourseCertifications(CA, DCA, [{ certificationId: 1, mandatory: true }, { certificationId: 2, mandatory: false }]);
    await cat.setCourseCertifications(CA, DCA, [{ certificationId: 2, mandatory: false }, { certificationId: 1, mandatory: false }]); // a flag flip; posted out of order
    expect(await msg(cat.setCourseCertifications(CA, DCA, [{ certificationId: 2, mandatory: false }, { certificationId: 1, mandatory: false }]))).toBe("nothing to change");
    await cat.setCourseCertifications(CA, DCA, [{ certificationId: 2, mandatory: true }, { certificationId: 1, mandatory: true }]); // out of order
    await cat.setCourseCertifications(CA, DCA, []);
    expect((await audit("catalogue.course.certifications")).map((r) => [r.before, r.after])).toEqual([
      [{ mandatory: [], optional: [] }, { mandatory: ["AWS"], optional: ["MOS"] }],
      [{ mandatory: ["AWS"], optional: ["MOS"] }, { mandatory: [], optional: ["AWS", "MOS"] }],
      [{ mandatory: [], optional: ["AWS", "MOS"] }, { mandatory: ["AWS", "MOS"], optional: [] }],
      [{ mandatory: ["AWS", "MOS"], optional: [] }, { mandatory: [], optional: [] }],
    ]);
    expect(await msg(cat.setCourseCertifications(CA, DCA, [{ certificationId: 3, mandatory: true }]))).toBe("certifications: inactive or unknown");
    expect(await msg(cat.setCourseCertifications(CA, DCA, [{ certificationId: 99, mandatory: true }]))).toBe("certifications: inactive or unknown");
    expect(await msg(cat.setCourseCertifications(CA, DCA, [{ certificationId: 1, mandatory: true }, { certificationId: 1, mandatory: false }]))).toBe("certifications: duplicate");
    for (const items of [[null], [{ certificationId: "1", mandatory: true }], [{ certificationId: 1, mandatory: "yes" }], "x",
      Array.from({ length: 101 }, (_, i) => ({ certificationId: i + 1, mandatory: false }))]) {
      expect(await msg(cat.setCourseCertifications(CA, DCA, items as never)), JSON.stringify(items).slice(0, 40)).toBe("certifications: invalid");
    }
    // one already linked and deactivated later is kept, also with its flag flipped
    await cat.setCourseCertifications(CA, DCA, [{ certificationId: 2, mandatory: false }]);
    await cat.setCertificationActive(CA, 2, false, "retired");
    await cat.setCourseCertifications(CA, DCA, [{ certificationId: 2, mandatory: true }]);
    expect((await cat.getCourse(CA, DCA)).course.certifications).toEqual([{ id: 2, code: "MOS", name: "MOS", type: "VOUCHER", mandatory: true, active: false }]);
    // non-managers: the app, and SQL on a real row
    expect(await thrown(cat.setCourseCertifications(T.uA, DCA, []))).toBeInstanceOf(Forbidden);
    expect((await as(T.uA, `delete from app.course_certification`)).rowCount).toBe(0);
    expect(await thrown(as(T.uA, `insert into app.course_certification values (2, 1, true)`))).toMatchObject({ code: "42501" });
  });

  test("T-CC-003 special-case centres: set and clear; availability by named centres or class; form agrees; scope", async () => {
    await cat.setCourseCentres(CA, DCA, [C.A2]);
    await cat.setCourseCentres(CA, PYTHON, [C.A]);
    await cat.setCourseCentres(CA, CCNA, [C.B]);
    expect(await msg(cat.setCourseCentres(CA, DCA, [99]))).toBe("centres: unknown");
    expect(await msg(cat.setCourseCentres(CA, DCA, [1, 1]))).toBe("centres: duplicate");
    expect(await msg(cat.setCourseCentres(CA, DCA, Array.from({ length: 501 }, (_, i) => i + 1)))).toBe("centres: invalid");
    expect(await msg(cat.setCourseCentres(CA, DCA, [C.A2]))).toBe("nothing to change");
    expect((await audit("catalogue.course.centres"))[0]).toMatchObject({ target_id: "1", before: { centres: [] }, after: { centres: ["KL3-07"] } });
    // classes: A gets METRO, A2 none; DCA and TALLY linked to METRO
    await sql(`update app.centre set centre_class_id = 1 where id = $1`, [C.A]);
    // CCNA is also class-linked: its named centre (B) is outside sr's scope, so [] must not fall back to the class rule
    await sql(`insert into app.course_centre_class values ($1, 1), ($2, 1), ($3, 1)`, [DCA, TALLY, CCNA]);
    await cat.createCertification(CA, { code: "aws", name: "AWS", type: "VOUCHER" }); // so the manager's picklist is not empty
    CATALOGUE_GATES.enforceAvailability = true;
    const sr = ST_TOKEN.sr; // centres A and A2
    const o = await admitOptions(sr);
    expect(Object.fromEntries(o.courses.map((c) => [c.code, c.centreIds]))).toEqual({ CCNA: [], DCA: [2], DTP: null, PYTHON: [1], TALLY: null });
    let accepted: string[] = [], refused = 0;
    for (const centre of o.centres) {
      const offered = offeredCourses(o.courses, centre, true).map((c) => c.code);
      for (const course of o.courses) {
        const r = await admit(sr, input({ centreId: centre.id, courses: [{ courseCode: course.code, joinDate: "2026-11-01" }] })).then(() => "ok", (e: Error) => e.message);
        if (offered.includes(course.code)) { expect(r, `${centre.code} ${course.code}`).toBe("ok"); accepted.push(`${course.code}@${centre.code}`); }
        else { expect(r, `${centre.code} ${course.code}`).toBe("courses[0].courseCode: not offered at this centre"); refused++; }
      }
    }
    expect([accepted.sort(), refused]).toEqual([["DCA@KL3-07", "PYTHON@KL2-25", "TALLY@KL2-25"], 7]); // DCA@A refused although METRO matches
    expect((await cat.listCourses(CA)).courses.filter((c) => c.specialCase).map((c) => c.code).sort()).toEqual(["CCNA", "DCA", "PYTHON"]);
    // a centre-A user sees only centres in scope, and a count of the others; no pickers
    const dca = await cat.getCourse(ST_TOKEN.sa, DCA);
    expect(dca).toMatchObject({ course: { centres: [], specialCase: true, hiddenCentres: 1 }, certificationPicklist: [], centrePicklist: [], canManage: false });
    expect((await cat.getCourse(ST_TOKEN.sa, PYTHON)).course).toMatchObject({ centres: [{ id: 1, code: "KL2-25" }], hiddenCentres: 0 });
    const mgr = await cat.getCourse(CA, DCA);
    expect(mgr.course.centres.map((c) => c.code)).toEqual(["KL3-07"]);
    expect(mgr.centrePicklist.map((c) => c.code)).toEqual(["KL2-25", "KL3-07", "TN1-03"]);
    expect(mgr.certificationPicklist.map((c) => c.code)).toEqual(["AWS"]);
    // clearing returns DCA to the class rule: admitted at A again
    await cat.setCourseCentres(CA, DCA, []);
    await admit(sr, input({ centreId: C.A }));
    // the database gate
    const [r] = await sql(`select c.relrowsecurity rls, c.relforcerowsecurity force from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'app' and c.relname = 'course_centre'`);
    expect(r.rls && r.force).toBe(true);
    expect(await thrown(as(T.uA, `insert into app.course_centre values (2, 1)`))).toMatchObject({ code: "42501" });
    expect((await as(T.uA, `delete from app.course_centre`)).rowCount).toBe(0);
    expect(await thrown(cat.setCourseCentres(T.uA, DCA, []))).toBeInstanceOf(Forbidden);
  });

  test("T-CC-004 routes: certifications and the two course ops; step-up, origin, field details", async () => {
    const ORIGIN = "https://gems.test";
    const post = (path: string, body: URLSearchParams | Record<string, string>, origin = ORIGIN) => new Request(`${ORIGIN}${path}`, {
      method: "POST", body: body instanceof URLSearchParams ? body : new URLSearchParams(body),
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${CA}`, origin } });
    const where = (r: Response) => { const u = new URL(r.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const P = "/admin/catalogue/certifications";
    const cert = (b: Record<string, string>, origin?: string) => certRoute(post(`${P}/save`, b, origin));
    expect(where(await cert({ op: "create", code: "aws", name: "AWS", type: "VOUCHER", description: "" }))).toBe(`${P}?saved=1`);
    expect((await audit("catalogue.create"))[0].after).toMatchObject({ code: "AWS", description: null });
    expect(where(await cert({ op: "create", code: "mos", name: "MOS", type: "PAPER" }))).toBe(`${P}?error=invalid&detail=type`);
    expect(where(await cert({ op: "create", code: "aws", name: "x", type: "VOUCHER" }))).toBe(`${P}?error=catalogue.duplicate`);
    expect(where(await cert({ op: "update", id: "1", name: "AWS", type: "VOUCHER", description: "" }))).toBe(`${P}?error=invalid`); // nothing to change
    expect(where(await cert({ op: "update", id: "1", name: "AWS", type: "LICENCE", description: "Cloud" }))).toBe(`${P}?saved=1`);
    expect(where(await cert({ op: "update", id: "99", name: "x", type: "VOUCHER" }))).toBe(`${P}?error=notfound`);
    expect(where(await cert({ op: "active", id: "1", active: "x", reason: "r" }))).toBe(`${P}?error=invalid&detail=active`);
    expect(where(await cert({ op: "active", id: "1", active: "0", reason: "retired" }))).toBe(`${P}?saved=1`);
    expect(where(await cert({ op: "nope" }))).toBe(`${P}?error=invalid`);
    expect(where(await cert({ op: "create", code: "x1", name: "X", type: "VOUCHER", description: "a" }))).toBe(`${P}?error=invalid&detail=description`);
    expect((await cert({ op: "create", code: "X", name: "X", type: "VOUCHER" }, "https://evil.example")).status).toBe(403);
    // course ops: certifications (mandatory:<id>=0 is false; a Mandatory without Carries is ignored) and centres
    await cat.setCertificationActive(CA, 1, true, "back");
    const mos = String((await cat.createCertification(CA, { code: "mos", name: "MOS", type: "VOUCHER" })).id); // the failed duplicate used a sequence value
    const course = (b: URLSearchParams) => courseRoute(post(`/admin/catalogue/courses/${DCA}/save`, b), { params: Promise.resolve({ id: String(DCA) }) });
    const C1 = `/admin/catalogue/courses/${DCA}`;
    expect(where(await course(new URLSearchParams([["op", "certifications"], ["certificationId", "1"], ["mandatory:1", "0"], ["certificationId", mos],
      [`mandatory:${mos}`, "1"], ["mandatory:99", "1"]])))).toBe(`${C1}?saved=1`);
    expect((await audit("catalogue.course.certifications"))[0].after).toEqual({ mandatory: ["MOS"], optional: ["AWS"] });
    expect(where(await course(new URLSearchParams([["op", "certifications"], ["certificationId", "7"]])))).toBe(`${C1}?error=invalid&detail=certifications`);
    expect(where(await course(new URLSearchParams([["op", "centres"], ["centreId", "2"], ["centreId", "3"]])))).toBe(`${C1}?saved=1`);
    expect((await audit("catalogue.course.centres"))[0].after).toEqual({ centres: ["KL3-07", "TN1-03"] });
    expect(where(await course(new URLSearchParams([["op", "centres"], ["centreId", "99"]])))).toBe(`${C1}?error=invalid&detail=centres`);
    await setStepUp(CA, 3600);
    expect(where(await cert({ op: "active", id: "1", active: "0", reason: "r" }))).toBe(`/stepup?next=${encodeURIComponent(P)}`);
  });
});
