// Centre and catalogue skeleton acceptance tests: T-CAT-001…004 (audit 09; docs/designs/catalogue-skeleton, item 7).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { Forbidden } from "../src/server/action";
import * as cat from "../src/server/catalogue";
import { admit, CODE_RULE, normCode, type AdmitInput } from "../src/server/people";
import { RbacError, StepUpRequired } from "../src/server/rbac";
import { asAdmin, C, reset, rows, setStepUp, ST_TOKEN, T } from "./fixtures";

const CA = "tok-catA";
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
let n = 0; // a fresh learner per admission, so duplicate detection never interferes
const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({
  person: { givenName: `Learner${++n}`, mobile: `98000${String(n).padStart(5, "0")}` }, centreId: C.A, academicYear: "2026-27",
  admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o }); // no DOB: no match key, no duplicates
/** One statement as the admin inside a rolled-back transaction; returns the error or null. */
const tryAdmin = (sql: string, params: unknown[] = []) => asAdmin(async (db) => {
  await db.query("begin");
  try { await db.query(sql, params); return null; } catch (e) { return e as { code: string; constraint?: string }; } finally { await db.query("rollback"); }
});

// The database gate alone: gems_app with a session, as withScope connects (rbac.test.ts pattern).
let app: pg.Client;
const as = async (tok: string, sql: string) => {
  await app.query("begin");
  await app.query("select set_config('app.session_id', $1, true)", [tok]);
  try { return await app.query(sql); } finally { await app.query("rollback"); }
};
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(() => app.end());
beforeEach(async () => { await reset(); await setStepUp(CA, 0); });

const CODE_TABLES = ["course_category", "course_division", "centre_class", "course"] as const;
const insertCode = (t: string, code: string) => t === "course"
  ? tryAdmin(`insert into app.course (code, name, category_id, division_id) values ($1, 'N', 1, 1)`, [code])
  : tryAdmin(`insert into app.${t} (code, name) values ($1, 'N')`, [code]);

describe("T-CAT catalogue skeleton", () => {
  test("T-CAT-001 one record per code; normCode() agrees with the database code check", async () => {
    const samples = ["dca", "A\tB", "A\nB", "A  B", " A", "A ", "A/B", "A&B", "A\x01B", "A B", " A", "É", "ß", "ı", "DCA2", "A B"];
    const jsOk = (s: string) => CODE_RULE.test(s) && s.length <= 30 && s === s.toUpperCase();
    for (const s of samples) {
      const err = await insertCode("course_category", s);
      const dbOk = !(err?.code === "23514" && err.constraint === "course_category_code_check");
      expect(jsOk(s), JSON.stringify(s)).toBe(dbOk);
      const v = normCode(s);
      if (/[^\x00-\x7f]/.test(s)) expect(jsOk(v), JSON.stringify(s)).toBe(false); // refused, never folded
      else expect(jsOk(v) || v === "" || /[\x00-\x1f]/.test(s), JSON.stringify(s)).toBe(true);
    }
    for (const t of CODE_TABLES) {
      for (const bad of ["dca", "A".repeat(31), "É"]) {
        expect(await insertCode(t, bad), `${t} ${bad}`).toMatchObject({ code: "23514", constraint: `${t}_code_check` });
      }
    }
    expect(await thrown(cat.createCourse(CA, { code: " dca ", name: "Again", categoryId: 1, divisionId: 1 })))
      .toMatchObject({ reason: "duplicate", key: "catalogue.duplicate" });
    expect(await thrown(cat.openAcademicYear(CA, { code: "2026-27", startsOn: "2026-06-01", endsOn: "2027-05-31" })))
      .toMatchObject({ reason: "duplicate" });
    expect(await thrown(cat.createMaster(CA, "course_category", { code: "a b", name: "X" })))
      .toMatchObject({ reason: "invalid", message: "code: printable ASCII, single spaces, at most 30" });
  });

  test("T-CAT-002 references are real; admit() takes only active courses and open years", async () => {
    const a = await admit(ST_TOKEN.sa, input({ courses: [{ courseCode: " python ", joinDate: "2026-11-01" }] }));
    expect(a.registrations[0]!.courseCode).toBe("PYTHON"); // normalised before storing
    expect(await tryAdmin(`insert into app.registration (id, admission_id, centre_id, course_code, register_no, join_date)
      values (gen_random_uuid(), $1, 1, 'NOPE', 'R1', '2026-11-01')`, [a.admissionId]))
      .toMatchObject({ code: "23503", constraint: "registration_course_code_fkey" });
    expect(await tryAdmin(`insert into app.admission (id, person_id, centre_id, academic_year, admission_no, admitted_on)
      values (gen_random_uuid(), $1, 1, '2030-31', 'X1', '2026-10-28')`, [a.personId]))
      .toMatchObject({ code: "23503", constraint: "admission_academic_year_fkey" });
    expect(await tryAdmin(`update app.centre set centre_class_id = 999 where id = 1`))
      .toMatchObject({ code: "23503", constraint: "centre_centre_class_id_fkey" });
    expect(await tryAdmin(`update app.course set code = 'PY' where code = 'PYTHON'`)).toMatchObject({ code: "23503" }); // restrict
    // a deactivated course: refused for new admissions, existing registrations stay
    await asAdmin((db) => db.query(`update app.course set active = false where code = 'PYTHON'`));
    expect(await thrown(admit(ST_TOKEN.sa, input({ courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }, { courseCode: "PYTHON", joinDate: "2026-11-01" }] }))))
      .toMatchObject({ reason: "invalid", message: "courses[1].courseCode: no such course" });
    expect(await thrown(admit(ST_TOKEN.sa, input({ courses: [{ courseCode: "NOPE", joinDate: "2026-11-01" }] }))))
      .toMatchObject({ message: "courses[0].courseCode: no such course" });
    expect(await asAdmin((db) => db.query(`select count(*)::int n from app.registration where course_code = 'PYTHON'`).then((r) => r.rows[0].n))).toBe(1);
    // a closed or unknown year
    await asAdmin((db) => db.query(`update app.academic_year set open = false where code = '2026-27'`));
    expect(await thrown(admit(ST_TOKEN.sa, input()))).toMatchObject({ reason: "invalid", message: "academicYear: not open" });
    expect(await thrown(admit(ST_TOKEN.sa, input({ academicYear: "2030-31" })))).toMatchObject({ message: "academicYear: not open" });
    expect(await rows("person.admit")).toHaveLength(1); // refusals write no audit row
  });

  test("T-CAT-003 writes need catalogue.manage and a fresh step-up, and are audited before and after", async () => {
    // masters
    const m = await cat.createMaster(CA, "course_category", { code: " it ", name: " IT " });
    expect(m).toEqual({ id: 2, code: "IT" });
    await cat.updateMaster(CA, "course_category", m.id, { name: "Information Technology" });
    expect(await thrown(cat.updateMaster(CA, "course_category", m.id, { name: "Information Technology" }))).toMatchObject({ message: "nothing to change" });
    expect(await thrown(cat.setMasterActive(CA, "course_category", m.id, false, " "))).toMatchObject({ message: "reason: required" });
    await cat.setMasterActive(CA, "course_category", m.id, false, "merged");
    expect(await thrown(cat.setMasterActive(CA, "course_category", m.id, false, "again"))).toMatchObject({ message: "already inactive" });
    expect(await thrown(cat.createCourse(CA, { code: "JAVA", name: "Java", categoryId: m.id, divisionId: 1 })))
      .toMatchObject({ reason: "invalid", message: "categoryId: inactive or unknown" });
    expect(await thrown(cat.updateMaster(CA, "centre_class", 99, { name: "X" }))).toMatchObject({ reason: "notfound", message: "centre_class not found" });
    // courses
    const c = await cat.createCourse(CA, { code: "java", name: "Java", categoryId: 1, divisionId: 1 });
    expect(c).toEqual({ id: 6, code: "JAVA" });
    await cat.updateCourse(CA, c.id, { name: "Java SE" });
    await cat.setCourseActive(CA, c.id, false, "retired");
    await cat.setCourseActive(CA, c.id, true, "back in the catalogue");
    expect(await thrown(cat.updateCourse(CA, c.id, { divisionId: 42 }))).toMatchObject({ message: "divisionId: inactive or unknown" });
    // academic years
    expect(await cat.openAcademicYear(CA, { code: "2029-30", startsOn: "2029-06-01", endsOn: "2030-05-31" })).toEqual({ code: "2029-30" });
    expect(await thrown(cat.updateAcademicYear(CA, "2029-30", { endsOn: "2029-05-01" }))).toMatchObject({ message: "endsOn: after startsOn" });
    await cat.updateAcademicYear(CA, "2029-30", { endsOn: "2030-04-30" });
    await cat.setAcademicYearOpen(CA, "2029-30", false, "closed for admissions");
    expect(await thrown(cat.setAcademicYearOpen(CA, "2029-30", false, "again"))).toMatchObject({ message: "already closed" });
    expect(await thrown(cat.openAcademicYear(CA, { code: "2031-32", startsOn: "2031-02-30", endsOn: "2032-05-31" })))
      .toMatchObject({ name: "RbacError", message: "startsOn: not a date" });

    const audit = async (action: string) => (await rows(action)).filter((r) => r.outcome === "OK")
      .map((r) => ({ type: r.target_type, id: r.target_id, reason: r.reason, before: r.before, after: r.after }));
    expect(await audit("catalogue.create")).toEqual([
      { type: "course_category", id: null, reason: null, before: null, after: { id: 2, code: "IT", name: "IT", active: true } },
      { type: "course", id: null, reason: null, before: null, after: { id: 6, code: "JAVA", name: "Java", categoryId: 1, divisionId: 1, active: true } },
      { type: "academic_year", id: "2029-30", reason: null, before: null, after: { code: "2029-30", startsOn: "2029-06-01", endsOn: "2030-05-31", open: true } },
    ]);
    expect(await audit("catalogue.update")).toEqual([
      { type: "course_category", id: "2", reason: null, before: { id: 2, code: "IT", name: "IT", active: true },
        after: { id: 2, code: "IT", name: "Information Technology", active: true } },
      { type: "course", id: "6", reason: null, before: { id: 6, code: "JAVA", name: "Java", categoryId: 1, divisionId: 1, active: true },
        after: { id: 6, code: "JAVA", name: "Java SE", categoryId: 1, divisionId: 1, active: true } },
      { type: "academic_year", id: "2029-30", reason: null, before: { code: "2029-30", startsOn: "2029-06-01", endsOn: "2030-05-31", open: true },
        after: { code: "2029-30", startsOn: "2029-06-01", endsOn: "2030-04-30", open: true } },
    ]);
    expect(await audit("catalogue.deactivate")).toEqual([
      { type: "course_category", id: "2", reason: "merged", before: { active: true }, after: { active: false } },
      { type: "course", id: "6", reason: "retired", before: { active: true }, after: { active: false } },
      { type: "academic_year", id: "2029-30", reason: "closed for admissions", before: { open: true }, after: { open: false } },
    ]);
    expect(await audit("catalogue.activate")).toEqual([
      { type: "course", id: "6", reason: "back in the catalogue", before: { active: false }, after: { active: true } },
    ]);

    // no permission: Forbidden, audited as DENIED; a stale step-up; an unknown kind before any database access
    expect(await thrown(cat.createMaster(ST_TOKEN.sa, "centre_class", { code: "A", name: "A" }))).toBeInstanceOf(Forbidden);
    expect((await rows("catalogue.create")).filter((r) => r.outcome === "DENIED")).toHaveLength(1);
    await setStepUp(CA, 3600);
    expect(await thrown(cat.createMaster(CA, "centre_class", { code: "A", name: "A" }))).toBeInstanceOf(StepUpRequired);
    for (const kind of ["constructor", "__proto__", "course", "app.course"]) {
      const e = await thrown(cat.createMaster(undefined, kind as cat.MasterKind, { code: "A", name: "A" }));
      expect(e, kind).toBeInstanceOf(RbacError);
      expect(e).toMatchObject({ reason: "invalid", message: "kind: unknown" });
    }

    // the database gate alone
    const inserts = [
      "insert into app.course_category (code, name) values ('ZZ', 'Z')", "insert into app.course_division (code, name) values ('ZZ', 'Z')",
      "insert into app.centre_class (code, name) values ('ZZ', 'Z')", "insert into app.course (code, name, category_id, division_id) values ('ZZ', 'Z', 1, 1)",
      "insert into app.academic_year (code, starts_on, ends_on) values ('2031-32', '2031-06-01', '2032-05-31')",
    ];
    for (const sql of inserts) await expect(as(T.uA, sql), sql).rejects.toMatchObject({ code: "42501" });
    for (const sql of ["update app.course_category set name = 'x'", "update app.course set name = 'x'", "update app.academic_year set open = false"]) {
      expect((await as(T.uA, sql)).rowCount, sql).toBe(0);
    }
    for (const sql of ["update app.course set code = 'X' where id = 1", "delete from app.course where id = 6",
      "delete from app.academic_year where code = '2029-30'", "update app.centre set centre_class_id = 1 where id = 1"]) {
      await expect(as(CA, sql), sql).rejects.toMatchObject({ code: "42501" });
    }
  });

  test("T-CAT-004 every signed-in user reads the whole catalogue", async () => {
    const codes = async (t: string) => (await as(T.uA, `select code from app.${t} order by code`)).rows.map((r) => r.code);
    expect(await codes("course_category")).toEqual(["GEN"]);
    expect(await codes("course_division")).toEqual(["GEN"]);
    expect(await codes("centre_class")).toEqual(["METRO"]);
    expect(await codes("course")).toEqual(["CCNA", "DCA", "DTP", "PYTHON", "TALLY"]);
    expect(await codes("academic_year")).toEqual(["2024-25", "2025-26", "2026-27", "2027-28", "2028-29"]);
  });
});
