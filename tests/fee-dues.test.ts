// Fee dues: T-FD-001…003 (audit 09; docs/designs/fee-dues/fee-dues.md). The learner page is a real-server smoke check.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as duesRoute } from "../app/students/[personId]/dues/route";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import { Forbidden } from "../src/server/action";
import { PersonError } from "../src/server/person-rules";
import { admit, type AdmitInput } from "../src/server/people";
import * as fee from "../src/server/fees";
import { createDues, duesForPerson } from "../src/server/dues";
import { asAdmin, C, FD, reset, rows, setStepUp, ST_TOKEN, T } from "./fixtures";
import { DCA, FEE_S, METRO, seedFeePlan } from "./fee-seed";

const D = "tok-feeD", V = ST_TOKEN.sa; // fee.dues + student.view at A; student.view (+ admit) at A, no fee.dues
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const sqlErr = (q: string, p: unknown[] = []) => asAdmin(async (db) => {
  await db.query("begin");
  try { await db.query(q, p); return null; } catch (e) { return e as { code: string; message: string }; } finally { await db.query("rollback"); }
});
let n = 0;
const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({
  person: { givenName: `Learner${++n}`, mobile: `98100${String(n).padStart(5, "0")}` }, centreId: C.A, academicYear: "2026-27",
  admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });
/** A learner at A with DCA (priced) and TALLY (no plan). */
async function learner() {
  const a = await admit(V, input({ courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }, { courseCode: "TALLY", joinDate: "2026-11-01" }] }));
  const reg = (c: string) => a.registrations.find((r) => r.courseCode === c)!.id;
  return { personId: a.personId, admissionId: a.admissionId, dca: reg("DCA"), tally: reg("TALLY") };
}

let app: pg.Client;
/** One statement as gems_app under a session, rolled back; the error (code, message) or the rows. */
const as = async (tok: string, q: string, p: unknown[] = []) => {
  await app.query("begin");
  await app.query("select set_config('app.session_id', $1, true)", [tok]);
  try { return { rows: (await app.query(q, p)).rows, err: null }; }
  catch (e) { return { rows: [], err: e as { code: string; message: string } }; }
  finally { await app.query("rollback"); }
};
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
let seed: Awaited<ReturnType<typeof seedFeePlan>>;
beforeEach(async () => { await reset(); await setStepUp(FEE_S, 0); seed = await seedFeePlan(); });

describe("T-FD fee dues", () => {
  test("T-FD-001 creating dues: once, from the plan, exact; refusals; the learner page's data", async () => {
    const L = await learner();
    // before: both can be created; TALLY has no plan; a viewer sees them but cannot create; out of scope sees nothing
    expect(await duesForPerson(D, L.personId)).toEqual([
      { registrationId: L.dca, dues: [], total: null, canCreate: true, noPlan: false },
      { registrationId: L.tally, dues: [], total: null, canCreate: true, noPlan: true }]);
    expect((await duesForPerson(V, L.personId)).map((r) => r.canCreate)).toEqual([false, false]);
    expect(await duesForPerson(T.uA, L.personId)).toEqual([]);
    expect(await duesForPerson(D, "not-a-uuid")).toEqual([]);
    // who may: a viewer is refused (and audited DENIED); out of scope and another person's registration are not found
    expect(await thrown(createDues(V, L.personId, L.dca))).toBeInstanceOf(Forbidden);
    expect((await rows("fee.dues.create")).filter((r) => r.outcome === "DENIED")[0]).toMatchObject({ target_type: "registration", target_id: L.dca });
    expect(await thrown(createDues(T.uA, L.personId, L.dca))).toMatchObject({ reason: "notfound" });
    const other = await learner();
    expect(await thrown(createDues(D, L.personId, other.dca))).toBeInstanceOf(PersonError);
    expect(await thrown(createDues(D, L.personId, "x"))).toMatchObject({ reason: "notfound" });
    // created: one per line, in order, exact, in the plan's currency; audited
    expect(await createDues(D, L.personId, L.dca)).toEqual({ count: 4, total: "20500.60" });
    const made = await sql(`select plan_id, fee_type_id, caption_id, due_on::text, gross::text, currency, created_by::text from app.fee_due order by id`);
    expect(made).toEqual(seed.lines.map((l) => ({ plan_id: seed.planId, fee_type_id: l.feeTypeId, caption_id: l.captionId, due_on: l.dueOn,
      gross: l.amount, currency: "INR", created_by: FD.a })));
    expect((await rows("fee.dues.create")).filter((r) => r.outcome === "OK")[0]).toMatchObject({ target_type: "registration", target_id: L.dca,
      after: { planId: seed.planId, version: 1, count: 4, total: "20500.60" } });
    // once; no plan; an inactive centre; a registration no longer active
    expect(await thrown(createDues(D, L.personId, L.dca))).toMatchObject({ key: "fee.dues.exists" });
    expect((await duesForPerson(D, L.personId)).map((r) => r.canCreate)).toEqual([false, true]); // dues made: nothing more to create
    expect(await thrown(createDues(D, L.personId, L.tally))).toMatchObject({ key: "fee.dues.noplan" });
    // an inactive centre (the session stays valid through the user's active centre A)
    const atA2 = await admit(ST_TOKEN.sr, input({ centreId: C.A2 }));
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 29, 'CENTRE', $2)`, [FD.a, C.A2]);
    await sql(`update app.centre set status = 'INACTIVE' where id = $1`, [C.A2]);
    expect(await thrown(createDues(D, atA2.personId, atA2.registrations[0]!.id))).toMatchObject({ message: "centreId: centre is not active" });
    expect((await duesForPerson(D, atA2.personId))[0]!.canCreate).toBe(false);
    await sql(`update app.registration set status = 'DROP' where id = $1`, [other.dca]);
    expect(await thrown(createDues(D, other.personId, other.dca))).toMatchObject({ message: "registrationId: not active" });
    expect((await duesForPerson(D, other.personId))[0]!.canCreate).toBe(false);
    // a newer plan never reprices existing dues, and is the one new dues come from
    const { id: v2 } = await fee.createPlan(FEE_S, { academicYear: "2026-27", courseId: DCA, centreClassId: METRO });
    await fee.setPlanLine(FEE_S, v2, { feeTypeId: seed.course, captionId: seed.i2, amount: "9000" });
    await fee.publishPlan(FEE_S, v2, "new prices");
    const third = await learner();
    expect(await createDues(D, third.personId, third.dca)).toEqual({ count: 4, total: "21500.60" });
    // the page's data: dues by (due_on, id), totals, nothing more to create
    const page = await duesForPerson(V, L.personId);
    expect(page[0]).toMatchObject({ registrationId: L.dca, total: "20500.60", canCreate: false, noPlan: false });
    expect(page[0]!.dues.map((d) => [d.feeTypeName, d.captionName, d.dueOn, d.gross, d.currency])).toEqual([
      ["Registration", "INSTALLMENT 1", "2026-11-30", "500.00", "INR"], ["Course Fee", "INSTALLMENT 1", "2026-11-30", "12000.50", "INR"],
      ["Registration", "INSTALLMENT 2", "2027-01-31", "0.10", "INR"], ["Course Fee", "INSTALLMENT 2", "2027-01-31", "8000.00", "INR"]]);
    expect(page[1]).toMatchObject({ registrationId: L.tally, dues: [], total: null });
  });

  test("T-FD-002 the database proves each due against its plan and registration, and keeps it", async () => {
    const L = await learner();
    const line = seed.lines[0]!; // reg x INSTALLMENT 1, 500.00
    const ins = (o: Partial<{ reg: string; centre: number; plan: number; type: number; caption: number; due: string; gross: string; cur: string }> = {}) =>
      [`insert into app.fee_due (registration_id, centre_id, plan_id, fee_type_id, caption_id, due_on, gross, currency)
        values ($1, $2, $3, $4, $5, $6, $7, $8) returning created_by::text, created_at`,
      [o.reg ?? L.dca, o.centre ?? C.A, o.plan ?? seed.planId, o.type ?? line.feeTypeId, o.caption ?? line.captionId, o.due ?? line.dueOn,
        o.gross ?? line.amount, o.cur ?? "INR"]] as [string, unknown[]];
    const refused = async (o: Parameters<typeof ins>[0], text: string) => {
      const { err } = await as(D, ...ins(o));
      expect(err, text).toMatchObject({ code: "23514" });
      expect(err!.message, JSON.stringify(o)).toContain(text);
    };
    // the right row passes; who and when are the database's
    const ok = await as(D, ...ins());
    expect(ok.err).toBeNull();
    expect(ok.rows[0]).toMatchObject({ created_by: FD.a });
    const stamped = await asAdmin(async (db) => {
      await db.query("begin");
      try {
        return (await db.query(`insert into app.fee_due (registration_id, centre_id, plan_id, fee_type_id, caption_id, due_on, gross, currency, created_by, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, 'INR', $8, '2000-01-01') returning created_at > now() - interval '1 minute' as fresh`,
          [L.dca, C.A, seed.planId, line.feeTypeId, line.captionId, line.dueOn, line.amount, FD.a])).rows[0];
      } finally { await db.query("rollback"); }
    });
    expect(stamped).toEqual({ fresh: true });
    // the copy is exact
    await refused({ gross: "500.01" }, "a due copies its plan line");
    await refused({ due: "2026-12-01" }, "a due copies its plan line");
    await refused({ cur: "USD" }, "a due copies its plan line");
    await refused({ reg: "00000000-0000-0000-0000-000000000001" }, "the registration is not found");
    await refused({ centre: C.A2 }, "the registration is not found");
    // the plan is this registration's: course, year, centre or class; published
    await refused({ reg: L.tally }, "another course or year");
    const { id: draft } = await fee.createPlan(FEE_S, { academicYear: "2026-27", courseId: DCA, centreClassId: METRO }); // copies the lines
    await refused({ plan: draft }, "dues come from a published plan");
    // the owner sees the draft, so its status (not its visibility) is what refuses it
    expect((await sqlErr(...ins({ plan: draft })))?.message).toContain("dues come from a published plan");
    await sql(`update app.centre set centre_class_id = $1 where id = $2`, [METRO, C.A2]);
    const { id: a2 } = await fee.createPlan(FEE_S, { academicYear: "2026-27", courseId: DCA, centreId: C.A2 });
    await fee.setPlanLine(FEE_S, a2, { feeTypeId: line.feeTypeId, captionId: line.captionId, amount: line.amount });
    await fee.publishPlan(FEE_S, a2, "A2 override");
    await refused({ plan: a2 }, "the plan is for another centre");
    const { id: nextCap } = await fee.createCaption(FEE_S, { academicYear: "2027-28", name: "NEXT", dueOn: "2027-11-30", sortOrder: 1 });
    const { id: y2 } = await fee.createPlan(FEE_S, { academicYear: "2027-28", courseId: DCA, centreClassId: METRO });
    await fee.setPlanLine(FEE_S, y2, { feeTypeId: line.feeTypeId, captionId: nextCap, amount: line.amount });
    await fee.publishPlan(FEE_S, y2, "next year");
    await refused({ plan: y2, caption: nextCap, due: "2027-11-30" }, "another course or year");
    // a class plan for a centre that has left the class
    await sql(`update app.centre set centre_class_id = null where id = $1`, [C.A]);
    await refused({}, "the plan is for another centre class");
    await sql(`update app.centre set centre_class_id = $1 where id = $2`, [METRO, C.A]);
    // an active registration only
    await sql(`update app.registration set status = 'LEAVE' where id = $1`, [L.dca]);
    await refused({}, "dues are for an active registration");
    await sql(`update app.registration set status = 'ACTIVE' where id = $1`, [L.dca]);
    // one plan per registration: dues from v1, then a line of a newer published version
    await createDues(D, L.personId, L.dca);
    await fee.publishPlan(FEE_S, draft, "v2");
    await refused({ plan: draft, type: seed.course, caption: seed.i1, gross: "12000.50" }, "a registration's dues come from one plan");
    // the same line twice: the unique key
    expect((await as(D, ...ins())).err).toMatchObject({ code: "23505" });
    // a viewer may not create; nobody outside student.view sees
    const other = await learner();
    expect((await as(V, ...ins({ reg: other.dca }))).err).toMatchObject({ code: "42501" });
    expect((await as(T.uA, "select count(*)::int n from app.fee_due")).rows[0]).toEqual({ n: 0 });
    expect((await as(V, "select count(*)::int n from app.fee_due")).rows[0]).toEqual({ n: 4 });
    // kept forever: no update, delete or truncate, even as the owner; gems_app has no update or delete either
    for (const q of ["update app.fee_due set gross = 0", "delete from app.fee_due", "truncate app.fee_due"]) {
      expect((await sqlErr(q))?.message, q).toContain("fee_due is append-only");
    }
    expect((await as(D, "update app.fee_due set gross = 0")).err).toMatchObject({ code: "42501" });
    expect((await as(D, "delete from app.fee_due")).err).toMatchObject({ code: "42501" });
    // a centre move with dues: the cascade into the registration is refused (D6); without dues it goes through
    expect(await sqlErr(`update app.admission set centre_id = $1 where id = $2`, [C.A2, L.admissionId])).toMatchObject({ code: "23503", message: expect.stringContaining("fee_due") });
    expect(await sqlErr(`update app.admission set centre_id = $1 where id = $2`, [C.A2, other.admissionId])).toBeNull();
    // concurrent inserts from two plans: the guard's lock makes the second wait, then see the first and refuse
    const third = await learner();
    const [c1, c2] = [new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }), new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] })];
    await c1.connect(); await c2.connect();
    try {
      for (const c of [c1, c2]) { await c.query("begin"); await c.query("select set_config('app.session_id', $1, true)", [D]); }
      const [q1, p1] = ins({ reg: third.dca }), [q2, p2] = ins({ reg: third.dca, plan: draft, type: seed.course, caption: seed.i1, gross: "12000.50" });
      await c1.query(q1, p1);
      const second = c2.query(q2, p2).then(() => null, (e: { message: string }) => e.message);
      await new Promise((r) => setTimeout(r, 300));
      await c1.query("commit");
      expect(await second).toContain("a registration's dues come from one plan");
    } finally { await c2.query("rollback").catch(() => {}); await c1.end(); await c2.end(); }
  });

  test("T-FD-003 the dues route: origin, success and errors back on the learner page, 404s", async () => {
    const L = await learner();
    const other = await learner();
    const ORIGIN = "https://gems.test";
    const post = (personId: string, body: Record<string, string>, origin = ORIGIN) => duesRoute(new Request(`${ORIGIN}/students/${personId}/dues`, {
      method: "POST", body: new URLSearchParams(body), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${D}`, origin } }),
      { params: Promise.resolve({ personId }) });
    const where = (r: Response) => { const u = new URL(r.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const P = `/students/${L.personId}`;
    expect((await post(L.personId, { registrationId: L.dca }, "https://evil.example")).status).toBe(403);
    expect(where(await post(L.personId, { registrationId: L.dca }))).toBe(`${P}?saved=1`);
    expect(where(await post(L.personId, { registrationId: L.dca }))).toBe(`${P}?error=fee.dues.exists`);
    expect(where(await post(L.personId, { registrationId: L.tally }))).toBe(`${P}?error=fee.dues.noplan`);
    await sql(`update app.registration set status = 'DROP' where id = $1`, [other.tally]);
    expect(where(await post(other.personId, { registrationId: other.tally }))).toBe(`/students/${other.personId}?error=invalid&detail=registrationId`);
    expect((await post(L.personId, { registrationId: other.dca })).status).toBe(404);
    expect((await post(L.personId, {})).status).toBe(404);
    expect((await post("x", { registrationId: L.dca })).status).toBe(404);
  });
});
