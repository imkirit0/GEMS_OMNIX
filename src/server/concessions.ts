// Concessions (docs/designs/fee-schemes, Stage 4 F5, D-SCH-2/3): a centre assigns one LIVE scheme to a registration, once, before
// anything is paid on its plan dues; the database stamps one concession per plan due of a ruled fee type (fee_concession_guard,
// 0032), and fee_due_balance subtracts them from what is owed. Needs fee.concession and student.view at an active centre.
// Every writer of a registration's money takes the fee-dues:<registrationId> lock first (dues.ts).
import { authorize, Forbidden, scopedAction } from "./action";
import { withScope } from "./db";
import { bad } from "./catalogue";
import { lockKey } from "./dues";
import { isoDate, PersonError } from "./person-rules";
import { RbacError } from "./rbac";

export type SchemeOption = { id: number; code: string; name: string };
export type ConcessionRow = { id: string; givenOn: string; personId: string; learner: string; registerNo: string; courseCode: string; schemeCode: string;
  feeTypeName: string; captionName: string; gross: string; amount: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** At most 92 days counting both ends, as the Day Book (DD-9; PMC). */
const MAX_SPAN_DAYS = 91;

// Database refusals by name first (the driver drops error.constraint, so it is read from the message), then by code; inside the
// action (a 42501 becomes Forbidden with a DENIED row) and around it (the deferred "given" check raises at commit, R8)
async function concessionDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const x = e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } }; cause?: { originalCode?: string; originalMessage?: string } };
    const cause = x.meta?.driverAdapterError?.cause ?? x.cause;
    const c = cause?.originalCode;
    const name = /constraint "([^"]+)"/.exec(cause?.originalMessage ?? "")?.[1] ?? "";
    if (name === "fee_scheme_paid_guard") throw new RbacError("invalid", "something is already paid on this course", "fee.scheme.paid");
    if (name === "fee_scheme_target_guard") throw new RbacError("invalid", "this scheme is not for this learner's course, centre or admission date", "fee.scheme.notfor");
    if (name === "fee_scheme_given_guard") throw new RbacError("invalid", "this scheme gives nothing on these dues", "fee.scheme.nothing");
    if (c === "23505") throw new RbacError("duplicate", "this course already has a scheme", "fee.scheme.exists");
    if (c === "23514" || c === "23503") throw new RbacError("invalid", "the scheme did not match the dues", "fee.scheme.mismatch");
    if (c === "42501") throw new Forbidden(cause?.originalMessage ?? "forbidden");
    throw e;
  }
}

/** Assigns a LIVE scheme to one registration of this learner (G2). Another person's or an out-of-scope registration is not found. */
export async function assignScheme(session: string | undefined, personId: string, registrationId: string, schemeId: number)
  : Promise<{ concessions: number; total: string }> {
  if (typeof personId !== "string" || !UUID.test(personId) || typeof registrationId !== "string" || !UUID.test(registrationId)) throw new PersonError("notfound");
  if (!Number.isSafeInteger(schemeId) || schemeId < 1) throw bad("schemeId: inactive or unknown");
  const pre = await withScope(session, async (tx) => (await tx.$queryRaw<{ c: number; id: string }[]>`
    select r.centre_id as c, nextval('app.fee_scheme_assignment_id_seq')::text as id
    from app.registration r join app.admission a on a.id = r.admission_id
    where r.id = ${registrationId}::uuid and a.person_id = ${personId}::uuid
      and r.centre_id = any ((select app.scoped_centre_ids('student.view'))::int[])`)[0]);
  if (!pre) throw new PersonError("notfound");
  const centreId = pre.c, id = pre.id;
  let done: { schemeCode?: string; concessions: number; total: string } = { concessions: 0, total: "0.00" };
  return concessionDb(() => scopedAction(session, { action: "fee.concession.assign", permission: "fee.concession", centreId, targetType: "fee_scheme_assignment", targetId: id },
    (tx) => concessionDb(async () => {
      await authorize(tx, "student.view", centreId);
      const [st] = await tx.$queryRaw<{ s: string }[]>`select status::text as s from app.centre where id = ${centreId}`;
      if (st?.s !== "ACTIVE") throw bad("centreId: centre is not active");
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${lockKey(registrationId)}))`;
      await tx.$executeRaw`insert into app.fee_scheme_assignment (id, registration_id, centre_id, scheme_id)
        values (${id}::bigint, ${registrationId}::uuid, ${centreId}, ${schemeId})`;
      // every plan due of a ruled fee type; the guard stamps each amount and skips a zero share (D7, DD-8)
      const n = await tx.$executeRaw`insert into app.fee_concession (assignment_id, due_id, centre_id)
        select ${id}::bigint, d.id, d.centre_id from app.fee_due d join app.fee_scheme_rule r on r.scheme_id = ${schemeId} and r.fee_type_id = d.fee_type_id
        where d.registration_id = ${registrationId}::uuid and d.source = 'PLAN' order by d.due_on, d.id`;
      if (n === 0) throw new RbacError("invalid", "this scheme gives nothing on these dues", "fee.scheme.nothing");
      const [t] = await tx.$queryRaw<{ total: string; code: string }[]>`select sum(c.amount)::text as total, s.code from app.fee_concession c
        join app.fee_scheme_assignment g on g.id = c.assignment_id join app.fee_scheme s on s.id = g.scheme_id
        where c.assignment_id = ${id}::bigint group by s.code`;
      done = { schemeCode: t!.code, concessions: n, total: t!.total };
      return { concessions: n, total: t!.total };
    }), () => ({ after: { registrationId, schemeId, ...done } })));
}

/** The LIVE schemes this registration may take: valid on its admission date, for its course and centre (needs student.view there). */
export function schemesFor(session: string | undefined, registrationId: string): Promise<SchemeOption[]> {
  if (typeof registrationId !== "string" || !UUID.test(registrationId)) return Promise.resolve([]);
  return withScope(session, async (tx) => {
    const [r] = await tx.$queryRaw<{ c: number }[]>`select centre_id as c from app.registration where id = ${registrationId}::uuid`;
    if (!r) return [];
    await authorize(tx, "student.view", r.c);
    return tx.$queryRaw<SchemeOption[]>`
      select s.id, s.code, s.name from app.registration g join app.admission a on a.id = g.admission_id join app.course co on co.code = g.course_code
        join app.fee_scheme s on s.status = 'LIVE' and a.admitted_on between s.valid_from and s.valid_to
      where g.id = ${registrationId}::uuid
        and exists (select 1 from app.fee_scheme_course x where x.scheme_id = s.id and x.course_id = co.id)
        and (not exists (select 1 from app.fee_scheme_centre x where x.scheme_id = s.id)
             or exists (select 1 from app.fee_scheme_centre x where x.scheme_id = s.id and x.centre_id = g.centre_id))
      order by s.code`;
  });
}

/** The centres whose concessions the caller may give and see (register page, home link; R9). */
export const concessionCentres = (session: string | undefined) => withScope(session, (tx) =>
  tx.$queryRaw<{ id: number; code: string; name: string }[]>`
    select c.id, c.code, c.name from app.centre c
    where c.id = any (app.scoped_centre_ids('fee.concession')) and c.id = any (app.scoped_centre_ids('student.view')) order by c.code`);

/** A centre's concessions for an IST date range, optionally of one scheme, with their total (G5, D6). */
export async function concessionRegister(session: string | undefined, centreId: number, from: string, to: string, schemeId?: number)
  : Promise<{ rows: ConcessionRow[]; total: string }> {
  let f: string, t: string;
  try { f = isoDate("from", from); } catch { throw bad("from: a date"); }
  try { t = isoDate("to", to); } catch { throw bad("to: a date"); }
  if (t < f) throw bad("to: not before from");
  const scheme = schemeId === undefined ? null : Number.isSafeInteger(schemeId) && schemeId > 0 ? schemeId : (() => { throw bad("scheme: unknown"); })();
  return withScope(session, async (tx) => {
    await authorize(tx, "student.view", centreId);
    const [span] = await tx.$queryRaw<{ ok: boolean }[]>`select ${t}::date - ${f}::date <= ${MAX_SPAN_DAYS} as ok`;
    if (!span!.ok) throw bad("to: within 92 days of from");
    const rows = await tx.$queryRaw<ConcessionRow[]>`
      select c.id::text, to_char(c.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "givenOn", p.id::text as "personId",
        trim(p.given_name || ' ' || coalesce(p.family_name, '')) as learner, g.register_no as "registerNo", g.course_code as "courseCode",
        s.code as "schemeCode", ft.name as "feeTypeName", k.name as "captionName", d.gross::text as gross, c.amount::text as amount
      from app.fee_concession c join app.fee_scheme_assignment x on x.id = c.assignment_id join app.fee_scheme s on s.id = x.scheme_id
        join app.fee_due d on d.id = c.due_id join app.registration g on g.id = d.registration_id join app.admission a on a.id = g.admission_id
        join app.person p on p.id = a.person_id join app.fee_type ft on ft.id = d.fee_type_id join app.fee_caption k on k.id = d.caption_id
      where c.centre_id = ${centreId} and (c.created_at at time zone 'Asia/Kolkata')::date between ${f}::date and ${t}::date
        and (${scheme}::int is null or x.scheme_id = ${scheme}::int)
      order by c.id`;
    const [sum] = await tx.$queryRaw<{ total: string }[]>`select coalesce(sum(c.amount), 0)::numeric(16,2)::text as total
      from app.fee_concession c join app.fee_scheme_assignment x on x.id = c.assignment_id
      where c.centre_id = ${centreId} and (c.created_at at time zone 'Asia/Kolkata')::date between ${f}::date and ${t}::date
        and (${scheme}::int is null or x.scheme_id = ${scheme}::int)`;
    return { rows, total: sum!.total };
  });
}
