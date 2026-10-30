// Fee collection and receipts (docs/designs/fee-receipts, Stage 4 F3, WF4): an offline receipt against one registration's
// dues, allocated oldest first by (due_on, id) (DD-1), with a gapless FEEREC number per centre and financial year (DD-4).
// Needs fee.collect (and student.view) at an active centre, while FEE_GATES.collectionLive is open (DD-5). The database
// stamps the date, the number text, the status and every line's GST, and proves the rest (0027). Money stays in SQL (F13).
import { authorize, Forbidden, scopedAction } from "./action";
import { withScope } from "./db";
import { bad } from "./catalogue";
import { FEE_GATES, lockKey } from "./dues";
import { allocate, SeriesMissing } from "./numbering";
import { isoDate, istToday, PersonError } from "./person-rules";
import { RbacError } from "./rbac";

export { FEE_GATES };
export const MODES = ["CASH", "CHEQUE", "DD", "BANK_TRANSFER", "UPI", "CARD"] as const;
export type CollectInput = { registrationId: string; amount: string; mode: string; reference?: string; instrumentDate?: string; idempotencyKey: string };
export type Collected = { receiptId: string; receiptNo: string; total: string; replay: boolean };
export type ReceiptLine = { feeTypeName: string; captionName: string; hsnSac: string; gstRate: string; taxable: string; cgst: string;
  sgst: string; igst: string; amount: string };
export type ReceiptView = { id: string; receiptNo: string; receivedOn: string; mode: string; reference: string | null; instrumentDate: string | null;
  currency: string; total: string; status: string; centreCode: string; centreName: string; gstin: string | null; learner: string;
  courseCode: string; courseName: string; registerNo: string; personId: string; lines: ReceiptLine[];
  totals: { taxable: string; cgst: string; sgst: string; igst: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const ID = /^\d{1,18}$/;
const mismatch = () => new RbacError("invalid", "the receipt did not match the dues", "fee.receipt.mismatch");

// Database refusals by name first (the driver drops error.constraint, so it is read from the message), then by code.
// Applied inside the action (a 42501 becomes Forbidden with a DENIED row) and around it (commit-time errors) (R3, R5).
async function receiptDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const x = e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } }; cause?: { originalCode?: string; originalMessage?: string } };
    const cause = x.meta?.driverAdapterError?.cause ?? x.cause;
    const c = cause?.originalCode;
    const name = /constraint "([^"]+)"/.exec(cause?.originalMessage ?? "")?.[1] ?? "";
    if (name === "receipt_over_guard") throw new RbacError("invalid", "the amount is more than what is outstanding", "fee.receipt.over");
    if (name === "receipt_tax_guard") throw new RbacError("invalid", "the centre's GST details are incomplete", "fee.receipt.gst");
    // a 23505 on the idempotency key: another registration's receipt or one out of sight (Z8-3)
    if (c === "23514" || c === "23503" || c === "23505") throw mismatch();
    if (c === "42501") throw new Forbidden(cause?.originalMessage ?? "forbidden");
    throw e;
  }
}

/** Records one receipt (G1); the same key for the same registration returns the original (G3). */
export async function collectFee(session: string | undefined, personId: string, input: CollectInput): Promise<Collected> {
  if (!FEE_GATES.collectionLive) throw new RbacError("invalid", "fee collection is not switched on", "fee.receipt.closed");
  const regId = input?.registrationId;
  if (typeof personId !== "string" || !UUID.test(personId) || typeof regId !== "string" || !UUID.test(regId)) throw new PersonError("notfound");
  const key = input.idempotencyKey;
  if (typeof key !== "string" || !UUID.test(key)) throw bad("idempotencyKey: invalid");
  const amount = typeof input.amount === "string" ? input.amount.trim() : "";
  if (!AMOUNT.test(amount) || /^0+(\.0+)?$/.test(amount)) throw bad("amount: from 0.01, up to 2 decimals");
  const mode = input.mode;
  if (!(MODES as readonly string[]).includes(mode)) throw bad("mode: one of the listed values");
  const ref = typeof input.reference === "string" && input.reference.trim() !== "" ? input.reference.trim() : null;
  if (mode === "CASH" && ref !== null) throw bad("reference: not for cash");
  if (mode !== "CASH" && ref === null) throw bad("reference: required for this mode");
  if (ref !== null && ref.length > 50) throw bad("reference: 1-50 characters");
  const rawDate = typeof input.instrumentDate === "string" && input.instrumentDate !== "" ? input.instrumentDate : null;
  const needsDate = mode === "CHEQUE" || mode === "DD";
  if (needsDate && rawDate === null) throw bad("instrumentDate: required for cheque and DD");
  if (!needsDate && rawDate !== null) throw bad("instrumentDate: only for cheque and DD");
  let instrumentDate: string | null = null;
  if (rawDate !== null) {
    try { instrumentDate = isoDate("instrumentDate", rawDate); } catch { throw bad("instrumentDate: a date"); }
    if (instrumentDate > istToday()) throw bad("instrumentDate: not after today"); // post-dated cheques are F4's (D13)
  }
  const pre = await withScope(session, async (tx) => {
    const [r] = await tx.$queryRaw<{ c: number }[]>`
      select r.centre_id as c from app.registration r join app.admission a on a.id = r.admission_id
      where r.id = ${regId}::uuid and a.person_id = ${personId}::uuid
        and r.centre_id = any ((select app.scoped_centre_ids('student.view'))::int[])`;
    if (!r) return null;
    const [n] = await tx.$queryRaw<{ id: string }[]>`select nextval('app.receipt_id_seq')::text as id`;
    return { centreId: r.c, id: n!.id };
  });
  if (!pre) throw new PersonError("notfound");
  const { centreId, id } = pre;
  let done: Collected | undefined;
  let lines = 0;
  return receiptDb(() => scopedAction(session, { action: "fee.receipt.create", permission: "fee.collect", centreId, targetType: "receipt", targetId: id },
    (tx) => receiptDb(async () => {
      await authorize(tx, "student.view", centreId);
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${lockKey(regId)}))`;
      // replay under the lock (C1, D1), before the trading gate (Z8-7)
      const [seen] = await tx.$queryRaw<{ id: string; reg: string; receiptNo: string; total: string }[]>`
        select id::text, registration_id::text as reg, receipt_no as "receiptNo", total::text as total from app.receipt where idempotency_key = ${key}::uuid`;
      if (seen) {
        if (seen.reg !== regId.toLowerCase()) throw mismatch();
        done = { receiptId: seen.id, receiptNo: seen.receiptNo, total: seen.total, replay: true };
        return done;
      }
      const [st] = await tx.$queryRaw<{ s: string }[]>`select status::text as s from app.centre where id = ${centreId}`;
      if (st?.s !== "ACTIVE") throw bad("centreId: centre is not active");
      const [owed] = await tx.$queryRaw<{ n: number; over: boolean; currency: string | null }[]>`
        select count(*)::int as n, coalesce(${amount}::numeric > sum(b.outstanding), true) as over, min(d.currency::text) as currency
        from app.fee_due_balance b join app.fee_due d on d.id = b.due_id
        where b.registration_id = ${regId}::uuid and b.outstanding > 0`;
      if (owed!.n === 0) throw new RbacError("invalid", "nothing is outstanding", "fee.receipt.nothing");
      if (owed!.over) throw new RbacError("invalid", "the amount is more than what is outstanding", "fee.receipt.over");
      const period = (await tx.$queryRaw<{ period: string }[]>`select app.financial_year((now() at time zone 'Asia/Kolkata')::date) as period`)[0]!.period;
      let number: bigint;
      try {
        number = await allocate(tx, { centreId, docType: "FEEREC", period }, { create: "after-any-earlier" });
      } catch (e) {
        if (e instanceof SeriesMissing) throw new RbacError("invalid", "no receipt series for this centre", "fee.receipt.noseries");
        throw e;
      }
      const [made] = await tx.$queryRaw<{ receiptNo: string; total: string }[]>`
        insert into app.receipt (id, centre_id, registration_id, period, number, mode, reference, instrument_date, currency, total, idempotency_key)
        values (${id}::bigint, ${centreId}, ${regId}::uuid, ${period}, ${number}, ${mode}, ${ref}, ${instrumentDate}::date, ${owed!.currency},
          ${amount}::numeric, ${key}::uuid)
        returning receipt_no as "receiptNo", total::text as total`;
      // oldest first (DD-1): each open due takes what is left of the amount, up to its outstanding
      lines = await tx.$executeRaw`
        insert into app.receipt_allocation (receipt_id, centre_id, due_id, amount)
        select ${id}::bigint, ${centreId}, x.due_id, x.take from (
          select b.due_id, d.due_on,
            least(b.outstanding, ${amount}::numeric - coalesce(sum(b.outstanding) over (order by d.due_on, d.id
              rows between unbounded preceding and 1 preceding), 0)) as take
          from app.fee_due_balance b join app.fee_due d on d.id = b.due_id
          where b.registration_id = ${regId}::uuid and b.outstanding > 0) x
        where x.take > 0
        order by x.due_on, x.due_id`;
      done = { receiptId: id, receiptNo: made!.receiptNo, total: made!.total, replay: false };
      return done;
    }), () => (done?.replay
      ? { after: { replay: true, receiptId: done.receiptId, receiptNo: done.receiptNo } }
      : { after: { receiptNo: done?.receiptNo, total: done?.total, mode, lines } })));
}

/** One receipt with its lines and totals (G4); invisible, missing or malformed: not found. */
export function getReceipt(session: string | undefined, receiptId: string): Promise<ReceiptView> {
  if (typeof receiptId !== "string" || !ID.test(receiptId)) return Promise.reject(new RbacError("notfound", "receipt not found"));
  return withScope(session, async (tx) => {
    const [h] = await tx.$queryRaw<Omit<ReceiptView, "lines" | "totals">[]>`
      select r.id::text, r.receipt_no as "receiptNo", r.received_on::text as "receivedOn", r.mode, r.reference,
        r.instrument_date::text as "instrumentDate", r.currency::text as currency, r.total::text as total, r.status,
        c.code as "centreCode", c.name as "centreName", c.gstin, trim(p.given_name || ' ' || coalesce(p.family_name, '')) as learner,
        co.code as "courseCode", co.name as "courseName", g.register_no as "registerNo", p.id::text as "personId"
      from app.receipt r join app.centre c on c.id = r.centre_id join app.registration g on g.id = r.registration_id
        join app.admission a on a.id = g.admission_id join app.person p on p.id = a.person_id join app.course co on co.code = g.course_code
      where r.id = ${receiptId}::bigint`;
    if (!h) throw new RbacError("notfound", "receipt not found");
    const lines = await tx.$queryRaw<ReceiptLine[]>`
      select t.name as "feeTypeName", k.name as "captionName", l.hsn_sac as "hsnSac", l.gst_rate::numeric(7,2)::text as "gstRate",
        l.taxable::text as taxable, l.cgst::text as cgst, l.sgst::text as sgst, l.igst::text as igst, l.amount::text as amount
      from app.receipt_allocation l join app.fee_due d on d.id = l.due_id join app.fee_type t on t.id = d.fee_type_id
        join app.fee_caption k on k.id = d.caption_id
      where l.receipt_id = ${receiptId}::bigint order by d.due_on, d.id`;
    const [totals] = await tx.$queryRaw<ReceiptView["totals"][]>`
      select sum(taxable)::text as taxable, sum(cgst)::text as cgst, sum(sgst)::text as sgst, sum(igst)::text as igst
      from app.receipt_allocation where receipt_id = ${receiptId}::bigint`;
    return { ...h, lines, totals: totals! };
  });
}
