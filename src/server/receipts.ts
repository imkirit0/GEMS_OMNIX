// Fee collection and receipts (docs/designs/fee-receipts, Stage 4 F3, WF4): an offline receipt against one registration's
// dues, allocated oldest first by (due_on, id) (DD-1), with a gapless FEEREC number per centre and financial year (DD-4).
// Needs fee.collect (and student.view) at an active centre, while FEE_GATES.collectionLive is open (DD-5). The database
// stamps the date, the number text, the status and every line's GST, and proves the rest (0027). Money stays in SQL (F13).
import { authorize, Forbidden, scopedAction } from "./action";
import { withScope } from "./db";
import { bad } from "./catalogue";
import { FEE_GATES, lockKey } from "./dues";
import { resolvePlan } from "./fees";
import { allocate, SeriesMissing } from "./numbering";
import { isoDate, istToday, PersonError } from "./person-rules";
import { RbacError, StepUpRequired } from "./rbac";

export { FEE_GATES };
export const MODES = ["CASH", "CHEQUE", "DD", "BANK_TRANSFER", "UPI", "CARD"] as const;
export type Extra = { feeTypeId: number; amount: string };
export type CollectInput = { registrationId: string; amount: string; mode: string; reference?: string; instrumentDate?: string; idempotencyKey: string;
  extras?: Extra[] }; // ad-hoc items (docs/designs/adhoc-fees)
/** Ad-hoc items per receipt (adhoc-fees DD-1). */
export const MAX_EXTRAS = 3;
const EXTRA_AMOUNT = /^\d{1,7}(\.\d{1,2})?$/;
export type Collected = { receiptId: string; receiptNo: string; total: string; replay: boolean };
export type ReceiptLine = { feeTypeName: string; captionName: string; adhoc: boolean; hsnSac: string; gstRate: string; taxable: string; cgst: string;
  sgst: string; igst: string; amount: string };
export type ReceiptView = { id: string; receiptNo: string; receivedOn: string; mode: string; reference: string | null; instrumentDate: string | null;
  currency: string; total: string; status: string; cancelledAt: string | null; cancelReason: string | null; canCancel: boolean; centreCode: string; centreName: string; gstin: string | null; learner: string;
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
    if (name === "journal_account_guard") throw new RbacError("invalid", "a fee type on this receipt has no ledger account", "fee.receipt.noaccount");
    if (name === "fee_due_adhoc_plan_guard") throw new RbacError("invalid", "that fee type is on the learner's plan", "fee.receipt.adhocplan");
    if (name === "receipt_hold_guard") throw new RbacError("invalid", "some dues are on hold", "fee.receipt.held");
    if (name === "receipt_tax_guard") throw new RbacError("invalid", "the centre's GST details are incomplete", "fee.receipt.gst");
    // cancellation (receipt-cancel): the guard alone decides the day, the status and the step-up
    if (name === "receipt_cancel_late_guard") throw new RbacError("invalid", "the receipt is not from today", "fee.receipt.late");
    if (name === "receipt_cancel_status_guard") throw new RbacError("invalid", "the receipt is cancelled", "fee.receipt.cancelled");
    if (name === "receipt_cancel_stepup_guard") throw new StepUpRequired("re-enter your password to continue");
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
  // ad-hoc items first: they decide whether a plan amount of 0 is allowed (adhoc-fees DD-4, R8)
  const extras = input.extras ?? [];
  if (!Array.isArray(extras) || extras.length > MAX_EXTRAS) throw bad(`extras: at most ${MAX_EXTRAS}`);
  for (const x of extras) {
    if (!Number.isSafeInteger(x?.feeTypeId) || x.feeTypeId < 1) throw bad("extras: fee type");
    if (typeof x.amount !== "string" || !EXTRA_AMOUNT.test(x.amount.trim()) || /^0+(\.0+)?$/.test(x.amount.trim())) throw bad("extras: amount from 0.01, up to 99,99,999.99");
  }
  if (new Set(extras.map((x) => x.feeTypeId)).size !== extras.length) throw bad("extras: one line per fee type");
  const extraTypes = extras.map((x) => x.feeTypeId), extraAmounts = extras.map((x) => x.amount.trim());
  const amount = typeof input.amount === "string" && input.amount.trim() !== "" ? input.amount.trim() : extras.length > 0 ? "0" : "";
  const zero = /^0+(\.0+)?$/.test(amount);
  if (!AMOUNT.test(amount) || (zero && extras.length === 0)) throw bad("amount: from 0.01, up to 2 decimals");
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
      const [seen] = await tx.$queryRaw<{ id: string; reg: string; receiptNo: string; total: string; status: string }[]>`
        select id::text, registration_id::text as reg, receipt_no as "receiptNo", total::text as total, status
        from app.receipt where idempotency_key = ${key}::uuid`;
      if (seen) {
        // a form resubmitted after its receipt was cancelled is never shown as a payment (receipt-cancel D1)
        if (seen.status === "CANCELLED") throw new RbacError("invalid", "the receipt is cancelled", "fee.receipt.cancelled");
        if (seen.reg !== regId.toLowerCase()) throw mismatch();
        done = { receiptId: seen.id, receiptNo: seen.receiptNo, total: seen.total, replay: true };
        return done;
      }
      const [st] = await tx.$queryRaw<{ s: string }[]>`select status::text as s from app.centre where id = ${centreId}`;
      if (st?.s !== "ACTIVE") throw bad("centreId: centre is not active");
      if (extras.length > 0) {
        const [ok] = await tx.$queryRaw<{ n: number }[]>`select count(*)::int as n from app.fee_type where id = any (${extraTypes}::int[]) and active`;
        if (ok!.n !== extras.length) throw bad("extras: fee type");
        // a plan fee is collected against its dues, never ad hoc: also before Create dues (adhoc-fees Z8-1, R4)
        const [g] = await tx.$queryRaw<{ courseId: number; year: string }[]>`
          select co.id as "courseId", a.academic_year as year from app.registration r join app.admission a on a.id = r.admission_id
            join app.course co on co.code = r.course_code where r.id = ${regId}::uuid`;
        const plan = await resolvePlan(tx, centreId, g!.courseId, g!.year);
        if (plan) {
          const [hit] = await tx.$queryRaw<{ x: boolean }[]>`
            select exists (select 1 from app.fee_plan_line where plan_id = ${plan.planId} and fee_type_id = any (${extraTypes}::int[])) as x`;
          if (hit!.x) throw new RbacError("invalid", "that fee type is on the learner's plan", "fee.receipt.adhocplan");
        }
      }
      // what is owed: PLAN dues only (fee_due_balance.owed, adhoc-fees DD-6)
      // a held due stays owed but is not collected (fee-holds DD-2): owed decides nothing/over, collectable decides held
      const [owed] = await tx.$queryRaw<{ n: number; nc: number; over: boolean; overc: boolean; currency: string | null }[]>`
        select count(*)::int as n, (count(*) filter (where b.collectable > 0))::int as nc,
          ${amount}::numeric > coalesce(sum(b.owed), 0) as over, ${amount}::numeric > coalesce(sum(b.collectable), 0) as overc,
          min(d.currency::text) as currency
        from app.fee_due_balance b join app.fee_due d on d.id = b.due_id
        where b.registration_id = ${regId}::uuid and b.owed > 0`;
      if (!zero && owed!.n === 0) throw new RbacError("invalid", "nothing is outstanding", "fee.receipt.nothing");
      if (owed!.over) throw new RbacError("invalid", "the amount is more than what is outstanding", "fee.receipt.over");
      if (!zero && (owed!.nc === 0 || owed!.overc)) throw new RbacError("invalid", "some dues are on hold", "fee.receipt.held");
      const currency = owed!.currency ?? "INR";
      if (extras.length > 0 && currency !== "INR") throw bad("extras: INR only");
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
        values (${id}::bigint, ${centreId}, ${regId}::uuid, ${period}, ${number}, ${mode}, ${ref}, ${instrumentDate}::date, ${currency},
          ${amount}::numeric + (select coalesce(sum(x), 0) from unnest(${extraAmounts}::numeric[]) x), ${key}::uuid)
        returning receipt_no as "receiptNo", total::text as total`;
      // each ad-hoc item: its due, then its full line, as separate statements (the line's guard reads the due, C7)
      for (const [i, t] of extraTypes.entries()) {
        const [d] = await tx.$queryRaw<{ id: string }[]>`
          insert into app.fee_due (registration_id, centre_id, source, fee_type_id, due_on, gross, currency)
          values (${regId}::uuid, ${centreId}, 'ADHOC', ${t}, (now() at time zone 'Asia/Kolkata')::date, ${extraAmounts[i]}::numeric, 'INR')
          returning id::text`;
        await tx.$executeRaw`insert into app.receipt_allocation (receipt_id, centre_id, due_id, amount)
          values (${id}::bigint, ${centreId}, ${d!.id}::bigint, ${extraAmounts[i]}::numeric)`;
      }
      // oldest first (DD-1): each open due takes what is left of the amount, up to its outstanding
      lines = await tx.$executeRaw`
        insert into app.receipt_allocation (receipt_id, centre_id, due_id, amount)
        select ${id}::bigint, ${centreId}, x.due_id, x.take from (
          select b.due_id, d.due_on,
            least(b.collectable, ${amount}::numeric - coalesce(sum(b.collectable) over (order by d.due_on, d.id
              rows between unbounded preceding and 1 preceding), 0)) as take
          from app.fee_due_balance b join app.fee_due d on d.id = b.due_id
          where b.registration_id = ${regId}::uuid and b.collectable > 0) x
        where x.take > 0
        order by x.due_on, x.due_id`;
      lines += extras.length;
      done = { receiptId: id, receiptNo: made!.receiptNo, total: made!.total, replay: false };
      return done;
    }), () => (done?.replay
      ? { after: { replay: true, receiptId: done.receiptId, receiptNo: done.receiptNo } }
      : { after: { receiptNo: done?.receiptNo, total: done?.total, mode, lines, extras: extras.map((x) => ({ feeTypeId: x.feeTypeId, amount: x.amount.trim() })) } })));
}

/** One receipt with its lines and totals (G4); invisible, missing or malformed: not found. */
export function getReceipt(session: string | undefined, receiptId: string): Promise<ReceiptView> {
  if (typeof receiptId !== "string" || !ID.test(receiptId)) return Promise.reject(new RbacError("notfound", "receipt not found"));
  return withScope(session, async (tx) => {
    const [h] = await tx.$queryRaw<Omit<ReceiptView, "lines" | "totals">[]>`
      select r.id::text, r.receipt_no as "receiptNo", r.received_on::text as "receivedOn", r.mode, r.reference,
        r.instrument_date::text as "instrumentDate", r.currency::text as currency, r.total::text as total, r.status,
        to_char(r.cancelled_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as "cancelledAt", r.cancel_reason as "cancelReason",
        (${FEE_GATES.collectionLive} and r.status = 'ACTIVE' and r.received_on = (now() at time zone 'Asia/Kolkata')::date
          and app.has_permission('fee.receipt.cancel', r.centre_id)) as "canCancel",
        c.code as "centreCode", c.name as "centreName", c.gstin, trim(p.given_name || ' ' || coalesce(p.family_name, '')) as learner,
        co.code as "courseCode", co.name as "courseName", g.register_no as "registerNo", p.id::text as "personId"
      from app.receipt r join app.centre c on c.id = r.centre_id join app.registration g on g.id = r.registration_id
        join app.admission a on a.id = g.admission_id join app.person p on p.id = a.person_id join app.course co on co.code = g.course_code
      where r.id = ${receiptId}::bigint`;
    if (!h) throw new RbacError("notfound", "receipt not found");
    const lines = await tx.$queryRaw<ReceiptLine[]>`
      select t.name as "feeTypeName", coalesce(k.name, 'Ad-hoc') as "captionName", d.source = 'ADHOC' as adhoc, l.hsn_sac as "hsnSac", l.gst_rate::numeric(7,2)::text as "gstRate",
        l.taxable::text as taxable, l.cgst::text as cgst, l.sgst::text as sgst, l.igst::text as igst, l.amount::text as amount
      from app.receipt_allocation l join app.fee_due d on d.id = l.due_id join app.fee_type t on t.id = d.fee_type_id
        left join app.fee_caption k on k.id = d.caption_id
      where l.receipt_id = ${receiptId}::bigint order by d.due_on, d.id`;
    const [totals] = await tx.$queryRaw<ReceiptView["totals"][]>`
      select sum(taxable)::text as taxable, sum(cgst)::text as cgst, sum(sgst)::text as sgst, sum(igst)::text as igst
      from app.receipt_allocation where receipt_id = ${receiptId}::bigint`;
    return { ...h, lines, totals: totals! };
  });
}

/**
 * Cancels a receipt on its own day (receipt-cancel G1). The database decides the day, the status and the step-up
 * (receipt_cancel_guard, 0028); dues come back through fee_due_balance. Unseen or malformed ids: not found (404).
 */
export async function cancelReceipt(session: string | undefined, receiptId: string, reason: string): Promise<{ receiptNo: string }> {
  if (!FEE_GATES.collectionLive) throw new RbacError("invalid", "fee collection is not switched on", "fee.receipt.closed");
  if (typeof receiptId !== "string" || !ID.test(receiptId)) throw new PersonError("notfound");
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r === "") throw bad("reason: required");
  if (r.length > 500) throw bad("reason: 1-500 characters");
  const centreId = await withScope(session, async (tx) =>
    (await tx.$queryRaw<{ c: number }[]>`select centre_id as c from app.receipt where id = ${receiptId}::bigint`)[0]?.c);
  if (centreId === undefined) throw new PersonError("notfound");
  let before: { status: string; receiptNo: string; total: string; registrationId: string } | undefined;
  let lines: { dueId: string; amount: string }[] = [];
  return receiptDb(() => scopedAction(session, { action: "fee.receipt.cancel", permission: "fee.receipt.cancel", centreId, targetType: "receipt",
    targetId: receiptId, reason: r },
    (tx) => receiptDb(async () => {
      await authorize(tx, "student.view", centreId);
      // for the audit only; the guard decides
      [before] = await tx.$queryRaw<{ status: string; receiptNo: string; total: string; registrationId: string }[]>`
        select status, receipt_no as "receiptNo", total::text as total, registration_id::text as "registrationId" from app.receipt where id = ${receiptId}::bigint`;
      lines = await tx.$queryRaw<{ dueId: string; amount: string }[]>`
        select due_id::text as "dueId", amount::text as amount from app.receipt_allocation where receipt_id = ${receiptId}::bigint order by id`;
      const n = await tx.$executeRaw`update app.receipt set status = 'CANCELLED', cancel_reason = ${r} where id = ${receiptId}::bigint`;
      if (n !== 1) throw new PersonError("notfound"); // RLS hid it: never audited as done (D3)
      return { receiptNo: before!.receiptNo };
    }),
    () => ({ before: { status: before?.status }, after: { status: "CANCELLED", receiptNo: before?.receiptNo, total: before?.total,
      registrationId: before?.registrationId, lines } }),
    (e) => (e instanceof RbacError && e.key === "fee.receipt.late" ? { action: "fee.receipt.cancel", extra: { after: { refused: "late" } } } : null)));
}
