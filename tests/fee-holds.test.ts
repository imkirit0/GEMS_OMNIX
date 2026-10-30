// Fee holds: T-FH-001…003 (audit 09; docs/designs/fee-holds/fee-holds.md). The hold list page is a real-server smoke check.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as holdRoute } from "../app/students/[personId]/holds/route";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import { Forbidden } from "../src/server/action";
import { PersonError } from "../src/server/person-rules";
import { admit, type AdmitInput } from "../src/server/people";
import { createDues, duesForPerson } from "../src/server/dues";
import * as fee from "../src/server/fees";
import { collectFee, FEE_GATES, type CollectInput } from "../src/server/receipts";
import { heldDues, holdCentres, holdHistory, setHold } from "../src/server/holds";
import { asAdmin, C, FH, reset, rows, setStepUp, ST_TOKEN, T } from "./fixtures";
import { FEE_S, seedFeePlan } from "./fee-seed";

const H = "tok-feeH", K = "tok-feeC", D = "tok-feeD", V = ST_TOKEN.sa;
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const key = () => crypto.randomUUID();
let n = 0;
const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({
  person: { givenName: `Hold${++n}`, mobile: `98600${String(n).padStart(5, "0")}` }, centreId: C.A, academicYear: "2026-27",
  admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });
async function learner(centreId: number = C.A, tok: string = V) {
  const a = await admit(tok, input({ centreId }));
  const dca = a.registrations[0]!.id;
  await createDues(D, a.personId, dca);
  const dues = (await sql(`select id::text from app.fee_due where registration_id = $1 and source = 'PLAN' order by due_on, id`, [dca])).map((r) => r.id as string);
  return { personId: a.personId, dca, dues };
}
const pay = (personId: string, registrationId: string, o: Partial<CollectInput> = {}) =>
  collectFee(K, personId, { registrationId, amount: "100", mode: "CASH", idempotencyKey: key(), ...o });
const paidDues = async (receiptId: string) => (await sql(`select due_id::text as d, amount::text as a from app.receipt_allocation where receipt_id = $1 order by id`, [receiptId]))
  .map((r) => [r.d, r.a]);

let app: pg.Client;
let seed: Awaited<ReturnType<typeof seedFeePlan>>;
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(async () => {
  await reset(); await setStepUp(FEE_S, 0); seed = await seedFeePlan();
  FEE_GATES.collectionLive = true;
  const [{ p }] = await sql(`select app.financial_year((now() at time zone 'Asia/Kolkata')::date) as p`);
  await sql(`insert into app.number_series (centre_id, doc_type, period, gap_rule) select c, 'FEEREC', $1, 'GAPLESS' from unnest(array[1, 2, 3]) c
    on conflict do nothing`, [p]);
});
afterEach(() => { FEE_GATES.collectionLive = false; });

describe("T-FH fee holds", () => {
  test("T-FH-001 hold and release: owed but not collected, refusals, audit, items still collected", async () => {
    const L = await learner();
    const [d1, d2, d3] = L.dues as [string, string, string];
    await setHold(H, L.personId, d1, true, "  disputed  ");
    const [reg] = await duesForPerson(H, L.personId);
    expect(reg).toMatchObject({ outstanding: "20500.60", collectable: "20000.60", canHold: true });
    expect(reg!.dues.map((d) => d.held)).toEqual([true, false, false, false]);
    expect((await rows("fee.hold")).filter((r) => r.outcome === "OK")[0]).toMatchObject({ target_type: "fee_due", target_id: d1, reason: "disputed",
      after: { dueId: d1, registrationId: L.dca, owed: "500.00", action: "HOLD" } });
    // collection takes the other dues, oldest first; asking for more than is collectable is refused as held
    const r1 = await pay(L.personId, L.dca, { amount: "600" });
    expect(await paidDues(r1.receiptId)).toEqual([[d2, "600.00"]]);
    expect(await thrown(pay(L.personId, L.dca, { amount: "19900.60" }))).toMatchObject({ key: "fee.receipt.held" });
    expect(await thrown(pay(L.personId, L.dca, { amount: "20000.00" }))).toMatchObject({ key: "fee.receipt.over" });
    await pay(L.personId, L.dca, { amount: "19400.60" });
    expect(await thrown(pay(L.personId, L.dca, { amount: "1" }))).toMatchObject({ key: "fee.receipt.held" }); // only the held due is left
    // ad-hoc items are still collected while every due is held
    const { id: EXAM } = await fee.createFeeType(FEE_S, { code: "exam", name: "Exam Fee", categoryId: seed.catId, sortOrder: 20, hsnSac: "999293", gstRate: "18",
      accountId: (await sql(`select id from app.account where code = '3923'`))[0].id });
    expect((await pay(L.personId, L.dca, { amount: "0", extras: [{ feeTypeId: EXAM, amount: "50" }] })).total).toBe("50.00");
    // refusals, by message
    expect(await thrown(setHold(H, L.personId, d1, true, "again"))).toMatchObject({ key: "fee.hold.state" });
    expect(await thrown(setHold(H, L.personId, d2, false, "not held"))).toMatchObject({ key: "fee.hold.state" });
    expect(await thrown(setHold(H, L.personId, d2, true, "paid up"))).toMatchObject({ key: "fee.hold.paid" }); // d2 fully paid
    expect(await msg(setHold(H, L.personId, d3, true, " "))).toBe("reason: required");
    expect(await msg(setHold(H, L.personId, d3, true, "x".repeat(501)))).toBe("reason: 1-500 characters");
    expect(await thrown(setHold(V, L.personId, d3, true, "viewer"))).toBeInstanceOf(Forbidden);
    expect((await rows("fee.hold")).filter((r) => r.outcome === "DENIED")[0]).toMatchObject({ detail: { permission: "fee.hold" } });
    const other = await learner();
    expect(await thrown(setHold(H, L.personId, other.dues[0]!, true, "wrong learner"))).toBeInstanceOf(PersonError);
    expect(await thrown(setHold(T.uA, L.personId, d3, true, "out of scope"))).toBeInstanceOf(PersonError);
    expect(await thrown(setHold(H, L.personId, "x", true, "bad id"))).toBeInstanceOf(PersonError);
    const [adhoc] = await sql(`select id::text from app.fee_due where registration_id = $1 and source = 'ADHOC'`, [L.dca]);
    expect(await thrown(setHold(H, L.personId, adhoc.id, true, "item"))).toMatchObject({ key: "fee.hold.mismatch" });
    // release: collected again, audited
    await setHold(H, L.personId, d1, false, "resolved");
    expect((await rows("fee.release")).filter((r) => r.outcome === "OK")[0]).toMatchObject({ reason: "resolved", after: { dueId: d1, action: "RELEASE" } });
    const r3 = await pay(L.personId, L.dca, { amount: "500" });
    expect(await paidDues(r3.receiptId)).toEqual([[d1, "500.00"]]);
    // an inactive centre (the session stays valid through the user's active centre A)
    await sql(`update app.centre set centre_class_id = 1 where id = $1`, [C.A2]);
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 33, 'CENTRE', $2), ($3, 29, 'CENTRE', $2)`,
      [FH.a, C.A2, "00000000-0000-0000-0000-0000000000f7"]);
    const atA2 = await learner(C.A2, ST_TOKEN.sr);
    await sql(`update app.centre set status = 'INACTIVE' where id = $1`, [C.A2]);
    expect(await msg(setHold(H, atA2.personId, atA2.dues[0]!, true, "closed centre"))).toBe("centreId: centre is not active");
  });

  test("T-FH-002 the database proves holds: no line on a held due, alternation, plan dues of the centre, owed, lock order", async () => {
    const L = await learner();
    const [d1, d2] = L.dues as [string, string];
    const as = async (tok: string, steps: (c: pg.Client) => Promise<unknown>) => {
      await app.query("begin");
      try {
        await app.query("select set_config('app.session_id', $1, true)", [tok]);
        return { v: await steps(app), err: null };
      } catch (e) { return { v: null, err: e as { code: string; message: string } }; }
      finally { await app.query("rollback"); }
    };
    const ev = (due: string, action: string, centre = 1) => (c: pg.Client) =>
      c.query(`insert into app.fee_hold_event (due_id, centre_id, action, reason) values ($1, $2, $3, 'r') returning created_by::text as by`, [due, centre, action]).then((r) => r.rows[0]);
    expect((await as(H, ev(d1, "HOLD"))).v).toEqual({ by: FH.a });
    expect((await as(H, ev(d1, "RELEASE"))).err?.message).toContain("fee_hold_state_guard");
    expect((await as(H, ev(d1, "HOLD", 2))).err?.message).toContain("fee_hold_guard");
    expect((await as(K, ev(d1, "HOLD"))).err).toMatchObject({ code: "42501" }); // a collector may not hold
    // a paid-up due cannot be held; an ad-hoc due cannot be held
    await pay(L.personId, L.dca, { amount: "500" }); // pays d1
    expect((await as(H, ev(d1, "HOLD"))).err?.message).toContain("fee_hold_paid_guard");
    const { id: EXAM } = await fee.createFeeType(FEE_S, { code: "exam", name: "Exam Fee", categoryId: seed.catId, sortOrder: 20, hsnSac: "999293", gstRate: "18",
      accountId: (await sql(`select id from app.account where code = '3923'`))[0].id });
    await pay(L.personId, L.dca, { amount: "0", extras: [{ feeTypeId: EXAM, amount: "10" }] });
    const [adhoc] = await sql(`select id::text from app.fee_due where registration_id = $1 and source = 'ADHOC'`, [L.dca]);
    expect((await as(H, ev(adhoc.id, "HOLD"))).err?.message).toContain("fee_hold_guard");
    // a receipt line on a held due is refused by the database
    await setHold(H, L.personId, d2, true, "held");
    const line = await as(K, async (c) => {
      const [{ p }] = (await c.query(`select app.financial_year((now() at time zone 'Asia/Kolkata')::date) as p`)).rows;
      await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`fee-dues:${L.dca}`]);
      const cur = (await c.query(`update app.number_series set current = current + 1 where centre_id = 1 and doc_type = 'FEEREC' and period = $1 returning current`, [p])).rows[0].current;
      const id = (await c.query(`insert into app.receipt (centre_id, registration_id, period, number, mode, currency, total, idempotency_key)
        values (1, $1, $2, $3, 'CASH', 'INR', 10, gen_random_uuid()) returning id`, [L.dca, p, cur])).rows[0].id;
      await c.query(`insert into app.receipt_allocation (receipt_id, centre_id, due_id, amount) values ($1, 1, $2, 10)`, [id, d2]);
    });
    expect(line.err?.message).toContain("receipt_hold_guard");
    // the latest event follows the lock order: a hold asked first but locked second stays the state (D1)
    const M = await learner();
    const due = M.dues[0]!;
    await setHold(H, M.personId, due, true, "first");
    const [c1, c2] = [new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }), new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] })];
    await c1.connect(); await c2.connect();
    try {
      for (const c of [c1, c2]) { await c.query("begin"); await c.query("select set_config('app.session_id', $1, true)", [H]); }
      await c1.query(`select pg_advisory_xact_lock(hashtext($1))`, [`fee-dues:${M.dca}`]);
      const pid2 = (await c2.query(`select pg_backend_pid() as p`)).rows[0].p;
      const second = c2.query(`insert into app.fee_hold_event (due_id, centre_id, action, reason) values ($1, 1, 'HOLD', 'second')`, [due]);
      for (let i = 0; i < 50; i++) { // the HOLD has taken its default id and waits on the lock
        const [w] = await sql(`select wait_event_type from pg_stat_activity where pid = $1`, [pid2]);
        if (w?.wait_event_type === "Lock") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await c1.query(`insert into app.fee_hold_event (due_id, centre_id, action, reason) values ($1, 1, 'RELEASE', 'release')`, [due]);
      await c1.query("commit");
      await second;
      await c2.query("commit");
    } finally { await c1.end(); await c2.end(); }
    expect((await sql(`select action from app.fee_hold_event where due_id = $1 order by id`, [due])).map((r) => r.action)).toEqual(["HOLD", "RELEASE", "HOLD"]);
    expect((await sql(`select held from app.fee_due_balance where due_id = $1`, [due]))[0].held).toBe(true);
    // as the owner: who is the database's, and the reason check binds every writer
    const owner = (q: string, p: unknown[]) => asAdmin(async (db) => {
      await db.query("begin");
      try { await db.query("select set_config('app.session_id', $1, true)", [H]); return (await db.query(q, p)).rows[0] ?? null; }
      catch (e) { return (e as Error).message; } finally { await db.query("rollback"); }
    });
    const N = await learner();
    expect(await owner(`insert into app.fee_hold_event (due_id, centre_id, action, reason, created_by) values ($1, 1, 'HOLD', 'r', '00000000-0000-0000-0000-00000000000a') returning created_by::text as by`,
      [N.dues[0]])).toEqual({ by: FH.a });
    expect(await owner(`insert into app.fee_hold_event (due_id, centre_id, action, reason) values ($1, 1, 'HOLD', ' padded ')`, [N.dues[0]])).toContain("fee_hold_event_reason_check");
    // kept for good, even by the owner; out of scope sees nothing
    for (const q of [`update app.fee_hold_event set reason = 'x'`, `delete from app.fee_hold_event`, `truncate app.fee_hold_event`]) {
      const e = await asAdmin(async (db) => { await db.query("begin"); try { await db.query(q); return null; } catch (x) { return (x as Error).message; } finally { await db.query("rollback"); } });
      expect(e, q).toContain("fee_hold_event is append-only");
    }
    expect((await as(T.uA, (c) => c.query(`select count(*)::int as n from app.fee_hold_event`).then((r) => r.rows[0]))).v).toEqual({ n: 0 });
  });

  test("T-FH-003 the hold list and history; the route", async () => {
    const L = await learner(), M = await learner();
    await setHold(H, L.personId, L.dues[0]!, true, "reason one");
    await setHold(H, M.personId, M.dues[1]!, true, "reason two");
    await setHold(H, M.personId, M.dues[1]!, false, "released");
    expect(await holdCentres(H)).toEqual([{ id: C.A, code: "KL2-25", name: "Centre A" }]);
    expect(await holdCentres(V)).toEqual([]);
    const held = await heldDues(H, C.A);
    expect(held.map((h) => [h.dueId, h.personId, h.courseCode, h.academicYear, h.feeTypeName, h.captionName, h.owed, h.reason])).toEqual([
      [L.dues[0], L.personId, "DCA", "2026-27", "Registration", "INSTALLMENT 1", "500.00", "reason one"]]);
    expect(await heldDues(H, C.A, { feeTypeId: seed.course })).toEqual([]);
    expect(await heldDues(H, C.A, { courseCode: "TALLY" })).toEqual([]);
    expect(await heldDues(H, C.A, { academicYear: "2027-28" })).toEqual([]);
    expect(await thrown(heldDues(H, C.B))).toBeInstanceOf(Forbidden);
    const today = (await sql(`select (now() at time zone 'Asia/Kolkata')::date::text as d`))[0].d as string;
    expect((await holdHistory(H, C.A, today, today)).map((e) => [e.action, e.reason])).toEqual([["RELEASE", "released"], ["HOLD", "reason two"], ["HOLD", "reason one"]]);
    expect((await holdHistory(H, C.A, today, today, "RELEASE")).map((e) => e.reason)).toEqual(["released"]);
    expect(await msg(holdHistory(H, C.A, "2026-01-01", "2026-04-03"))).toBe("to: within 92 days of from");
    expect(await msg(holdHistory(H, C.A, today, today, "OTHER"))).toBe("kind: one of the listed values");
    // the route
    const ORIGIN = "https://gems.test";
    const post = (personId: string, body: Record<string, string>, origin = ORIGIN) => holdRoute(new Request(`${ORIGIN}/students/${personId}/holds`, {
      method: "POST", body: new URLSearchParams(body), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${H}`, origin } }),
      { params: Promise.resolve({ personId }) });
    const where = (x: Response) => { const u = new URL(x.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const P = `/students/${L.personId}`;
    expect((await post(L.personId, { dueId: L.dues[1]!, action: "hold", reason: "x" }, "https://evil.example")).status).toBe(403);
    expect(where(await post(L.personId, { dueId: L.dues[1]!, action: "hold", reason: "x" }))).toBe(`${P}?saved=1`);
    expect(where(await post(L.personId, { dueId: L.dues[1]!, action: "hold", reason: "x" }))).toBe(`${P}?error=fee.hold.state`);
    expect(where(await post(L.personId, { dueId: L.dues[2]!, action: "hold", reason: "" }))).toBe(`${P}?error=invalid&detail=reason`);
    expect(where(await post(L.personId, { dueId: L.dues[2]!, action: "freeze", reason: "x" }))).toBe(`${P}?error=invalid&detail=action`);
    expect((await post(L.personId, { dueId: M.dues[0]!, action: "hold", reason: "x" })).status).toBe(404);
    expect((await post("x", { dueId: L.dues[0]!, action: "hold", reason: "x" })).status).toBe(404);
  });
});
