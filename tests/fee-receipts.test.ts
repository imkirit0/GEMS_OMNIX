// Fee collection and receipts: T-FR-001…004 (audit 09; docs/designs/fee-receipts/fee-receipts.md). The pages are a
// real-server smoke check.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as receiptRoute } from "../app/students/[personId]/receipts/route";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import { Forbidden } from "../src/server/action";
import { PersonError } from "../src/server/person-rules";
import { admit, type AdmitInput } from "../src/server/people";
import { createDues, duesForPerson } from "../src/server/dues";
import { collectFee, FEE_GATES, getReceipt, type CollectInput } from "../src/server/receipts";
import { financialYear } from "../src/server/numbering";
import { asAdmin, C, FC, reset, rows, seriesCurrent, setStepUp, ST_TOKEN, T } from "./fixtures";
import { FEE_S, seedFeePlan } from "./fee-seed";

const K = "tok-feeC", D = "tok-feeD", V = ST_TOKEN.sa; // collect + view at A; dues + view at A; view (+ admit) at A
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const sqlErr = (q: string, p: unknown[] = []) => asAdmin(async (db) => {
  await db.query("begin");
  try { await db.query(q, p); return null; } catch (e) { return e as { code: string; message: string }; } finally { await db.query("rollback"); }
});
const key = () => crypto.randomUUID();
let n = 0;
const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({
  person: { givenName: `Payer${++n}`, mobile: `98200${String(n).padStart(5, "0")}` }, centreId: C.A, academicYear: "2026-27",
  admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });
/** A learner at A with DCA dues (20500.60 in four lines) and TALLY (no plan, no dues). */
async function learner(centreId: number = C.A, tok: string = V) {
  const a = await admit(tok, input({ centreId, courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }, { courseCode: "TALLY", joinDate: "2026-11-01" }] }));
  const reg = (c: string) => a.registrations.find((r) => r.courseCode === c)!.id;
  await createDues(D, a.personId, reg("DCA"));
  return { personId: a.personId, dca: reg("DCA"), tally: reg("TALLY") };
}
const pay = (personId: string, registrationId: string, o: Partial<CollectInput> = {}, tok = K) =>
  collectFee(tok, personId, { registrationId, amount: "100", mode: "CASH", idempotencyKey: key(), ...o });
const linesOf = (receiptId: string) => sql(`select d.due_on::text as due, l.amount::text as amount, l.gst_rate::numeric(5,2)::text as rate, l.hsn_sac as hsn,
  l.taxable::text as taxable, l.cgst::text as cgst, l.sgst::text as sgst, l.igst::text as igst
  from app.receipt_allocation l join app.fee_due d on d.id = l.due_id where l.receipt_id = $1 order by d.due_on, d.id`, [receiptId]);
const gst = (supply: "STATE" | "INTERSTATE" | null, gstin: string | null = "32ABCDE1234F1Z5", centreId: number = C.A) =>
  sql(`update app.centre set gst_enabled = $1, gst_supply = $2, gstin = $3 where id = $4`, [supply !== null || gstin !== null, supply, supply === null && gstin !== null ? null : gstin, centreId]);

let app: pg.Client;
let period = "";
let seed: Awaited<ReturnType<typeof seedFeePlan>>;
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(async () => {
  await reset(); await setStepUp(FEE_S, 0); seed = await seedFeePlan();
  FEE_GATES.collectionLive = true;
  period = (await sql(`select app.financial_year((now() at time zone 'Asia/Kolkata')::date) as p`))[0].p;
  // this financial year's FEEREC rows, whatever today is (C8, R1)
  await sql(`insert into app.number_series (centre_id, doc_type, period, gap_rule) select c, 'FEEREC', $1, 'GAPLESS' from unnest(array[1, 2, 3]) c
    on conflict do nothing`, [period]);
  await gst("STATE");
});
afterEach(() => { FEE_GATES.collectionLive = false; });
const no = (k: number, code = "KL2-25") => `${code}/${period.slice(2, 4)}/${k}`;

describe("T-FR fee receipts", () => {
  test("T-FR-001 collecting: oldest first, exact GST, gapless numbers, refusals that use no number, audit", async () => {
    const L = await learner();
    // no series: refused; any earlier row of the centre lets this year's start at 0 (rule a)
    await sql(`delete from app.number_series where centre_id = $1 and doc_type = 'FEEREC'`, [C.A]);
    expect(await thrown(pay(L.personId, L.dca))).toMatchObject({ key: "fee.receipt.noseries" });
    await sql(`insert into app.number_series (centre_id, doc_type, period, gap_rule, current) values ($1, 'FEEREC', '2019-20', 'GAPLESS', 77)`, [C.A]);
    // 600.00 cash: 500.00 to the oldest line, 100.00 to the next; CGST/SGST half-up, the residual in SGST
    const r1 = await pay(L.personId, L.dca, { amount: "600" });
    expect(r1).toEqual({ receiptId: expect.any(String), receiptNo: no(1), total: "600.00", replay: false });
    expect(await seriesCurrent(C.A, "FEEREC", period)).toBe(1);
    expect(await linesOf(r1.receiptId)).toEqual([
      { due: "2026-11-30", amount: "500.00", rate: "18.00", hsn: "999293", taxable: "423.73", cgst: "38.14", sgst: "38.13", igst: "0.00" },
      { due: "2026-11-30", amount: "100.00", rate: "18.00", hsn: "999293", taxable: "84.75", cgst: "7.63", sgst: "7.62", igst: "0.00" }]);
    expect((await rows("fee.receipt.create")).filter((r) => r.outcome === "OK")[0]).toMatchObject({ target_type: "receipt", target_id: r1.receiptId,
      after: { receiptNo: no(1), total: "600.00", mode: "CASH", lines: 2 } });
    // refusals, each by message; none uses a number
    const over = (await sql(`select (sum(outstanding) + 0.01)::text as a from app.fee_due_balance where registration_id = $1`, [L.dca]))[0].a;
    expect(await thrown(pay(L.personId, L.dca, { amount: over }))).toMatchObject({ key: "fee.receipt.over" });
    const bad: [Partial<CollectInput>, string][] = [
      [{ idempotencyKey: "x", amount: "x" }, "idempotencyKey: invalid"], [{ amount: "0" }, "amount: from 0.01, up to 2 decimals"],
      [{ amount: "1.234" }, "amount: from 0.01, up to 2 decimals"], [{ amount: "-1" }, "amount: from 0.01, up to 2 decimals"],
      [{ mode: "WALLET" }, "mode: one of the listed values"], [{ reference: "R1" }, "reference: not for cash"],
      [{ mode: "UPI" }, "reference: required for this mode"], [{ mode: "UPI", reference: "x".repeat(51) }, "reference: 1-50 characters"],
      [{ mode: "CHEQUE", reference: "000123" }, "instrumentDate: required for cheque and DD"],
      [{ mode: "UPI", reference: "U1", instrumentDate: "2026-10-01" }, "instrumentDate: only for cheque and DD"],
      [{ mode: "DD", reference: "D1", instrumentDate: "2099-01-01" }, "instrumentDate: not after today"],
    ];
    for (const [o, want] of bad) expect(await msg(pay(L.personId, L.dca, o)), JSON.stringify(o)).toBe(want);
    FEE_GATES.collectionLive = false;
    expect(await thrown(pay(L.personId, L.dca))).toMatchObject({ key: "fee.receipt.closed" });
    FEE_GATES.collectionLive = true;
    expect(await thrown(pay(L.personId, L.dca, {}, V))).toBeInstanceOf(Forbidden);
    expect((await rows("fee.receipt.create")).filter((r) => r.outcome === "DENIED")[0]).toMatchObject({ detail: { permission: "fee.collect" } });
    expect(await thrown(pay(L.personId, L.dca, {}, T.uA))).toMatchObject({ reason: "notfound" });
    const other = await learner();
    expect(await thrown(pay(L.personId, other.dca))).toBeInstanceOf(PersonError);
    expect(await thrown(pay(L.personId, L.tally))).toMatchObject({ key: "fee.receipt.nothing" }); // no dues
    await gst("STATE", null); // registered but no GSTIN: refused by the guard
    await sql(`update app.centre set gst_enabled = true, gst_supply = 'STATE', gstin = null where id = $1`, [C.A]);
    expect(await thrown(pay(L.personId, L.dca))).toMatchObject({ key: "fee.receipt.gst" });
    await gst("STATE");
    expect(await seriesCurrent(C.A, "FEEREC", period)).toBe(1); // nothing above used a number
    // a cheque; the audit keeps no reference (DD-8)
    const r2 = await pay(L.personId, L.dca, { amount: "200", mode: "CHEQUE", reference: "000123", instrumentDate: "2026-10-01" });
    expect(r2.receiptNo).toBe(no(2));
    expect(JSON.stringify((await rows("fee.receipt.create")).at(-1))).not.toContain("000123");
    // inter-state: IGST; an untaxed centre: none
    await gst("INTERSTATE");
    const r3 = await pay(L.personId, L.dca, { amount: "118", mode: "UPI", reference: "UPI-9" });
    expect(await linesOf(r3.receiptId)).toEqual([{ due: "2026-11-30", amount: "118.00", rate: "18.00", hsn: "999293", taxable: "100.00", cgst: "0.00", sgst: "0.00", igst: "18.00" }]);
    await gst(null, null);
    const r4 = await pay(L.personId, L.dca, { amount: "50" });
    expect(await linesOf(r4.receiptId)).toEqual([{ due: "2026-11-30", amount: "50.00", rate: "18.00", hsn: "999293", taxable: "50.00", cgst: "0.00", sgst: "0.00", igst: "0.00" }]);
    // the rest, across both instalments; then nothing is left
    const rest = (await sql(`select sum(outstanding)::text as a from app.fee_due_balance where registration_id = $1`, [L.dca]))[0].a;
    expect(rest).toBe("19532.60");
    const r5 = await pay(L.personId, L.dca, { amount: rest });
    expect((await linesOf(r5.receiptId)).map((l) => [l.due, l.amount])).toEqual([["2026-11-30", "11532.50"], ["2027-01-31", "0.10"], ["2027-01-31", "8000.00"]]);
    expect(await thrown(pay(L.personId, L.dca))).toMatchObject({ key: "fee.receipt.nothing" });
    expect((await sql(`select receipt_no from app.receipt where centre_id = $1 order by number`, [C.A])).map((r) => r.receipt_no))
      .toEqual([no(1), no(2), no(3), no(4), no(5)]);
    // centre A2: a USD plan made by the owner (the app makes INR plans only): no GST outside INR, even at a taxed centre (D-CUR-1)
    await sql(`update app.centre set centre_class_id = 1 where id = $1`, [C.A2]);
    await asAdmin(async (db) => {
      await db.query("begin");
      await db.query("select set_config('app.session_id', $1, true)", [FEE_S]);
      const pl = (await db.query(`insert into app.fee_plan (academic_year, course_id, centre_id, version, currency) values ('2026-27', 1, $1, 1, 'USD') returning id`, [C.A2])).rows[0].id;
      await db.query(`insert into app.fee_plan_line (plan_id, academic_year, fee_type_id, caption_id, amount)
        select $1, academic_year, fee_type_id, caption_id, amount from app.fee_plan_line where plan_id = $2`, [pl, seed.planId]);
      await db.query(`update app.fee_plan set status = 'PUBLISHED' where id = $1`, [pl]);
      await db.query("commit");
    });
    // a collector who sees only A2 (X), and fee dues there
    const X = "00000000-0000-0000-0000-0000000000f9", XT = "tok-feeX";
    await sql(`insert into app.app_user (id, login, display_name, status) values ($1, 'feex', 'Fee collection A2', 'ACTIVE')`, [X]);
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 30, 'CENTRE', $2), ($3, 29, 'CENTRE', $2)`,
      [X, C.A2, "00000000-0000-0000-0000-0000000000f7"]);
    await sql(`insert into app.app_session (token_hash, user_id, expires_at) values (sha256(convert_to($1, 'UTF8')), $2, now() + interval '1 hour')`, [XT, X]);
    const atA2 = await learner(C.A2, ST_TOKEN.sr);
    await gst("STATE", "32ABCDE1234F1Z5", C.A2);
    const kx = key();
    const usd = await pay(atA2.personId, atA2.dca, { amount: "118", idempotencyKey: kx }, XT);
    expect(await linesOf(usd.receiptId)).toEqual([{ due: "2026-11-30", amount: "118.00", rate: "18.00", hsn: "999293", taxable: "118.00", cgst: "0.00", sgst: "0.00", igst: "0.00" }]);
    expect(usd.receiptNo).toBe(no(1, "KL3-07"));
    // the same key at A, by a collector who cannot see A2's receipt: refused (the key is unique), never answered with it
    expect(await thrown(pay(other.personId, other.dca, { idempotencyKey: kx }))).toMatchObject({ key: "fee.receipt.mismatch" });
    // an inactive centre (the session stays valid through the user's active centre A)
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 30, 'CENTRE', $2)`, [FC.a, C.A2]);
    await sql(`update app.centre set status = 'INACTIVE' where id = $1`, [C.A2]);
    expect(await msg(pay(atA2.personId, atA2.dca))).toBe("centreId: centre is not active");
  });

  test("T-FR-002 the database proves every receipt; stamps, grants, races, row security, immutability, series rows", async () => {
    const L = await learner(), other = await learner();
    const due = async (reg: string, i = 0) => (await sql(`select id::text from app.fee_due where registration_id = $1 order by due_on, id`, [reg]))[i].id as string;
    const d1 = await due(L.dca), od = await due(other.dca);
    /** One raw receipt as a session in one transaction: bump the series, insert the receipt and its lines, fire the deferred
     * check; rolled back unless commit. Returns the error or null. */
    const raw = async (o: { tok?: string; number?: number; per?: string; currency?: string; total?: string; reg?: string; lines?: [string, string][];
      commit?: boolean; client?: pg.Client } = {}) => {
      const c = o.client ?? app;
      await c.query("begin");
      try {
        await c.query("select set_config('app.session_id', $1, true)", [o.tok ?? K]);
        // the lock contract: the registration's money lock before the series row (a writer in the other order deadlocks, and fails closed)
        await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`fee-dues:${o.reg ?? L.dca}`]);
        const cur = (await c.query(`update app.number_series set current = current + 1 where centre_id = 1 and doc_type = 'FEEREC' and period = $1
          returning current::int as n`, [period])).rows[0].n as number;
        const id = (await c.query(`select nextval('app.receipt_id_seq')::text as id`)).rows[0].id as string;
        const lines = o.lines ?? [[d1, "10.00"]];
        await c.query(`insert into app.receipt (id, centre_id, registration_id, period, number, mode, currency, total, idempotency_key)
          values ($1, 1, $2, $3, $4, 'CASH', $5, $6, gen_random_uuid())`,
          [id, o.reg ?? L.dca, o.per ?? period, o.number ?? cur, o.currency ?? "INR", o.total ?? lines.reduce((s, [, a]) => s + Number(a), 0).toFixed(2)]);
        for (const [dueId, amount] of lines) await c.query(`insert into app.receipt_allocation (receipt_id, centre_id, due_id, amount) values ($1, 1, $2, $3)`, [id, dueId, amount]);
        await c.query("set constraints all immediate");
        await c.query(o.commit ? "commit" : "rollback");
        return null;
      } catch (e) { await c.query("rollback"); return e as { code: string; message: string }; }
    };
    const refused = async (o: Parameters<typeof raw>[0], text: string, code = "23514") => {
      const e = await raw(o);
      expect(e, text).toMatchObject({ code });
      expect(e!.message, text).toContain(text);
    };
    expect(await raw()).toBeNull();
    await refused({ lines: [[od, "10.00"]] }, "a line is a due of the receipt's registration");
    await refused({ currency: "USD" }, "a line is a due of the receipt's registration");
    await refused({ lines: [[d1, "500.01"]] }, "never paid beyond what is outstanding");
    await refused({ lines: [], total: "5.00" }, "total is the sum of its lines");
    await refused({ total: "11.00" }, "total is the sum of its lines");
    await refused({ number: 99 }, "the number is the series current");
    await refused({ per: "2019-20" }, "the period is the receipt date's financial year");
    await sql(`update app.centre set code = 'KL2-25-LONGER' where id = $1`, [C.A]);
    await refused({}, "longer than 16 characters");
    await sql(`update app.centre set code = 'KL2-25' where id = $1`, [C.A]);
    await sql(`update app.centre set gst_supply = null where id = $1`, [C.A]);
    await refused({}, "needs its supply and GSTIN");
    await sql(`update app.centre set gst_supply = 'STATE', gstin = null where id = $1`, [C.A]);
    await refused({}, "needs its supply and GSTIN");
    await gst("STATE");
    // lines only in their receipt's transaction
    expect(await raw({ commit: true })).toBeNull();
    const [past] = await sql(`select id::text from app.receipt order by id desc limit 1`);
    await app.query("begin");
    await app.query("select set_config('app.session_id', $1, true)", [K]);
    const late = await app.query(`insert into app.receipt_allocation (receipt_id, centre_id, due_id, amount) values ($1, 1, $2, 1)`, [past.id, d1])
      .then(() => null, (e: { message: string }) => e.message);
    await app.query("rollback");
    expect(late).toContain("lines are added only with their receipt");
    // stamped by the database, even when the owner supplies other values
    const stamped = await asAdmin(async (db) => {
      await db.query("begin");
      try {
        await db.query("select set_config('app.session_id', $1, true)", [K]);
        const cur = (await db.query(`update app.number_series set current = current + 1 where centre_id = 1 and doc_type = 'FEEREC' and period = $1
          returning current::int as n`, [period])).rows[0].n;
        const r = (await db.query(`insert into app.receipt (centre_id, registration_id, period, number, receipt_no, received_on, mode, currency, total,
            idempotency_key, status, created_by, created_at) values (1, $1, $2, $3, 'FAKE', '2000-01-01', 'CASH', 'INR', 118, gen_random_uuid(), 'CANCELLED',
            '00000000-0000-0000-0000-00000000000a', '2000-01-01') returning id, receipt_no, received_on = (now() at time zone 'Asia/Kolkata')::date as today,
            status, created_by::text, created_at = now() as fresh`, [L.dca, period, cur])).rows[0];
        const l = (await db.query(`insert into app.receipt_allocation (receipt_id, centre_id, due_id, amount, gst_rate, hsn_sac, taxable, cgst, sgst, igst)
          values ($1, 1, $2, 118, 0, '0000', 118, 0, 0, 0) returning gst_rate::numeric(5,2)::text as rate, hsn_sac, taxable::text, cgst::text, sgst::text, igst::text`,
          [r.id, d1])).rows[0];
        return { r: { ...r, id: undefined }, l };
      } finally { await db.query("rollback"); }
    });
    expect(stamped).toEqual({ r: { id: undefined, receipt_no: expect.stringMatching(/^KL2-25\/\d\d\/\d+$/), today: true, status: "ACTIVE", created_by: FC.a, fresh: true },
      l: { rate: "18.00", hsn_sac: "999293", taxable: "100.00", cgst: "9.00", sgst: "9.00", igst: "0.00" } });
    // grants: the database's columns are not the app's
    for (const q of [`insert into app.receipt (centre_id, registration_id, period, number, mode, currency, total, idempotency_key, status) values (1, '${L.dca}', '${period}', 1, 'CASH', 'INR', 1, gen_random_uuid(), 'ACTIVE')`,
      `insert into app.receipt (centre_id, registration_id, period, number, mode, currency, total, idempotency_key, received_on) values (1, '${L.dca}', '${period}', 1, 'CASH', 'INR', 1, gen_random_uuid(), '2000-01-01')`,
      `insert into app.receipt_allocation (receipt_id, centre_id, due_id, amount, taxable) values (1, 1, ${d1}, 1, 1)`,
      `insert into app.number_series (centre_id, doc_type, period, gap_rule, current) values (1, 'INV', '2030-31', 'GAPLESS', 5)`,
      `update app.receipt set total = 1`, `delete from app.receipt_allocation`]) {
      await app.query("begin");
      await app.query("select set_config('app.session_id', $1, true)", [K]);
      const code = await app.query(q).then(() => null, (e: { code: string }) => e.code);
      await app.query("rollback");
      expect(code, q).toBe("42501");
    }
    // a series row created by the app starts at 0
    await app.query("begin");
    await app.query("select set_config('app.session_id', $1, true)", [K]);
    const fresh = (await app.query(`insert into app.number_series (centre_id, doc_type, period, gap_rule) values (1, 'INV', '2030-31', 'GAPLESS') returning current::int as n`)).rows[0];
    await app.query("rollback");
    expect(fresh).toEqual({ n: 0 });
    // the last rupee of one due, from two sessions: the second waits for the first, then is refused
    const left = (await sql(`select outstanding::text as o from app.fee_due_balance where due_id = $1`, [d1]))[0].o as string;
    const [c1, c2] = [new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }), new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] })];
    await c1.connect(); await c2.connect();
    try {
      await c1.query("begin");
      await c1.query("select set_config('app.session_id', $1, true)", [K]);
      await c1.query(`select pg_advisory_xact_lock(hashtext($1))`, [`fee-dues:${L.dca}`]);
      const second = raw({ client: c2, lines: [[d1, left]] });
      await new Promise((r) => setTimeout(r, 300));
      const first = (async () => {
        const cur = (await c1.query(`update app.number_series set current = current + 1 where centre_id = 1 and doc_type = 'FEEREC' and period = $1 returning current::int as n`, [period])).rows[0].n;
        const id = (await c1.query(`select nextval('app.receipt_id_seq')::text as id`)).rows[0].id;
        await c1.query(`insert into app.receipt (id, centre_id, registration_id, period, number, mode, currency, total, idempotency_key) values ($1, 1, $2, $3, $4, 'CASH', 'INR', $5, gen_random_uuid())`, [id, L.dca, period, cur, left]);
        await c1.query(`insert into app.receipt_allocation (receipt_id, centre_id, due_id, amount) values ($1, 1, $2, $3)`, [id, d1, left]);
        await c1.query("commit");
      })();
      await first;
      expect((await second)?.message).toContain("never paid beyond what is outstanding");
    } finally { await c1.end(); await c2.end(); }
    // row security: out of scope sees nothing; a viewer reads but cannot issue
    await app.query("begin");
    await app.query("select set_config('app.session_id', $1, true)", [T.uA]);
    expect((await app.query(`select (select count(*)::int from app.receipt) r, (select count(*)::int from app.receipt_allocation) a`)).rows[0]).toEqual({ r: 0, a: 0 });
    await app.query("rollback");
    await app.query("begin");
    await app.query("select set_config('app.session_id', $1, true)", [V]);
    expect((await app.query(`select count(*)::int n from app.receipt`)).rows[0].n).toBe(2);
    await app.query("rollback");
    expect(await raw({ tok: V })).toMatchObject({ code: "42501" });
    // kept for good, even by the owner
    for (const t of ["receipt", "receipt_allocation"]) {
      for (const q of [`update app.${t} set centre_id = centre_id`, `delete from app.${t}`, `truncate app.${t} cascade`]) {
        // a receipt's only update is the same-day cancel (receipt-cancel, 0028): anything else is refused by its guard
        const want = t === "receipt" && q.startsWith("update") ? "receipt_cancel_status_guard" : `${t} is append-only`;
        expect((await sqlErr(q))?.message, q).toContain(want);
      }
    }
    // a commit-time error reaches the app as a refusal, not a server error (R3)
    await sql(`create function app.test_commit_fail() returns trigger language plpgsql as $$ begin
      raise exception 'test: constraint "test_commit_guard"' using errcode = '23514'; end $$`);
    await sql(`create constraint trigger test_commit_fail after insert on app.receipt deferrable initially deferred for each row execute function app.test_commit_fail()`);
    try {
      expect(await thrown(pay(L.personId, L.dca))).toMatchObject({ key: "fee.receipt.mismatch" });
    } finally {
      await sql(`drop trigger test_commit_fail on app.receipt; drop function app.test_commit_fail()`);
    }
  });

  test("T-FR-003 exactly once: replay, concurrent double submit, key reuse, concurrent numbering", async () => {
    const L = await learner(), M = await learner();
    const k1 = key();
    const a = await pay(L.personId, L.dca, { amount: "300", idempotencyKey: k1 });
    const b = await pay(L.personId, L.dca, { amount: "999", mode: "UPI", reference: "x", idempotencyKey: k1 }); // the recorded one comes back
    expect(b).toEqual({ ...a, replay: true });
    expect(await seriesCurrent(C.A, "FEEREC", period)).toBe(1);
    expect((await rows("fee.receipt.create")).filter((r) => r.outcome === "OK").at(-1)).toMatchObject({ after: { replay: true, receiptId: a.receiptId } });
    expect(await thrown(pay(M.personId, M.dca, { idempotencyKey: k1 }))).toMatchObject({ key: "fee.receipt.mismatch" });
    // two submits of one form for the full outstanding: one receipt, one replay
    const all = (await sql(`select sum(outstanding)::text as a from app.fee_due_balance where registration_id = $1`, [L.dca]))[0].a;
    const k2 = key();
    const both = await Promise.all([pay(L.personId, L.dca, { amount: all, idempotencyKey: k2 }), pay(L.personId, L.dca, { amount: all, idempotencyKey: k2 })]);
    expect(both.map((x) => x.replay).sort()).toEqual([false, true]);
    expect(both[0]!.receiptId).toBe(both[1]!.receiptId);
    // two learners at once on one series: distinct, consecutive numbers
    const N = await learner();
    const two = await Promise.all([pay(M.personId, M.dca, { amount: "10" }), pay(N.personId, N.dca, { amount: "10" })]);
    expect(two.map((x) => x.receiptNo).sort()).toEqual([no(3), no(4)]);
    expect(await seriesCurrent(C.A, "FEEREC", period)).toBe(4);
  });

  test("T-FR-004 reading receipts and the route; the financial year in SQL and TS agree", async () => {
    const L = await learner();
    const r = await pay(L.personId, L.dca, { amount: "600" });
    const [dca, tally] = await duesForPerson(K, L.personId);
    expect(dca).toMatchObject({ registrationId: L.dca, total: "20500.60", outstanding: "19900.60", canCollect: true,
      receipts: [{ id: r.receiptId, receiptNo: no(1), receivedOn: expect.any(String), total: "600.00", mode: "CASH" }] });
    expect(dca!.dues.map((d) => [d.paid, d.outstanding])).toEqual([["500.00", "0.00"], ["100.00", "11900.50"], ["0.00", "0.10"], ["0.00", "8000.00"]]);
    expect(tally).toMatchObject({ outstanding: null, receipts: [], canCollect: false });
    expect((await duesForPerson(V, L.personId))[0]!.canCollect).toBe(false); // no fee.collect
    FEE_GATES.collectionLive = false;
    expect((await duesForPerson(K, L.personId))[0]!.canCollect).toBe(false);
    FEE_GATES.collectionLive = true;
    const view = await getReceipt(V, r.receiptId);
    expect(view).toMatchObject({ receiptNo: no(1), total: "600.00", status: "ACTIVE", centreCode: "KL2-25", gstin: "32ABCDE1234F1Z5", personId: L.personId,
      courseCode: "DCA", totals: { taxable: "508.48", cgst: "45.77", sgst: "45.75", igst: "0.00" } });
    expect(view.lines.map((l) => [l.feeTypeName, l.amount])).toEqual([["Registration", "500.00"], ["Course Fee", "100.00"]]);
    for (const [tok, id] of [[T.uB, r.receiptId], [T.uA, r.receiptId], [V, "abc"], [V, "987654321"]] as const) {
      expect(await thrown(getReceipt(tok, id)), `${tok} ${id}`).toMatchObject({ reason: "notfound" });
    }
    // the route
    const ORIGIN = "https://gems.test";
    const post = (personId: string, body: Record<string, string>, origin = ORIGIN) => receiptRoute(new Request(`${ORIGIN}/students/${personId}/receipts`, {
      method: "POST", body: new URLSearchParams(body), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${K}`, origin } }),
      { params: Promise.resolve({ personId }) });
    const where = (x: Response) => { const u = new URL(x.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const form = { registrationId: L.dca, amount: "10", mode: "CASH", reference: "", instrumentDate: "", idempotencyKey: key() };
    expect((await post(L.personId, form, "https://evil.example")).status).toBe(403);
    const ok = where(await post(L.personId, form));
    expect(ok).toMatch(/^\/receipts\/\d+\?saved=1$/);
    expect(where(await post(L.personId, form))).toBe(ok.replace("saved", "replay"));
    expect(where(await post(L.personId, { ...form, idempotencyKey: key(), amount: "1,000" }))).toBe(`/students/${L.personId}?error=invalid&detail=amount`);
    expect(where(await post(L.personId, { ...form, idempotencyKey: key(), mode: "UPI" }))).toBe(`/students/${L.personId}?error=invalid&detail=reference`);
    const other = await learner();
    expect((await post(L.personId, { ...form, idempotencyKey: key(), registrationId: other.dca })).status).toBe(404);
    expect((await post("x", form)).status).toBe(404);
    // the year boundary in IST: SQL and TS agree
    const sqlFy = await sql(`select app.financial_year('2027-03-31') a, app.financial_year('2027-04-01') b, app.financial_year('2028-01-15') c`);
    expect(sqlFy).toEqual([{ a: financialYear(new Date("2027-03-31T18:29:59Z")), b: financialYear(new Date("2027-03-31T18:30:00Z")), c: "2027-28" }]);
    expect(sqlFy[0].a).toBe("2026-27");
  });
});
