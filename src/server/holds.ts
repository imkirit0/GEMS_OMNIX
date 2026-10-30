// Fee holds (docs/designs/fee-holds, Stage 4 F4b, R-067, D-FEE-5): a centre holds one plan due with a reason and releases it
// later; each is an append-only event, the latest (ids assigned under the fee-dues lock) is the state. A held due stays owed but
// is not collected: fee_due_balance defines held and collectable once, and the allocation guard refuses a held due (0031).
import { authorize, Forbidden, scopedAction } from "./action";
import { withScope } from "./db";
import { bad } from "./catalogue";
import { isoDate, PersonError } from "./person-rules";
import { RbacError } from "./rbac";

export type HeldRow = { dueId: string; personId: string; learner: string; courseCode: string; academicYear: string; feeTypeName: string;
  captionName: string; owed: string; since: string; by: string; reason: string };
export type HoldEventRow = { id: string; dueId: string; learner: string; feeTypeName: string; captionName: string; action: string;
  reason: string; at: string; by: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^\d{1,18}$/;
/** At most 92 days counting both ends, as the Day Book (DD-6 there; PMC). */
const MAX_SPAN_DAYS = 91;
const mismatch = () => new RbacError("invalid", "the due did not match", "fee.hold.mismatch");

async function holdDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const x = e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } }; cause?: { originalCode?: string; originalMessage?: string } };
    const cause = x.meta?.driverAdapterError?.cause ?? x.cause;
    const c = cause?.originalCode;
    const name = /constraint "([^"]+)"/.exec(cause?.originalMessage ?? "")?.[1] ?? "";
    if (name === "fee_hold_state_guard") throw new RbacError("invalid", "the due is already on hold, or is not on hold", "fee.hold.state");
    if (name === "fee_hold_paid_guard") throw new RbacError("invalid", "nothing is owed on this due", "fee.hold.paid");
    if (c === "23514" || c === "23503") throw mismatch();
    if (c === "42501") throw new Forbidden(cause?.originalMessage ?? "forbidden");
    throw e;
  }
}

/** Holds (hold = true) or releases one plan due of this learner (G1). Out of scope or another learner's due: not found. */
export async function setHold(session: string | undefined, personId: string, dueId: string, hold: boolean, reason: string): Promise<void> {
  if (typeof personId !== "string" || !UUID.test(personId) || typeof dueId !== "string" || !ID.test(dueId)) throw new PersonError("notfound");
  if (typeof hold !== "boolean") throw bad("action: hold or release");
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r === "") throw bad("reason: required");
  if (r.length > 500) throw bad("reason: 1-500 characters");
  const pre = await withScope(session, async (tx) => (await tx.$queryRaw<{ c: number; reg: string }[]>`
    select d.centre_id as c, d.registration_id::text as reg from app.fee_due d
      join app.registration g on g.id = d.registration_id join app.admission a on a.id = g.admission_id
    where d.id = ${dueId}::bigint and a.person_id = ${personId}::uuid
      and d.centre_id = any ((select app.scoped_centre_ids('student.view'))::int[])`)[0]);
  if (!pre) throw new PersonError("notfound");
  const centreId = pre.c;
  let owed: string | undefined;
  const run = (tx: Parameters<Parameters<typeof scopedAction>[2]>[0]) => holdDb(async () => {
    await authorize(tx, "student.view", centreId);
    const [st] = await tx.$queryRaw<{ s: string }[]>`select status::text as s from app.centre where id = ${centreId}`;
    if (st?.s !== "ACTIVE") throw bad("centreId: centre is not active");
    // the guard takes the fee-dues lock on insert; owed is read after it, for the audit (Z8-4)
    await tx.$executeRaw`insert into app.fee_hold_event (due_id, centre_id, action, reason)
      values (${dueId}::bigint, ${centreId}, ${hold ? "HOLD" : "RELEASE"}, ${r})`;
    owed = (await tx.$queryRaw<{ o: string }[]>`select owed::text as o from app.fee_due_balance where due_id = ${dueId}::bigint`)[0]?.o;
  });
  const detail = () => ({ after: { dueId, registrationId: pre.reg, owed, action: hold ? "HOLD" : "RELEASE" } });
  // two literal calls, so the audit catalogue gate reads both names
  await holdDb(() => (hold
    ? scopedAction(session, { action: "fee.hold", permission: "fee.hold", centreId, targetType: "fee_due", targetId: dueId, reason: r }, run, detail)
    : scopedAction(session, { action: "fee.release", permission: "fee.hold", centreId, targetType: "fee_due", targetId: dueId, reason: r }, run, detail)));
}

/** The centres whose holds the caller may manage and see (hold page, home link). */
export const holdCentres = (session: string | undefined) => withScope(session, (tx) =>
  tx.$queryRaw<{ id: number; code: string; name: string }[]>`
    select c.id, c.code, c.name from app.centre c
    where c.id = any (app.scoped_centre_ids('fee.hold')) and c.id = any (app.scoped_centre_ids('student.view')) order by c.code`);

/** A centre's dues currently on hold (R-067 hold list), newest hold first. */
export function heldDues(session: string | undefined, centreId: number, f: { feeTypeId?: number; courseCode?: string; academicYear?: string } = {}): Promise<HeldRow[]> {
  return withScope(session, async (tx) => {
    await authorize(tx, "student.view", centreId);
    const type = f.feeTypeId ?? null, course = f.courseCode || null, year = f.academicYear || null;
    return tx.$queryRaw<HeldRow[]>`
      select d.id::text as "dueId", p.id::text as "personId", trim(p.given_name || ' ' || coalesce(p.family_name, '')) as learner,
        g.course_code as "courseCode", a.academic_year as "academicYear", t.name as "feeTypeName", k.name as "captionName",
        b.owed::text as owed, to_char(e.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as since,
        coalesce(u.display_name, e.created_by::text) as by, e.reason
      from app.fee_due_balance b join app.fee_due d on d.id = b.due_id
        join app.registration g on g.id = d.registration_id join app.admission a on a.id = g.admission_id join app.person p on p.id = a.person_id
        join app.fee_type t on t.id = d.fee_type_id join app.fee_caption k on k.id = d.caption_id
        join lateral (select * from app.fee_hold_event e where e.due_id = d.id order by e.id desc limit 1) e on true
        left join app.app_user u on u.id = e.created_by
      where d.centre_id = ${centreId} and b.held
        and (${type}::int is null or d.fee_type_id = ${type}::int) and (${course}::text is null or g.course_code = ${course}::text)
        and (${year}::text is null or a.academic_year = ${year}::text)
      order by e.created_at desc, e.id desc`;
  });
}

/** Hold and release events of a centre for an IST date range (R-067 report: All, Hold, UnHold). */
export async function holdHistory(session: string | undefined, centreId: number, from: string, to: string, kind: string = "ALL"): Promise<HoldEventRow[]> {
  let f: string, t: string;
  try { f = isoDate("from", from); } catch { throw bad("from: a date"); }
  try { t = isoDate("to", to); } catch { throw bad("to: a date"); }
  if (t < f) throw bad("to: not before from");
  if (!["ALL", "HOLD", "RELEASE"].includes(kind)) throw bad("kind: one of the listed values");
  return withScope(session, async (tx) => {
    await authorize(tx, "student.view", centreId);
    const [span] = await tx.$queryRaw<{ ok: boolean }[]>`select ${t}::date - ${f}::date <= ${MAX_SPAN_DAYS} as ok`;
    if (!span!.ok) throw bad("to: within 92 days of from");
    return tx.$queryRaw<HoldEventRow[]>`
      select e.id::text, e.due_id::text as "dueId", trim(p.given_name || ' ' || coalesce(p.family_name, '')) as learner,
        t.name as "feeTypeName", k.name as "captionName", e.action, e.reason,
        to_char(e.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as at, coalesce(u.display_name, e.created_by::text) as by
      from app.fee_hold_event e join app.fee_due d on d.id = e.due_id
        join app.registration g on g.id = d.registration_id join app.admission a on a.id = g.admission_id join app.person p on p.id = a.person_id
        join app.fee_type t on t.id = d.fee_type_id join app.fee_caption k on k.id = d.caption_id
        left join app.app_user u on u.id = e.created_by
      where e.centre_id = ${centreId} and (e.created_at at time zone 'Asia/Kolkata')::date between ${f}::date and ${t}::date
        and (${kind} = 'ALL' or e.action = ${kind})
      order by e.id desc`;
  });
}
