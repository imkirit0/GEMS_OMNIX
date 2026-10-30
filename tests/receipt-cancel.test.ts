// Receipt cancellation, same day: T-RC-001…003 (audit 09; docs/designs/receipt-cancel/receipt-cancel.md).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as cancelRoute } from "../app/receipts/[id]/cancel/route";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import { POLICY } from "../src/server/auth/policy";
import { Forbidden } from "../src/server/action";
import { PersonError } from "../src/server/person-rules";
import { StepUpRequired } from "../src/server/rbac";
import { admit, type AdmitInput } from "../src/server/people";
import { createDues, duesForPerson } from "../src/server/dues";
import { cancelReceipt, collectFee, FEE_GATES, getReceipt, type CollectInput } from "../src/server/receipts";
import { asAdmin, C, FR, reset, rows, setStepUp, ST_TOKEN, T } from "./fixtures";
import { FEE_S, seedFeePlan } from "./fee-seed";

const R = "tok-feeR", K = "tok-feeC", D = "tok-feeD", V = ST_TOKEN.sa;
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const key = () => crypto.randomUUID();
let n = 0;
const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({
  person: { givenName: `Canceller${++n}`, mobile: `98300${String(n).padStart(5, "0")}` }, centreId: C.A, academicYear: "2026-27",
  admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });
async function learner() {
  const a = await admit(V, input());
  const dca = a.registrations[0]!.id;
  await createDues(D, a.personId, dca);
  return { personId: a.personId, dca };
}
const pay = (personId: string, registrationId: string, o: Partial<CollectInput> = {}) =>
  collectFee(K, personId, { registrationId, amount: "100", mode: "CASH", idempotencyKey: key(), ...o });
const owed = async (reg: string) => (await sql(`select sum(outstanding)::text as o from app.fee_due_balance where registration_id = $1`, [reg]))[0].o as string;
/** Moves a receipt to yesterday as the owner, past every trigger (replica). */
const toYesterday = (id: string) => asAdmin(async (db) => {
  await db.query("set session_replication_role = replica");
  await db.query(`update app.receipt set received_on = received_on - 1 where id = $1`, [id]);
  await db.query("set session_replication_role = origin");
});

let app: pg.Client;
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(async () => {
  await reset(); await setStepUp(FEE_S, 0); await seedFeePlan(); await setStepUp(R, 0);
  FEE_GATES.collectionLive = true;
  const [{ p }] = await sql(`select app.financial_year((now() at time zone 'Asia/Kolkata')::date) as p`);
  await sql(`insert into app.number_series (centre_id, doc_type, period, gap_rule) select c, 'FEEREC', $1, 'GAPLESS' from unnest(array[1, 2, 3]) c
    on conflict do nothing`, [p]);
  await sql(`update app.centre set gst_enabled = true, gst_supply = 'STATE', gstin = '32ABCDE1234F1Z5' where id = $1`, [C.A]);
});
afterEach(() => { FEE_GATES.collectionLive = false; });

describe("T-RC receipt cancellation", () => {
  test("T-RC-001 cancelling on the day: dues back, receipt and number kept, refusals, audit, resubmitted forms", async () => {
    const L = await learner();
    const k1 = key();
    const r1 = await pay(L.personId, L.dca, { amount: "600", idempotencyKey: k1 });
    expect(await owed(L.dca)).toBe("19900.60");
    expect((await getReceipt(R, r1.receiptId)).canCancel).toBe(true);
    expect((await getReceipt(K, r1.receiptId)).canCancel).toBe(false); // no fee.receipt.cancel
    // refusals before the cancel, each by message
    expect(await msg(cancelReceipt(R, r1.receiptId, " "))).toBe("reason: required");
    expect(await msg(cancelReceipt(R, r1.receiptId, "x".repeat(501)))).toBe("reason: 1-500 characters");
    expect(await thrown(cancelReceipt(K, r1.receiptId, "no"))).toBeInstanceOf(Forbidden);
    expect((await rows("fee.receipt.cancel")).filter((r) => r.outcome === "DENIED")[0]).toMatchObject({ detail: { permission: "fee.receipt.cancel" } });
    for (const [tok, id] of [[T.uA, r1.receiptId], [R, "abc"], [R, "987654321"]] as const) {
      expect(await thrown(cancelReceipt(tok, id, "no")), `${tok} ${id}`).toBeInstanceOf(PersonError);
    }
    await setStepUp(R, 3600);
    expect(await thrown(cancelReceipt(R, r1.receiptId, "no"))).toBeInstanceOf(StepUpRequired);
    await setStepUp(R, 0);
    FEE_GATES.collectionLive = false;
    expect(await thrown(cancelReceipt(R, r1.receiptId, "no"))).toMatchObject({ key: "fee.receipt.closed" });
    FEE_GATES.collectionLive = true;
    expect((await sql(`select status from app.receipt where id = $1`, [r1.receiptId]))[0].status).toBe("ACTIVE");
    // the cancel: dues back, receipt and lines kept, audited with the lines and the reason
    expect(await cancelReceipt(R, r1.receiptId, "  wrong amount  ")).toEqual({ receiptNo: r1.receiptNo });
    expect(await owed(L.dca)).toBe("20500.60");
    const [row] = await sql(`select status, cancel_reason, cancelled_by::text, cancelled_at is not null as at,
      (select count(*)::int from app.receipt_allocation where receipt_id = r.id) as lines from app.receipt r where id = $1`, [r1.receiptId]);
    expect(row).toEqual({ status: "CANCELLED", cancel_reason: "wrong amount", cancelled_by: FR.a, at: true, lines: 2 });
    const dues = await sql(`select id::text from app.fee_due where registration_id = $1 order by due_on, id`, [L.dca]);
    expect((await rows("fee.receipt.cancel")).filter((r) => r.outcome === "OK")[0]).toMatchObject({ target_type: "receipt", target_id: r1.receiptId,
      reason: "wrong amount", before: { status: "ACTIVE" }, after: { status: "CANCELLED", receiptNo: r1.receiptNo, total: "600.00", registrationId: L.dca,
        lines: [{ dueId: dues[0].id, amount: "500.00" }, { dueId: dues[1].id, amount: "100.00" }] } });
    // the number is kept; the next receipt takes the next one
    const r2 = await pay(L.personId, L.dca, { amount: "50" });
    expect(Number(r2.receiptNo.split("/").at(-1))).toBe(Number(r1.receiptNo.split("/").at(-1)) + 1);
    // twice; the collect form of the cancelled receipt resubmitted: refused, never shown as a payment
    expect(await thrown(cancelReceipt(R, r1.receiptId, "again"))).toMatchObject({ key: "fee.receipt.cancelled" });
    expect(await thrown(pay(L.personId, L.dca, { amount: "600", idempotencyKey: k1 }))).toMatchObject({ key: "fee.receipt.cancelled" });
    // after its day: refused by the database, audited as failed
    await toYesterday(r2.receiptId);
    expect(await thrown(cancelReceipt(R, r2.receiptId, "late"))).toMatchObject({ key: "fee.receipt.late" });
    expect((await rows("fee.receipt.cancel")).filter((r) => r.outcome === "FAILED").at(-1)).toMatchObject({ target_id: r2.receiptId, reason: "late",
      after: { refused: "late" } });
    // what the pages read
    const view = await getReceipt(V, r1.receiptId);
    expect(view).toMatchObject({ status: "CANCELLED", cancelReason: "wrong amount", cancelledAt: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d$/), canCancel: false });
    expect((await getReceipt(R, r2.receiptId)).canCancel).toBe(false); // not today
    expect((await duesForPerson(V, L.personId))[0]!.receipts.map((x) => [x.id, x.status])).toEqual([[r2.receiptId, "ACTIVE"], [r1.receiptId, "CANCELLED"]]);
  });

  test("T-RC-002 the database proves the cancel: one transition, the day, the step-up, nothing else; the lock", async () => {
    const L = await learner();
    const a = await pay(L.personId, L.dca, { amount: "10" });
    const as = async (tok: string, q: string, p: unknown[] = []) => {
      await app.query("begin");
      await app.query("select set_config('app.session_id', $1, true)", [tok]);
      try { const r = await app.query(q, p); return { rows: r.rows, count: r.rowCount, err: null }; }
      catch (e) { return { rows: [], count: 0, err: e as { code: string; message: string } }; }
      finally { await app.query("rollback"); }
    };
    const cancel = `update app.receipt set status = 'CANCELLED', cancel_reason = 'x' where id = $1 returning cancelled_by::text, cancelled_at is not null as at`;
    // the right update passes; who and when are the database's
    expect(await as(R, cancel, [a.receiptId])).toMatchObject({ err: null, rows: [{ cancelled_by: FR.a, at: true }] });
    // a collector who may not cancel touches no row (row security)
    expect(await as(K, cancel, [a.receiptId])).toMatchObject({ err: null, count: 0 });
    // columns the database owns: not granted
    expect((await as(R, `update app.receipt set status = 'CANCELLED', cancel_reason = 'x', cancelled_by = $2 where id = $1`, [a.receiptId, FR.a])).err).toMatchObject({ code: "42501" });
    expect((await as(R, `update app.receipt set total = 1 where id = $1`, [a.receiptId])).err).toMatchObject({ code: "42501" });
    // a stale step-up: refused by the database too; the guard's age is the policy's
    await setStepUp(R, 3600);
    expect((await as(R, cancel, [a.receiptId])).err?.message).toContain("receipt_cancel_stepup_guard");
    await setStepUp(R, 0);
    const [{ src }] = await sql(`select prosrc as src from pg_proc where proname = 'receipt_cancel_guard'`);
    expect(src).toContain(`session_step_up_fresh(${POLICY.stepUpMaxAgeSeconds})`);
    // anything else changed: refused (as the owner, the only one who can name other columns)
    const frozen = await asAdmin(async (db) => {
      await db.query("begin");
      try {
        await db.query("select set_config('app.session_id', $1, true)", [R]);
        await db.query(`update app.receipt set status = 'CANCELLED', cancel_reason = 'x', total = 1 where id = $1`, [a.receiptId]);
        return null;
      } catch (e) { return (e as Error).message; } finally { await db.query("rollback"); }
    });
    expect(frozen).toContain("receipt_cancel_frozen_guard");
    // back to ACTIVE: refused
    await cancelReceipt(R, a.receiptId, "test");
    expect((await as(R, `update app.receipt set status = 'ACTIVE', cancel_reason = null where id = $1`, [a.receiptId])).err?.message).toContain("receipt_cancel_status_guard");
    // a receipt of another day: refused
    const b = await pay(L.personId, L.dca, { amount: "10" });
    await toYesterday(b.receiptId);
    expect((await as(R, cancel, [b.receiptId])).err?.message).toContain("receipt_cancel_late_guard");
    // never deleted or truncated, even by the owner; lines never change
    for (const [q, want] of [[`delete from app.receipt where id = ${b.receiptId}`, "receipt is append-only"], [`truncate app.receipt cascade`, "is append-only"],
      [`update app.receipt_allocation set amount = amount`, "receipt_allocation is append-only"]] as const) {
      const e = await asAdmin(async (db) => { await db.query("begin"); try { await db.query(q); return null; } catch (x) { return (x as Error).message; } finally { await db.query("rollback"); } });
      expect(e, q).toContain(want);
    }
    // the lock: a collection that needs the cancelled money waits for the cancel, then succeeds
    const c = await pay(L.personId, L.dca, { amount: "100" });
    const all = (await sql(`select (sum(outstanding) + 100)::text as a from app.fee_due_balance where registration_id = $1`, [L.dca]))[0].a as string;
    const c1 = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] });
    await c1.connect();
    try {
      await c1.query("begin");
      await c1.query("select set_config('app.session_id', $1, true)", [R]);
      await c1.query(`update app.receipt set status = 'CANCELLED', cancel_reason = 'race' where id = $1`, [c.receiptId]);
      const waiting = pay(L.personId, L.dca, { amount: all });
      await new Promise((r) => setTimeout(r, 300));
      await c1.query("commit");
      expect((await waiting).total).toBe(Number(all).toFixed(2));
    } finally { await c1.end(); }
    expect(await owed(L.dca)).toBe("0.00");
  });

  test("T-RC-003 the cancel route: origin, success, resubmit, errors, step-up, 404", async () => {
    const L = await learner();
    const r = await pay(L.personId, L.dca, { amount: "10" });
    const ORIGIN = "https://gems.test";
    const post = (id: string, body: Record<string, string>, tok = R, origin = ORIGIN) => cancelRoute(new Request(`${ORIGIN}/receipts/${id}/cancel`, {
      method: "POST", body: new URLSearchParams(body), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${tok}`, origin } }),
      { params: Promise.resolve({ id }) });
    const where = (x: Response) => { const u = new URL(x.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const P = `/receipts/${r.receiptId}`;
    expect((await post(r.receiptId, { reason: "x" }, R, "https://evil.example")).status).toBe(403);
    expect(where(await post(r.receiptId, { reason: "" }))).toBe(`${P}?error=invalid&detail=reason`);
    await setStepUp(R, 3600);
    expect(where(await post(r.receiptId, { reason: "x" }))).toBe(`/stepup?next=${encodeURIComponent(P)}`);
    await setStepUp(R, 0);
    expect(where(await post(r.receiptId, { reason: "x" }))).toBe(`${P}?cancelled=1`);
    expect(where(await post(r.receiptId, { reason: "x" }))).toBe(P); // a resubmitted cancel lands on the receipt
    const late = await pay(L.personId, L.dca, { amount: "10" });
    await toYesterday(late.receiptId);
    expect(where(await post(late.receiptId, { reason: "x" }))).toBe(`/receipts/${late.receiptId}?error=fee.receipt.late`);
    expect((await post("abc", { reason: "x" })).status).toBe(404);
    expect((await post(r.receiptId, { reason: "x" }, T.uA)).status).toBe(404);
  });
});
