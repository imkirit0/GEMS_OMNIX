// Admission screens acceptance tests: T-ADM-001…004, 006 at the server level (audit 09; docs/designs/admission-screens).
// T-ADM-005 and the button order run on the real server (scripts/smoke-security.mjs).
import { beforeEach, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Forbidden } from "../src/server/action";
import { ADMIT_MESSAGES, submitAdmission, type AdmitFormState } from "../src/server/admission-form";
import { RateLimited } from "../src/server/exports";
import { admitOptions, getPerson, listAdmissions, PersonError } from "../src/server/people";
import { asAdmin, C, reset, rows, ST, ST_TOKEN, T } from "./fixtures";

const { sa, sb, sr, sh } = ST_TOKEN;
const H = new Headers({ origin: "http://localhost", host: "localhost" });
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
let n = 0;
/** A complete form for a fresh learner at centre A, with its own form id. */
const fields = (o: Record<string, string> = {}): Record<string, string> => ({
  centreId: String(C.A), academicYear: "2026-27", admittedOn: "2026-10-28", givenName: `Asha${++n}`, familyName: "Varma",
  gender: "FEMALE", dateOfBirth: "2001-05-05", mobile: `98765${String(n).padStart(5, "0")}`,
  "course.1.courseCode": "DCA", "course.1.joinDate": "2026-11-01", "course.2.courseCode": "", "course.3.courseCode": "",
  currentPincode: "682001", employmentStatus: "STUDENT", qualification: "SSLC", // learner-details DD-6
  admissionId: randomUUID(), ...o,
});
const submit = (tok: string, f: Record<string, string>, h = H) => submitAdmission(tok, h, form(f));
const personOf = (r: AdmitFormState | { redirect: string }) => {
  expect(r, JSON.stringify(r)).toHaveProperty("redirect");
  return (r as { redirect: string }).redirect.replace("/students/", "");
};
const stateOf = (r: AdmitFormState | { redirect: string }) => {
  expect(r, JSON.stringify(r)).not.toHaveProperty("redirect");
  return r as AdmitFormState;
};
const admin = (sql: string, params: unknown[] = []) => asAdmin((db) => db.query(sql, params).then((q) => q.rows));
const count = async (where = "true", params: unknown[] = []) => (await admin(`select count(*)::int n from app.admission where ${where}`, params))[0].n as number;
const failed = async () => (await rows("person.admit")).filter((r) => r.outcome === "FAILED").map((r) => ({ reason: r.reason, detail: r.detail }));
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };

beforeEach(() => reset());

describe("admission screens (T-ADM)", () => {
  test("T-ADM-001 admit through the form; admit implies view; the form's options", async () => {
    const f = fields();
    const personId = personOf(await submit(sa, f));
    const view = await getPerson(sa, personId);
    expect(view.person).toMatchObject({ givenName: f["givenName"], familyName: "Varma", gender: "FEMALE", dateOfBirth: "2001-05-05" });
    expect(view.admissions).toMatchObject([{ id: f["admissionId"], centreCode: "KL2-25", academicYear: "2026-27", admissionNo: "GTEC262743888",
      registrations: [{ courseCode: "DCA", courseName: "Diploma in Computer Applications", registerNo: "2064113", status: "ACTIVE" }] }]);
    // DD-9: every role with student.admit also holds student.view (and the check is not vacuous)
    const admitRoles = await admin(`select role_id from app.role_permission where permission_key = 'student.admit'`);
    expect(admitRoles.length).toBeGreaterThan(0);
    expect(await admin(`select role_id from app.role_permission where permission_key = 'student.admit'
      except select role_id from app.role_permission where permission_key = 'student.view'`)).toEqual([]);
    const o = await admitOptions(sa);
    expect(o.centres).toEqual([{ id: C.A, code: "KL2-25", name: "Centre A" }]);
    expect(o.years.map((y) => y.code)).toEqual(["2024-25", "2025-26", "2026-27", "2027-28", "2028-29"]);
    expect(o.courses.map((c) => c.code)).toEqual(["CCNA", "DCA", "DTP", "PYTHON", "TALLY"]);
    expect(o.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await thrown(admitOptions(T.uA))).toBeInstanceOf(Forbidden);
  });

  test("T-ADM-002 duplicates are shown before anything is written; only shown candidates are dismissed; audited", async () => {
    const f = fields({ givenName: "Asha", mobile: "9876500001" });
    const p = personOf(await submit(sa, f));
    // Y: same names and mobile, another date of birth (another match key)
    const y = personOf(await submit(sa, fields({ givenName: "Asha", mobile: "9876500001", dateOfBirth: "2001-06-06" })));
    // the regional user admits the same identity at A2
    const again = { ...f, centreId: String(C.A2), admissionId: randomUUID() };
    const dup = stateOf(await submit(sr, again));
    expect(dup.candidates).toEqual([{ id: p, givenName: "Asha", familyName: "Varma", dateOfBirth: "2001-05-05" }]); // no mobile
    expect(dup.values["mobile"]).toBe("9876500001"); // values kept, in the state only
    expect(await count()).toBe(2);
    expect(await failed()).toEqual([{ reason: "duplicate", detail: { candidates: [p] } }]);
    // an edited identity with new matches gets the new list, even with the old ids dismissed
    const edited = stateOf(await submit(sr, { ...again, dateOfBirth: "2001-06-06", confirmNew: p }));
    expect(edited.candidates?.map((c) => c.id)).toEqual([y]);
    // "Admit this person": the existing person, identity unchanged; DOB and mobile not required on this path
    const linked = await submit(sr, { ...again, existingId: p, givenName: "Typed", dateOfBirth: "", mobile: "" });
    expect(personOf(linked)).toBe(p);
    expect((await getPerson(sh, p)).person.givenName).toBe("Asha");
    expect((await getPerson(sh, p)).admissions.map((a) => a.centreCode)).toEqual(["KL2-25", "KL3-07"]);
    // "None of these" with the shown ids: a new person
    const fresh = personOf(await submit(sr, { ...f, centreId: String(C.A2), admissionId: randomUUID(), confirmNew: p }));
    expect([fresh === p, fresh === y]).toEqual([false, false]);
    // nothing personal in any redirect
    for (const r of [linked]) expect(JSON.stringify(r)).not.toMatch(/Asha|9876500001|2001-05-05/);
  });

  test("T-ADM-003 errors land on the right input or as a form message, with the values kept", async () => {
    await admin(`update app.academic_year set open = false where code = '2026-27'`);
    expect(stateOf(await submit(sa, fields())).fieldErrors).toEqual({ academicYear: "not open" });
    await admin(`update app.academic_year set open = true where code = '2026-27'`);
    // row 1 valid, row 2 empty, row 3 an inactive course: the error names form row 3
    await admin(`update app.course set active = false where code = 'PYTHON'`);
    const rowErr = stateOf(await submit(sa, fields({ "course.3.courseCode": "PYTHON", "course.3.joinDate": "2026-11-01" })));
    expect(rowErr.fieldErrors).toEqual({ "course.3.courseCode": "no such course" });
    expect(stateOf(await submit(sa, fields({ admittedOn: "2026-02-30" }))).fieldErrors).toEqual({ admittedOn: "not a date" });
    // DOB and mobile are required for a new person only
    expect(stateOf(await submit(sa, fields({ dateOfBirth: "", mobile: "" }))).fieldErrors).toEqual({ dateOfBirth: "required", mobile: "required" });
    const stale = stateOf(await submit(sa, fields({ dateOfBirth: "", mobile: "", existingId: randomUUID() })));
    expect([stale.fieldErrors, stale.formError]).toEqual([{}, ADMIT_MESSAGES.stale]);
    // only the known input names are echoed
    const echo = stateOf(await submit(sa, fields({ "$ACTION_X": "1", "course.2.joinDate": "x", admittedOn: "" })));
    expect(echo.values).not.toHaveProperty("$ACTION_X");
    expect(echo.values["course.2.joinDate"]).toBe("x");
    expect(echo.fieldErrors).toEqual({ admittedOn: "YYYY-MM-DD" });
    // a missing number series is a form message
    await admin(`delete from app.global_number_series where series = 'REGISTER'`);
    expect(stateOf(await submit(sa, fields())).formError).toBe(ADMIT_MESSAGES.series);
    // no Origin (or Origin: null) is refused before anything else
    for (const h of [new Headers({ host: "localhost" }), new Headers({ origin: "null", host: "localhost" })]) {
      expect(await thrown(submit(sa, fields(), h))).toBeInstanceOf(Forbidden);
    }
  });

  test("T-ADM-003 a connection lost at COMMIT says submit again and keeps the form id; the resubmit admits once", async () => {
    await admin(`create function app.test_lose() returns trigger language plpgsql as $$
      begin perform pg_terminate_backend(pg_backend_pid()); return null; end $$`);
    await admin(`create constraint trigger test_lose after insert on app.admission deferrable initially deferred
      for each row when (new.admitted_on = date '2001-01-01') execute function app.test_lose()`);
    const f = fields({ admittedOn: "2001-01-01" });
    try {
      const s = stateOf(await submit(sa, f));
      expect([s.formError, s.admissionId, s.values["givenName"]]).toEqual([ADMIT_MESSAGES.dropped, f["admissionId"], f["givenName"]]);
      expect(await count()).toBe(0);
    } finally {
      await admin(`drop trigger test_lose on app.admission; drop function app.test_lose()`);
    }
    personOf(await submit(sa, f));
    expect(await count()).toBe(1);
  });

  test("T-ADM-004 list and view: student.view scope only, search terms literal, rate limited", async () => {
    const anu = personOf(await submit(sa, fields({ givenName: "Anu", familyName: "Raj", mobile: "9876511111" })));
    personOf(await submit(sa, fields({ givenName: "Zed" })));
    const bina = personOf(await submit(sb, fields({ centreId: String(C.B), givenName: "Bina" })));
    // centre B's user who also holds a ticket role at A still sees only B (the student.view filter, not just RLS)
    await admin(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 10, 'CENTRE', $2)`, [ST.sb, C.A]);
    expect((await listAdmissions(sb)).map((r) => r.personId)).toEqual([bina]);
    expect(await thrown(getPerson(sb, anu))).toMatchObject({ reason: "notfound" });
    expect(await thrown(getPerson(sa, "not-a-uuid"))).toBeInstanceOf(PersonError);
    expect(await thrown(listAdmissions(T.uA))).toBeInstanceOf(Forbidden);
    const all = await listAdmissions(sa);
    expect(all).toHaveLength(2);
    expect(Object.keys(all[0]!).sort()).toEqual(["academicYear", "admissionId", "admissionNo", "admittedOn", "centreCode", "centreId", "familyName", "givenName", "personId"]);
    const q = async (text: string, centreId?: number) => (await listAdmissions(sa, { q: text, ...(centreId === undefined ? {} : { centreId }) })).map((r) => r.personId);
    expect(await q("anu")).toEqual([anu]);
    expect(await q("a%")).toEqual([]); // % is literal
    expect(await q("RAJ")).toEqual([anu]);
    const anuRow = all.find((r) => r.personId === anu)!;
    expect(await q(anuRow.admissionNo.toLowerCase())).toEqual([anu]);
    const [reg] = await admin(`select register_no from app.registration where admission_id = $1`, [anuRow.admissionId]);
    expect(await q(reg.register_no)).toEqual([anu]);
    expect(await q("+91 98765 11111")).toEqual([anu]);
    expect((await listAdmissions(sa, { centreId: C.A })).length).toBe(2);
    expect(await listAdmissions(sa, { centreId: C.B })).toEqual([]);
    expect(await listAdmissions(sa, { centreId: Number.NaN })).toEqual([]);
    let limited: unknown;
    for (let i = 0; i < 31 && !limited; i++) await listAdmissions(sa, { q: "zz" }).catch((e) => { limited = e; });
    expect(limited).toBeInstanceOf(RateLimited);
  });

  test("T-ADM-006 a form admits once; outside the caller's scope the message names no one; one admission per centre and year", async () => {
    const f = fields();
    const p = personOf(await submit(sa, f));
    const again = stateOf(await submit(sa, f));
    expect([again.formError, again.savedPersonId]).toEqual([ADMIT_MESSAGES.saved, p]);
    expect(await count("id = $1", [f["admissionId"]])).toBe(1);
    expect(await failed()).toEqual([{ reason: "already_submitted", detail: { admissionId: f["admissionId"] } }]);
    // concurrently: one admission, the other submit is told so
    const g = fields();
    const both = await Promise.all([submit(sa, g), submit(sa, g)]);
    expect(both.filter((r) => "redirect" in r)).toHaveLength(1);
    expect(both.map((r) => ("redirect" in r ? null : r.formError)).filter(Boolean)).toEqual([ADMIT_MESSAGES.saved]);
    expect(await count("id = $1", [g["admissionId"]])).toBe(1);
    // an id saved at centre B: sa cannot see it (the primary key answers), then sees it through a ticket role (the check answers)
    const b = fields({ centreId: String(C.B) });
    personOf(await submit(sb, b));
    const pk = stateOf(await submit(sa, { ...fields(), admissionId: b["admissionId"]! }));
    expect([pk.formError, pk.savedPersonId]).toEqual([ADMIT_MESSAGES.saved, undefined]);
    await admin(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 10, 'CENTRE', $2)`, [ST.sa, C.B]);
    const seen = stateOf(await submit(sa, { ...fields(), admissionId: b["admissionId"]! }));
    expect([seen.formError, seen.savedPersonId]).toEqual([ADMIT_MESSAGES.saved, undefined]);
    expect(await count("id = $1", [b["admissionId"]])).toBe(1);
    // the same person at the same centre in the same year, with a new form
    const twice = stateOf(await submit(sa, fields({ existingId: p })));
    expect(twice.formError).toBe(ADMIT_MESSAGES.thisYear);
  });

  test("T-ADM-006 the action files export only the three actions (read as text: importing them needs next/headers)", () => {
    const found: string[] = [];
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === "actions.ts" ? [path.join(d, e.name)] : []));
    for (const f of walk("app")) {
      const src = fs.readFileSync(f, "utf8");
      expect(src.startsWith('"use server"'), f).toBe(true);
      expect(src, f).not.toMatch(/export\s*\{|export\s+default/);
      for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm)) found.push(m[1]!);
    }
    expect(found.sort()).toEqual(["admitAction", "saveDetailsAction", "searchAction"]);
  });
});
