// Ad-hoc fees collected with the receipt: T-AF-001…003 (audit 09; docs/designs/adhoc-fees/adhoc-fees.md).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as receiptRoute } from "../app/students/[personId]/receipts/route";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import { admit, type AdmitInput } from "../src/server/people";
import { createDues, duesForPerson } from "../src/server/dues";
import * as fee from "../src/server/fees";
import { cancelReceipt, collectFee, FEE_GATES, getReceipt, type CollectInput } from "../src/server/receipts";
import { asAdmin, C, reset, rows, setStepUp, ST_TOKEN } from "./fixtures";
import { FEE_S, seedFeePlan } from "./fee-seed";

const K = "tok-feeC", D = "tok-feeD", R = "tok-feeR", V = ST_TOKEN.sa;
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const key = () => crypto.randomUUID();
let n = 0;
const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({
  person: { givenName: `Adhoc${++n}`, mobile: `98400${String(n).padStart(5, "0")}` }, centreId: C.A, academicYear: "2026-27",
  admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });
/** A learner at A with DCA; dues created unless told otherwise. */
async function learner(withDues = true) {
  const a = await admit(V, input());
  const dca = a.registrations[0]!.id;
  if (withDues) await createDues(D, a.personId, dca);
  return { personId: a.personId, dca };
}
const pay = (personId: string, registrationId: string, o: Partial<CollectInput> = {}, tok = K) =>
  collectFee(tok, personId, { registrationId, amount: "0", mode: "CASH", idempotencyKey: key(), ...o });
const owed = async (reg: string) => (await sql(`select coalesce(sum(owed), 0)::text as o from app.fee_due_balance where registration_id = $1`, [reg]))[0].o as string;
const linesOf = (receiptId: string) => sql(`select d.source, l.amount::text as amount, l.taxable::text as taxable, l.cgst::text as cgst, l.sgst::text as sgst
  from app.receipt_allocation l join app.fee_due d on d.id = l.due_id where l.receipt_id = $1 order by l.id`, [receiptId]);

let app: pg.Client;
let seed: Awaited<ReturnType<typeof seedFeePlan>>;
let EXAM = 0, KIT = 0;
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(async () => {
  await reset(); await setStepUp(FEE_S, 0); seed = await seedFeePlan(); await setStepUp(R, 0);
  ({ id: EXAM } = await fee.createFeeType(FEE_S, { code: "exam", name: "Exam Fee", categoryId: seed.catId, sortOrder: 20, hsnSac: "999293", gstRate: "18" }));
  ({ id: KIT } = await fee.createFeeType(FEE_S, { code: "kit", name: "Academic Kit", categoryId: seed.catId, sortOrder: 30, hsnSac: "4901", gstRate: "5" }));
  FEE_GATES.collectionLive = true;
  const [{ p }] = await sql(`select app.financial_year((now() at time zone 'Asia/Kolkata')::date) as p`);
  await sql(`insert into app.number_series (centre_id, doc_type, period, gap_rule) select c, 'FEEREC', $1, 'GAPLESS' from unnest(array[1, 2, 3]) c
    on conflict do nothing`, [p]);
  await sql(`update app.centre set gst_enabled = true, gst_supply = 'STATE', gstin = '32ABCDE1234F1Z5' where id = $1`, [C.A]);
});
afterEach(() => { FEE_GATES.collectionLive = false; });

describe("T-AF ad-hoc fees", () => {
  test("T-AF-001 ad-hoc items on a receipt: dues paid at once, never owed, refusals, plan dues untouched", async () => {
    const L = await learner();
    // plan amount and two items: each item a due of today, paid in full, GST from its own fee type
    const r1 = await pay(L.personId, L.dca, { amount: "600", extras: [{ feeTypeId: EXAM, amount: "118" }, { feeTypeId: KIT, amount: "105" }] });
    expect(r1.total).toBe("823.00");
    expect(await linesOf(r1.receiptId)).toEqual([
      { source: "ADHOC", amount: "118.00", taxable: "100.00", cgst: "9.00", sgst: "9.00" },
      { source: "ADHOC", amount: "105.00", taxable: "100.00", cgst: "2.50", sgst: "2.50" },
      { source: "PLAN", amount: "500.00", taxable: "423.73", cgst: "38.14", sgst: "38.13" },
      { source: "PLAN", amount: "100.00", taxable: "84.75", cgst: "7.63", sgst: "7.62" }]);
    expect(await sql(`select fee_type_id, gross::text, due_on = (now() at time zone 'Asia/Kolkata')::date as today, plan_id, caption_id, currency
      from app.fee_due where registration_id = $1 and source = 'ADHOC' order by id`, [L.dca])).toEqual([
      { fee_type_id: EXAM, gross: "118.00", today: true, plan_id: null, caption_id: null, currency: "INR" },
      { fee_type_id: KIT, gross: "105.00", today: true, plan_id: null, caption_id: null, currency: "INR" }]);
    expect((await rows("fee.receipt.create")).filter((r) => r.outcome === "OK").at(-1)).toMatchObject({
      after: { total: "823.00", lines: 4, extras: [{ feeTypeId: EXAM, amount: "118" }, { feeTypeId: KIT, amount: "105" }] } });
    // never owed: only the plan dues count
    expect(await owed(L.dca)).toBe("19900.60");
    expect((await duesForPerson(K, L.personId))[0]).toMatchObject({ outstanding: "19900.60", total: "20500.60", canCollect: true });
    expect((await duesForPerson(K, L.personId))[0]!.dues).toHaveLength(4);
    const view = await getReceipt(V, r1.receiptId);
    expect(view.lines.map((l) => [l.feeTypeName, l.captionName, l.adhoc])).toEqual([["Exam Fee", "Ad-hoc", true], ["Academic Kit", "Ad-hoc", true],
      ["Registration", "INSTALLMENT 1", false], ["Course Fee", "INSTALLMENT 1", false]]);
    // refusals, each by message
    const bad: [Partial<CollectInput>, string][] = [
      [{ extras: Array.from({ length: 4 }, (_, i) => ({ feeTypeId: 100 + i, amount: "1" })) }, "extras: at most 3"],
      [{ extras: [{ feeTypeId: 0, amount: "1" }] }, "extras: fee type"],
      [{ extras: [{ feeTypeId: EXAM, amount: "0" }] }, "extras: amount from 0.01, up to 99,99,999.99"],
      [{ extras: [{ feeTypeId: EXAM, amount: "12345678" }] }, "extras: amount from 0.01, up to 99,99,999.99"],
      [{ extras: [{ feeTypeId: EXAM, amount: "1" }, { feeTypeId: EXAM, amount: "2" }] }, "extras: one line per fee type"],
      [{ amount: "0" }, "amount: from 0.01, up to 2 decimals"],
      [{ extras: [{ feeTypeId: 987654, amount: "1" }] }, "extras: fee type"],
    ];
    for (const [o, want] of bad) expect(await msg(pay(L.personId, L.dca, o)), JSON.stringify(o)).toBe(want);
    await fee.setFeeTypeActive(FEE_S, KIT, false, "retired");
    expect(await msg(pay(L.personId, L.dca, { extras: [{ feeTypeId: KIT, amount: "1" }] }))).toBe("extras: fee type");
    // a plan fee type is never ad hoc: with dues, and before them (the plan that would be used)
    expect(await thrown(pay(L.personId, L.dca, { extras: [{ feeTypeId: seed.reg, amount: "1" }] }))).toMatchObject({ key: "fee.receipt.adhocplan" });
    const M = await learner(false);
    expect(await thrown(pay(M.personId, M.dca, { extras: [{ feeTypeId: seed.course, amount: "1" }] }))).toMatchObject({ key: "fee.receipt.adhocplan" });
    // items only, before any dues: then Create dues still works, and its total is the plan's alone
    const m1 = await pay(M.personId, M.dca, { extras: [{ feeTypeId: EXAM, amount: "50" }] });
    expect(m1.total).toBe("50.00");
    expect((await duesForPerson(K, M.personId))[0]).toMatchObject({ dues: [], outstanding: null, canCollect: true });
    expect(await createDues(D, M.personId, M.dca)).toEqual({ count: 4, total: "20500.60" });
    expect((await pay(M.personId, M.dca, { amount: "1" })).total).toBe("1.00"); // and the plan dues are collected as usual
    // a fully paid learner may still pay items
    const rest = await owed(L.dca);
    await pay(L.personId, L.dca, { amount: rest });
    expect(await owed(L.dca)).toBe("0.00");
    expect((await duesForPerson(K, L.personId))[0]).toMatchObject({ outstanding: "0.00", canCollect: true });
    expect(await thrown(pay(L.personId, L.dca, { amount: "1" }))).toMatchObject({ key: "fee.receipt.nothing" });
    const late = await pay(L.personId, L.dca, { extras: [{ feeTypeId: EXAM, amount: "20" }] });
    expect(late.total).toBe("20.00");
    // a cancelled receipt's items are void: not owed, never collected again
    await cancelReceipt(R, r1.receiptId, "wrong items");
    expect(await owed(L.dca)).toBe("600.00"); // the plan part came back, the items did not
    const again = await pay(L.personId, L.dca, { amount: "600" });
    expect((await linesOf(again.receiptId)).map((l) => l.source)).toEqual(["PLAN", "PLAN"]);
  });

  test("T-AF-002 the database proves ad-hoc dues: paid with their receipt, rules, row security, never paid later", async () => {
    const L = await learner();
    const run = async (tok: string, steps: (c: pg.Client) => Promise<unknown>) => {
      await app.query("begin");
      try {
        await app.query("select set_config('app.session_id', $1, true)", [tok]);
        await app.query(`select pg_advisory_xact_lock(hashtext($1))`, [`fee-dues:${L.dca}`]);
        const v = await steps(app);
        await app.query("set constraints all immediate");
        return { v, err: null };
      } catch (e) { return { v: null, err: e as { code: string; message: string } }; }
      finally { await app.query("rollback"); }
    };
    const due = (o: { type?: number; cur?: string; plan?: number | null; gross?: string; on?: string } = {}) => (c: pg.Client) => c.query(
      `insert into app.fee_due (registration_id, centre_id, source, fee_type_id, plan_id, caption_id, due_on, gross, currency)
       values ($1, 1, 'ADHOC', $2, $3, $4, $5, $6, $7) returning id, due_on = (now() at time zone 'Asia/Kolkata')::date as today`,
      [L.dca, o.type ?? EXAM, o.plan ?? null, o.plan ? seed.i1 : null, o.on ?? "2000-01-01", o.gross ?? "10", o.cur ?? "INR"]).then((r) => r.rows[0]);
    // not paid at commit: refused; the date is stamped to today
    const unpaid = await run(K, async (c) => { const d = await due()(c); expect(d.today).toBe(true); return d; });
    expect(unpaid.err?.message).toContain("fee_due_adhoc_paid_guard");
    // rules, by name
    expect((await run(K, due({ plan: seed.planId }))).err?.message).toContain("fee_due_source_check");
    expect((await run(K, due({ type: seed.reg }))).err?.message).toContain("fee_due_adhoc_plan_guard");
    expect((await run(K, due({ cur: "USD" }))).err?.message).toContain("fee_due_adhoc_guard");
    expect((await run(K, due({ gross: "0" }))).err?.message).toContain("fee_due_adhoc_guard");
    await fee.setFeeTypeActive(FEE_S, KIT, false, "retired");
    expect((await run(K, due({ type: KIT }))).err?.message).toContain("fee_due_adhoc_guard");
    // row security: ad-hoc needs fee.collect, plan dues still need fee.dues
    expect((await run(D, due())).err).toMatchObject({ code: "42501" });
    const planDue = (c: pg.Client) => c.query(`insert into app.fee_due (registration_id, centre_id, plan_id, fee_type_id, caption_id, due_on, gross, currency)
      values ($1, 1, $2, $3, $4, '2026-11-30', 500, 'INR')`, [L.dca, seed.planId, seed.reg, seed.i1]);
    expect((await run(K, planDue)).err).toMatchObject({ code: "42501" });
    // a void ad-hoc due (its receipt cancelled) is never paid later, even by SQL
    const r = await pay(L.personId, L.dca, { extras: [{ feeTypeId: EXAM, amount: "30" }] });
    await cancelReceipt(R, r.receiptId, "void");
    const [voidDue] = await sql(`select id::text from app.fee_due where registration_id = $1 and source = 'ADHOC'`, [L.dca]);
    const later = await run(K, async (c) => {
      const [{ p }] = (await c.query(`select app.financial_year((now() at time zone 'Asia/Kolkata')::date) as p`)).rows;
      const cur = (await c.query(`update app.number_series set current = current + 1 where centre_id = 1 and doc_type = 'FEEREC' and period = $1 returning current`, [p])).rows[0].current;
      const id = (await c.query(`select nextval('app.receipt_id_seq')::text as id`)).rows[0].id;
      await c.query(`insert into app.receipt (id, centre_id, registration_id, period, number, mode, currency, total, idempotency_key)
        values ($1, 1, $2, $3, $4, 'CASH', 'INR', 30, gen_random_uuid())`, [id, L.dca, p, cur]);
      await c.query(`insert into app.receipt_allocation (receipt_id, centre_id, due_id, amount) values ($1, 1, $2, 30)`, [id, voidDue.id]);
    });
    expect(later.err?.message).toContain("paid with its own receipt");
    // the view still applies the caller's row security; the fee type is a real key
    const [{ o }] = await sql(`select array_to_string(reloptions, ',') as o from pg_class where relname = 'fee_due_balance'`);
    expect(o).toContain("security_invoker=true");
    expect(await sql(`select confdeltype from pg_constraint where conname = 'fee_due_fee_type_id_fkey'`)).toEqual([{ confdeltype: "r" }]);
  });

  test("T-AF-003 ad-hoc items through the form: repeated fields, half rows, success", async () => {
    const L = await learner();
    const ORIGIN = "https://gems.test";
    const post = (pairs: [string, string][]) => receiptRoute(new Request(`${ORIGIN}/students/${L.personId}/receipts`, {
      method: "POST", body: new URLSearchParams(pairs), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${K}`, origin: ORIGIN } }),
      { params: Promise.resolve({ personId: L.personId }) });
    const where = (x: Response) => { const u = new URL(x.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const base: [string, string][] = [["registrationId", L.dca], ["amount", "0"], ["mode", "CASH"], ["reference", ""], ["instrumentDate", ""]];
    const rowsOf = (...r: [string, string][]) => r.flatMap(([t, a]) => [["extraFeeType", t], ["extraAmount", a]] as [string, string][]);
    expect(where(await post([...base, ["idempotencyKey", key()], ...rowsOf([String(EXAM), ""], ["", ""], ["", ""])])))
      .toBe(`/students/${L.personId}?error=invalid&detail=extras`);
    expect(where(await post([...base, ["idempotencyKey", key()], ...rowsOf(["", "5"], ["", ""], ["", ""])])))
      .toBe(`/students/${L.personId}?error=invalid&detail=extras`);
    const ok = where(await post([...base, ["idempotencyKey", key()], ...rowsOf([String(EXAM), "59"], ["", ""], [String(KIT), "21"])]));
    expect(ok).toMatch(/^\/receipts\/\d+\?saved=1$/);
    const id = ok.match(/receipts\/(\d+)/)![1]!;
    expect((await sql(`select total::text from app.receipt where id = $1`, [id]))[0].total).toBe("80.00");
  });
});
