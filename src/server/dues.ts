// Fee dues (docs/designs/fee-dues, Stage 4 F2, WF4): one immutable, gross-only due per registration x fee type x
// instalment, copied from the published plan that resolvePlan picks (DD-1). Created explicitly, once per registration, by
// fee.dues (and student.view) at the registration's centre, at an active centre (DD-2). The database proves each due
// against its plan and registration, and keeps it forever (fee_due_guard, 0026). Money: strings in and out, sums in SQL.
// Every writer of a registration's money takes the fee-dues:<registrationId> advisory lock first (lock contract, Z1).
import { authorize, Forbidden, scopedAction } from "./action";
import { withScope, type Tx } from "./db";
import { bad } from "./catalogue";
import { resolvePlan } from "./fees";
import { PersonError } from "./person-rules";
import { RbacError } from "./rbac";

export type DueRow = { id: string; feeTypeName: string; captionName: string; dueOn: string; gross: string; currency: string;
  paid: string; outstanding: string };
export type ReceiptRow = { id: string; receiptNo: string; receivedOn: string; total: string; mode: string };
export type RegistrationDues = { registrationId: string; dues: DueRow[]; total: string | null; canCreate: boolean; noPlan: boolean;
  outstanding: string | null; receipts: ReceiptRow[]; canCollect: boolean };

/** Fee collection switch (fee-receipts DD-5), committed closed: opens only after the tax advisor's check, Accounts' worked
 * examples, the legacy FEEREC seed (NP-8), the 16-character check and the ledger (or an accepted backfill rule). */
export const FEE_GATES = { collectionLive: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The lock key, built here (a NULL in SQL || would take no lock); the guard builds the same one. */
export const lockKey = (registrationId: string) => `fee-dues:${registrationId.toLowerCase()}`;

async function duesDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const cause = (e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } }).meta?.driverAdapterError?.cause;
    const c = cause?.originalCode;
    if (c === "23505") throw new RbacError("duplicate", "this course already has its dues", "fee.dues.exists");
    if (c === "23514" || c === "23503") throw new RbacError("invalid", "the dues did not match the fee plan", "fee.dues.mismatch");
    if (c === "42501") throw new Forbidden(cause?.originalMessage ?? "forbidden");
    throw e;
  }
}

/** Creates the dues inside the caller's transaction; no authorisation (the caller's job). */
async function createDuesTx(tx: Tx, registrationId: string, centreId: number) {
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${lockKey(registrationId)}))`;
  const [r] = await tx.$queryRaw<{ status: string; courseId: number; year: string }[]>`
    select r.status::text as status, co.id as "courseId", a.academic_year as year
    from app.registration r join app.admission a on a.id = r.admission_id join app.course co on co.code = r.course_code
    where r.id = ${registrationId}::uuid and r.centre_id = ${centreId}`;
  if (r?.status !== "ACTIVE") throw bad("registrationId: not active");
  const [has] = await tx.$queryRaw<{ n: number }[]>`select count(*)::int as n from app.fee_due where registration_id = ${registrationId}::uuid`;
  if (has!.n > 0) throw new RbacError("duplicate", "this course already has its dues", "fee.dues.exists");
  const plan = await resolvePlan(tx, centreId, r.courseId, r.year);
  if (!plan) throw new RbacError("invalid", "no published fee plan prices this course here", "fee.dues.noplan");
  const [v] = await tx.$queryRaw<{ version: number }[]>`select version from app.fee_plan where id = ${plan.planId}`;
  // D5: instalment order, then fee type order; F3 allocates oldest first by (due_on, id)
  const count = await tx.$executeRaw`
    insert into app.fee_due (registration_id, centre_id, plan_id, fee_type_id, caption_id, due_on, gross, currency)
    select ${registrationId}::uuid, ${centreId}, l.plan_id, l.fee_type_id, l.caption_id, c.due_on, l.amount, p.currency
    from app.fee_plan_line l join app.fee_plan p on p.id = l.plan_id
      join app.fee_caption c on c.id = l.caption_id join app.fee_type t on t.id = l.fee_type_id
    where l.plan_id = ${plan.planId}
    order by c.sort_order, c.due_on, t.sort_order, t.code`;
  const [t] = await tx.$queryRaw<{ total: string }[]>`select sum(gross)::text as total from app.fee_due where registration_id = ${registrationId}::uuid`;
  return { planId: plan.planId, version: v!.version, count, total: t!.total };
}

/** Creates one registration's dues from its plan (G1). Another person's or an out-of-scope registration is not found (G4). */
export async function createDues(session: string | undefined, personId: string, registrationId: string): Promise<{ count: number; total: string }> {
  if (typeof personId !== "string" || !UUID.test(personId) || typeof registrationId !== "string" || !UUID.test(registrationId)) throw new PersonError("notfound");
  const centreId = await withScope(session, async (tx) => (await tx.$queryRaw<{ c: number }[]>`
    select r.centre_id as c from app.registration r join app.admission a on a.id = r.admission_id
    where r.id = ${registrationId}::uuid and a.person_id = ${personId}::uuid
      and r.centre_id = any ((select app.scoped_centre_ids('student.view'))::int[])`)[0]?.c);
  if (centreId === undefined) throw new PersonError("notfound");
  let done: Awaited<ReturnType<typeof createDuesTx>> | undefined;
  return scopedAction(session, { action: "fee.dues.create", permission: "fee.dues", centreId, targetType: "registration", targetId: registrationId },
    (tx) => duesDb(async () => {
      await authorize(tx, "student.view", centreId);
      const [st] = await tx.$queryRaw<{ s: string }[]>`select status::text as s from app.centre where id = ${centreId}`;
      if (st?.s !== "ACTIVE") throw bad("centreId: centre is not active");
      done = await createDuesTx(tx, registrationId, centreId);
      return { count: done.count, total: done.total };
    }), () => ({ after: done ?? {} }));
}

/** Each of the person's registrations in the caller's student.view scope, with its dues and whether dues can be created (G3). */
export function duesForPerson(session: string | undefined, personId: string): Promise<RegistrationDues[]> {
  if (typeof personId !== "string" || !UUID.test(personId)) return Promise.resolve([]);
  return withScope(session, async (tx) => {
    const regs = await tx.$queryRaw<{ id: string; centreId: number; courseId: number; year: string; canCreate: boolean; canCollect: boolean }[]>`
      select r.id::text, r.centre_id as "centreId", co.id as "courseId", a.academic_year as year,
        (not exists (select 1 from app.fee_due d where d.registration_id = r.id) and r.status = 'ACTIVE' and ce.status = 'ACTIVE'
          and app.has_permission('fee.dues', r.centre_id)) as "canCreate",
        (ce.status = 'ACTIVE' and app.has_permission('fee.collect', r.centre_id)) as "canCollect"
      from app.registration r join app.admission a on a.id = r.admission_id
        join app.course co on co.code = r.course_code join app.centre ce on ce.id = r.centre_id
      where a.person_id = ${personId}::uuid and r.centre_id = any ((select app.scoped_centre_ids('student.view'))::int[])
      order by a.created_at, r.created_at`;
    if (regs.length === 0) return [];
    const ids = regs.map((r) => r.id);
    // paid and outstanding from the one definition (fee_due_balance, fee-receipts Z1)
    const dues = await tx.$queryRaw<(DueRow & { registrationId: string })[]>`
      select d.id::text, d.registration_id::text as "registrationId", t.name as "feeTypeName", c.name as "captionName",
        d.due_on::text as "dueOn", d.gross::text as gross, d.currency::text as currency, b.paid::text as paid, b.outstanding::text as outstanding
      from app.fee_due d join app.fee_type t on t.id = d.fee_type_id join app.fee_caption c on c.id = d.caption_id
        join app.fee_due_balance b on b.due_id = d.id
      where d.registration_id = any (${ids}::uuid[])
      order by d.due_on, d.id`;
    const totals = new Map((await tx.$queryRaw<{ id: string; total: string; outstanding: string; owing: boolean }[]>`
      select d.registration_id::text as id, sum(d.gross)::text as total, sum(b.outstanding)::text as outstanding, sum(b.outstanding) > 0 as owing
      from app.fee_due d join app.fee_due_balance b on b.due_id = d.id
      where d.registration_id = any (${ids}::uuid[]) group by d.registration_id`).map((t) => [t.id, t]));
    const receipts = await tx.$queryRaw<(ReceiptRow & { registrationId: string })[]>`
      select id::text, registration_id::text as "registrationId", receipt_no as "receiptNo", received_on::text as "receivedOn",
        total::text as total, mode
      from app.receipt where registration_id = any (${ids}::uuid[]) order by id desc`;
    const out: RegistrationDues[] = [];
    for (const r of regs) {
      const noPlan = r.canCreate ? (await resolvePlan(tx, r.centreId, r.courseId, r.year)) === null : false;
      const t = totals.get(r.id);
      out.push({ registrationId: r.id, dues: dues.filter((d) => d.registrationId === r.id).map(({ registrationId: _, ...d }) => d),
        total: t?.total ?? null, canCreate: r.canCreate, noPlan, outstanding: t?.outstanding ?? null,
        receipts: receipts.filter((x) => x.registrationId === r.id).map(({ registrationId: _, ...x }) => x),
        canCollect: FEE_GATES.collectionLive && r.canCollect && t?.owing === true });
    }
    return out;
  });
}
