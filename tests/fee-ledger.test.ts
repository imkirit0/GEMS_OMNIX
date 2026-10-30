// Fee ledger: T-FL-001…003 (audit 09; docs/designs/fee-ledger/fee-ledger.md). The Day Book page is a real-server smoke check.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { auth } from "../src/server/auth/http";
import { Forbidden } from "../src/server/action";
import { admit, type AdmitInput } from "../src/server/people";
import { createDues } from "../src/server/dues";
import * as fee from "../src/server/fees";
import { cancelReceipt, collectFee, FEE_GATES, type CollectInput } from "../src/server/receipts";
import { dayBook, ledgerCentres } from "../src/server/ledger";
import { asAdmin, C, FC, reset, rows, seriesCurrent, setStepUp, ST_TOKEN, T } from "./fixtures";
import { FEE_S, seedFeePlan } from "./fee-seed";

const K = "tok-feeC", D = "tok-feeD", R = "tok-feeR", L_ = "tok-ledA", V = ST_TOKEN.sa;
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const key = () => crypto.randomUUID();
const acc = async (code: string) => (await sql(`select id from app.account where code = $1`, [code]))[0].id as number;
let n = 0;
const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({
  person: { givenName: `Ledger${++n}`, mobile: `98500${String(n).padStart(5, "0")}` }, centreId: C.A, academicYear: "2026-27",
  admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });
async function learner(centreId: number = C.A, tok: string = V) {
  const a = await admit(tok, input({ centreId }));
  const dca = a.registrations[0]!.id;
  await createDues(D, a.personId, dca);
  return { personId: a.personId, dca };
}
const pay = (personId: string, registrationId: string, o: Partial<CollectInput> = {}, tok = K) =>
  collectFee(tok, personId, { registrationId, amount: "100", mode: "CASH", idempotencyKey: key(), ...o });
/** A receipt's journal of a source: the entry and its lines (account code, debit, credit) in line order. */
async function journal(receiptId: string, source = "RECEIPT") {
  const [e] = await sql(`select id::text, entry_date = (now() at time zone 'Asia/Kolkata')::date as today, currency::text as currency, reference, narration,
    reversal_of::text as "reversalOf" from app.journal_entry where receipt_id = $1 and source = $2`, [receiptId, source]);
  if (!e) return null;
  const lines = await sql(`select a.code, l.debit::text as dr, l.credit::text as cr from app.journal_line l join app.account a on a.id = l.account_id
    where l.entry_id = $1 order by l.id`, [e.id]);
  return { ...e, lines: lines.map((l) => [l.code, l.dr, l.cr]) };
}
const unbalanced = () => sql(`select entry_id from app.journal_line group by entry_id having sum(debit) <> sum(credit) or sum(debit) = 0`);

let app: pg.Client;
let seed: Awaited<ReturnType<typeof seedFeePlan>>;
let period = "";
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(async () => {
  await reset(); await setStepUp(FEE_S, 0); seed = await seedFeePlan(); await setStepUp(R, 0);
  FEE_GATES.collectionLive = true;
  period = (await sql(`select app.financial_year((now() at time zone 'Asia/Kolkata')::date) as p`))[0].p;
  await sql(`insert into app.number_series (centre_id, doc_type, period, gap_rule) select c, 'FEEREC', $1, 'GAPLESS' from unnest(array[1, 2, 3]) c
    on conflict do nothing`, [period]);
  await sql(`update app.centre set gst_enabled = true, gst_supply = 'STATE', gstin = '32ABCDE1234F1Z5' where id = $1`, [C.A]);
});
afterEach(() => { FEE_GATES.collectionLive = false; });

describe("T-FL fee ledger", () => {
  test("T-FL-001 journals at receipt and cancellation: by account, taxes, modes, items, currency, the mirror, the unmapped", async () => {
    const L = await learner();
    // cash, intra-state: Dr cash / Cr each head its taxable / Cr CGST, SGST
    const r1 = await pay(L.personId, L.dca, { amount: "600" });
    expect(await journal(r1.receiptId)).toEqual({ id: expect.any(String), today: true, currency: "INR", reference: r1.receiptNo,
      narration: `Receipt ${r1.receiptNo}`, reversalOf: null,
      lines: [["G001", "600.00", "0.00"], ["3908", "0.00", "423.73"], ["3909", "0.00", "84.75"], ["3910", "0.00", "45.77"], ["3911", "0.00", "45.75"]] });
    // UPI, inter-state: Dr bank / Cr IGST
    await sql(`update app.centre set gst_supply = 'INTERSTATE' where id = $1`, [C.A]);
    const r2 = await pay(L.personId, L.dca, { amount: "118", mode: "UPI", reference: "U-1" });
    expect((await journal(r2.receiptId))!.lines).toEqual([["G002", "118.00", "0.00"], ["3909", "0.00", "100.00"], ["4385", "0.00", "18.00"]]);
    await sql(`update app.centre set gst_supply = 'STATE' where id = $1`, [C.A]);
    // an ad-hoc item credits its own head
    const { id: EXAM } = await fee.createFeeType(FEE_S, { code: "exam", name: "Exam Fee", categoryId: seed.catId, sortOrder: 20, hsnSac: "999293", gstRate: "18",
      accountId: await acc("3923") });
    const r3 = await pay(L.personId, L.dca, { amount: "0", extras: [{ feeTypeId: EXAM, amount: "118" }] });
    expect((await journal(r3.receiptId))!.lines).toEqual([["G001", "118.00", "0.00"], ["3923", "0.00", "100.00"], ["3910", "0.00", "9.00"], ["3911", "0.00", "9.00"]]);
    // the cancellation is the exact mirror, dated today, linked; a later re-mapping never changes a reversal
    await fee.updateFeeType(FEE_S, seed.course, { accountId: await acc("3922") });
    await cancelReceipt(R, r2.receiptId, "wrong mode");
    const orig = await journal(r2.receiptId), rev = await journal(r2.receiptId, "RECEIPT_CANCEL");
    expect(rev).toMatchObject({ today: true, currency: "INR", reference: r2.receiptNo, narration: `Reversal of ${r2.receiptNo}`, reversalOf: orig!.id,
      lines: [["G002", "0.00", "118.00"], ["3909", "100.00", "0.00"], ["4385", "18.00", "0.00"]] });
    // a fee type without an account: refused at commit, no number used
    await fee.updateFeeType(FEE_S, EXAM, { accountId: null });
    const before = await seriesCurrent(C.A, "FEEREC", period);
    expect(await thrown(pay(L.personId, L.dca, { amount: "0", extras: [{ feeTypeId: EXAM, amount: "10" }] }))).toMatchObject({ key: "fee.receipt.noaccount" });
    expect(await seriesCurrent(C.A, "FEEREC", period)).toBe(before);
    expect(await sql(`select count(*)::int as n from app.receipt where centre_id = 1`)).toEqual([{ n: 3 }]);
    // another currency: the journal carries it, no tax lines (D-CUR-1, DD-10)
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
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 30, 'CENTRE', $2), ($3, 29, 'CENTRE', $2)`,
      [FC.a, C.A2, "00000000-0000-0000-0000-0000000000f7"]);
    const atA2 = await learner(C.A2, ST_TOKEN.sr);
    const usd = await pay(atA2.personId, atA2.dca, { amount: "50" });
    expect(await journal(usd.receiptId)).toMatchObject({ currency: "USD", lines: [["G001", "50.00", "0.00"], ["3908", "0.00", "50.00"]] });
    // every entry balances
    expect(await unbalanced()).toEqual([]);
  });

  test("T-FL-002 the database proves the ledger: no writer but the posting functions, balance, reversal, access, mapping", async () => {
    const L = await learner();
    const r = await pay(L.personId, L.dca, { amount: "50" });
    const [{ id: entry }] = await sql(`select id::text from app.journal_entry where receipt_id = $1`, [r.receiptId]);
    const as = async (tok: string, q: string, p: unknown[] = []) => {
      await app.query("begin");
      await app.query("select set_config('app.session_id', $1, true)", [tok]);
      try { return { rows: (await app.query(q, p)).rows, err: null }; }
      catch (e) { return { rows: [], err: e as { code: string; message: string } }; }
      finally { await app.query("rollback"); }
    };
    // the app writes no journal and cannot call the posting functions
    for (const q of [`insert into app.journal_entry (centre_id, entry_date, currency, source, receipt_id, reference, narration) values (1, current_date, 'INR', 'RECEIPT', ${r.receiptId}, 'x', 'x')`,
      `update app.journal_line set debit = debit where entry_id = ${entry}`, `delete from app.journal_line`, `delete from app.journal_entry`,
      `select app.receipt_post_journal()`, `select app.receipt_post_reversal()`, `update app.account set active = false`]) {
      expect((await as(K, q)).err, q).toMatchObject({ code: "42501" });
    }
    // kept for good, even by the owner
    for (const [q, want] of [[`update app.journal_entry set narration = 'x'`, "journal_entry is append-only"], [`delete from app.journal_line`, "journal_line is append-only"],
      [`truncate app.journal_line`, "journal_line is append-only"], [`truncate app.journal_entry cascade`, "is append-only"]] as const) {
      const e = await asAdmin(async (db) => { await db.query("begin"); try { await db.query(q); return null; } catch (x) { return (x as Error).message; } finally { await db.query("rollback"); } });
      expect(e, q).toContain(want);
    }
    // an entry that would not balance is refused by name (the total check lifted for this transaction only, as the owner)
    const bal = await asAdmin(async (db) => {
      await db.query("begin");
      try {
        await db.query("select set_config('app.session_id', $1, true)", [K]);
        const cur = (await db.query(`update app.number_series set current = current + 1 where centre_id = 1 and doc_type = 'FEEREC' and period = $1 returning current`, [period])).rows[0].current;
        await db.query(`alter table app.receipt disable trigger receipt_total_commit`);
        const id = (await db.query(`insert into app.receipt (centre_id, registration_id, period, number, mode, currency, total, idempotency_key)
          values (1, $1, $2, $3, 'CASH', 'INR', 11, gen_random_uuid()) returning id`, [L.dca, period, cur])).rows[0].id;
        const [due] = (await db.query(`select b.due_id from app.fee_due_balance b where b.registration_id = $1 and b.owed > 0 order by b.due_id limit 1`, [L.dca])).rows;
        await db.query(`insert into app.receipt_allocation (receipt_id, centre_id, due_id, amount) values ($1, 1, $2, 10)`, [id, due.due_id]);
        await db.query("commit");
        return null;
      } catch (e) { await db.query("rollback"); return (e as Error).message; }
    });
    expect(bal).toContain("journal_balance_guard");
    expect(await sql(`select tgenabled from pg_trigger where tgname = 'receipt_total_commit'`)).toEqual([{ tgenabled: "O" }]); // rolled back with it
    // read only with ledger.view at the centre
    expect((await as(T.uA, `select count(*)::int as n from app.journal_line`)).rows[0]).toEqual({ n: 0 });
    expect((await as(V, `select count(*)::int as n from app.journal_entry`)).rows[0]).toEqual({ n: 0 });
    expect((await as(L_, `select count(*)::int as n from app.journal_entry`)).rows[0]).toEqual({ n: 1 });
    // a fee type maps only to an active income or liability head
    const bad: [number, string][] = [[await acc("G001"), "cash (system, asset)"], [await acc("3910"), "CGST (system)"], [987654, "unknown"]];
    for (const [id, why] of bad) expect(await msg(fee.updateFeeType(FEE_S, seed.course, { accountId: id })), why).toBe("accountId: an active income or liability account");
    await sql(`update app.account set active = false where code = '3919'`);
    expect(await msg(fee.updateFeeType(FEE_S, seed.course, { accountId: await acc("3919") }))).toBe("accountId: an active income or liability account");
    const byOwner = await asAdmin(async (db) => {
      await db.query("begin");
      try { await db.query(`update app.fee_type set account_id = $1 where id = $2`, [await acc("3910"), seed.course]); return null; }
      catch (e) { return (e as Error).message; } finally { await db.query("rollback"); }
    });
    expect(byOwner).toContain("fee_type_account_guard");
    await fee.updateFeeType(FEE_S, seed.course, { accountId: await acc("3724") }); // a liability head is allowed (DD-7)
  });

  test("T-FL-003 the Day Book: lines, sources, totals per currency, the range cap, scope; mapping audited", async () => {
    const L = await learner();
    const r1 = await pay(L.personId, L.dca, { amount: "600" });
    const r2 = await pay(L.personId, L.dca, { amount: "100" });
    await cancelReceipt(R, r2.receiptId, "test");
    expect(await ledgerCentres(L_)).toEqual([{ id: C.A, code: "KL2-25", name: "Centre A" }]);
    expect(await ledgerCentres(T.uA)).toEqual([]);
    const today = (await sql(`select (now() at time zone 'Asia/Kolkata')::date::text as d`))[0].d as string;
    const book = await dayBook(L_, C.A, today, today);
    expect(book.rows.map((x) => [x.reference, x.source, x.accountCode, x.debit, x.credit])).toEqual([
      [r1.receiptNo, "Receipt", "G001", "600.00", "0.00"], [r1.receiptNo, "Receipt", "3908", "0.00", "423.73"], [r1.receiptNo, "Receipt", "3909", "0.00", "84.75"],
      [r1.receiptNo, "Receipt", "3910", "0.00", "45.77"], [r1.receiptNo, "Receipt", "3911", "0.00", "45.75"],
      [r2.receiptNo, "Receipt", "G001", "100.00", "0.00"], [r2.receiptNo, "Receipt", "3909", "0.00", "84.75"], [r2.receiptNo, "Receipt", "3910", "0.00", "7.63"],
      [r2.receiptNo, "Receipt", "3911", "0.00", "7.62"],
      [r2.receiptNo, "Reversal", "G001", "0.00", "100.00"], [r2.receiptNo, "Reversal", "3909", "84.75", "0.00"], [r2.receiptNo, "Reversal", "3910", "7.63", "0.00"],
      [r2.receiptNo, "Reversal", "3911", "7.62", "0.00"]]);
    expect(book.totals).toEqual([{ currency: "INR", debit: "800.00", credit: "800.00" }]);
    expect((await dayBook(L_, C.A, "2000-01-01", "2000-01-31")).rows).toEqual([]);
    // the range and the dates
    expect(await msg(dayBook(L_, C.A, "2026-01-01", "2026-04-03"))).toBe("to: within 92 days of from");
    expect((await dayBook(L_, C.A, "2026-01-01", "2026-04-02")).rows).toEqual([]); // 92 days counting both ends
    expect(await msg(dayBook(L_, C.A, "2026-02-01", "2026-01-01"))).toBe("to: not before from");
    expect(await msg(dayBook(L_, C.A, "x", today))).toBe("from: a date");
    // scope: another centre, or no ledger.view
    expect(await thrown(dayBook(L_, C.B, today, today))).toBeInstanceOf(Forbidden);
    expect(await thrown(dayBook(K, C.A, today, today))).toBeInstanceOf(Forbidden);
    // fee setup maps a head, audited
    await fee.updateFeeType(FEE_S, seed.reg, { accountId: await acc("6871") });
    expect((await rows("fee.type.update")).filter((x) => x.outcome === "OK").at(-1)).toMatchObject({ after: { accountId: await acc("6871") } });
  });
});
