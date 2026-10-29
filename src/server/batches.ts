// Course batches and time slots (docs/designs/course-batches, WF-X19, R-155). Reads need student.view at the centre;
// writes need batch.manage there too (DD-2), at an active centre (DD-5), through scopedAction without step-up (routine
// centre work, as enquiries). The database adds RLS on batch and registration_batch_guard on registration (0021).
import { authorize, Forbidden, scopedAction } from "./action";
import { withScope, type Tx } from "./db";
import { bad, code, reasonOf } from "./catalogue";
import { geoName } from "./centres";
import { RbacError } from "./rbac";

export type BatchRow = { id: number; code: string; name: string; startsAt: string; endsAt: string; capacity: number; active: boolean; placed: number };
export type PlacementRow = { registrationId: string; registerNo: string; admissionNo: string; givenName: string; familyName: string | null;
  batchId: number | null; batchCode: string | null };
export type BatchInput = { centreId: number; code: string; name: string; startsAt: string; endsAt: string; capacity: number };
export type BatchChanges = Partial<Pick<BatchInput, "name" | "startsAt" | "endsAt" | "capacity">>;

const MAX_CAPACITY = 500; // PMC
const MAX_PLACE = 200; // PMC
const MAX_LIST = 500; // PMC
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const centreOf = (v: unknown) => { if (!Number.isSafeInteger(v) || (v as number) < 1) throw bad("centreId: unknown"); return v as number; };
const idOf = (field: string, v: unknown) => { if (!Number.isSafeInteger(v) || (v as number) < 1) throw bad(`${field}: inactive or unknown`); return v as number; };
const time = (field: string, v: unknown) => { if (typeof v !== "string" || !TIME.test(v)) throw bad(`${field}: HH:MM`); return v; };
const capacityOf = (v: unknown) => {
  if (!Number.isSafeInteger(v) || (v as number) < 1 || (v as number) > MAX_CAPACITY) throw bad(`capacity: 1-${MAX_CAPACITY}`);
  return v as number;
};
const order = (startsAt: string, endsAt: string) => { if (endsAt <= startsAt) throw bad("endsAt: after startsAt"); };

// Database refusals as field errors (Z6); constraint names are read from the message (R1: the driver drops them).
const GUARD: Record<string, string> = { batch_capacity_guard: "batchId: full", batch_active_guard: "batchId: inactive or unknown",
  batch_registration_guard: "registrationIds: not active here", registration_batch_fkey: "batchId: inactive or unknown" };
async function batchDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const cause = (e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } }).meta?.driverAdapterError?.cause;
    const c = cause?.originalCode;
    const constraint = /constraint "([^"]+)"/.exec(cause?.originalMessage ?? "")?.[1] ?? "";
    if (c === "23505" && constraint === "batch_centre_id_code_key") throw new RbacError("duplicate", "that centre already has a batch with that code", "batch.duplicate");
    if ((c === "23514" || c === "23503") && Object.hasOwn(GUARD, constraint)) throw bad(GUARD[constraint]!);
    if (c === "23514") throw new RbacError("invalid", "invalid value");
    if (c === "42501") throw new Forbidden(cause?.originalMessage ?? "forbidden");
    throw e;
  }
}

/** Placing implies reading (C3), and an inactive centre takes no batch writes (DD-5). */
async function writeGate(tx: Tx, centreId: number) {
  await authorize(tx, "student.view", centreId); // DENIED names student.view
  const [st] = await tx.$queryRaw<{ s: string }[]>`select status::text as s from app.centre where id = ${centreId}`;
  if (st?.s !== "ACTIVE") throw bad("centreId: centre is not active");
}

// ---------- Reads ----------

/** Centres where the caller holds student.view (the picker and the home link); canManage per centre. */
export const batchCentres = (session: string | undefined) => withScope(session, (tx) =>
  tx.$queryRaw<{ id: number; code: string; name: string; active: boolean; canManage: boolean }[]>`
    select c.id, c.code, c.name, c.status = 'ACTIVE' as active,
           c.id = any (app.scoped_centre_ids('batch.manage')) as "canManage"
    from app.centre c where c.id = any (app.scoped_centre_ids('student.view')) order by c.code`);

const BATCH_COLS = (tx: Tx, centreId: number) => tx.$queryRaw<BatchRow[]>`
  select b.id, b.code, b.name, to_char(b.starts_at, 'HH24:MI') as "startsAt", to_char(b.ends_at, 'HH24:MI') as "endsAt",
         b.capacity, b.active,
         (select count(*) from app.registration r where r.batch_id = b.id and r.status = 'ACTIVE')::int as placed
  from app.batch b where b.centre_id = ${centreId} order by b.active desc, b.code`;

export function listBatches(session: string | undefined, centreId: number): Promise<BatchRow[]> {
  const c = centreOf(centreId);
  return withScope(session, async (tx) => { await authorize(tx, "student.view", c); return BATCH_COLS(tx, c); });
}

/** Courses with ACTIVE registrations at the centre (the place page's picker). */
export function placementCourses(session: string | undefined, centreId: number): Promise<{ code: string; name: string }[]> {
  const c = centreOf(centreId);
  return withScope(session, async (tx) => {
    await authorize(tx, "student.view", c);
    return tx.$queryRaw<{ code: string; name: string }[]>`select co.code, co.name from app.course co
      where exists (select 1 from app.registration r where r.course_code = co.code and r.centre_id = ${c} and r.status = 'ACTIVE')
      order by co.code`;
  });
}

export function listPlacements(session: string | undefined, centreId: number, courseCode: string, batchId?: number)
  : Promise<{ rows: PlacementRow[]; truncated: boolean }> {
  const c = centreOf(centreId);
  const b = batchId === undefined ? null : idOf("batchId", batchId);
  return withScope(session, async (tx) => {
    await authorize(tx, "student.view", c);
    const rows = await tx.$queryRaw<PlacementRow[]>`
      select r.id::text as "registrationId", r.register_no as "registerNo", a.admission_no as "admissionNo",
             p.given_name as "givenName", p.family_name as "familyName", r.batch_id as "batchId", bt.code as "batchCode"
      from app.registration r join app.admission a on a.id = r.admission_id join app.person p on p.id = a.person_id
        left join app.batch bt on bt.id = r.batch_id
      where r.centre_id = ${c} and r.course_code = ${String(courseCode)} and r.status = 'ACTIVE'
        and (${b}::int is null or r.batch_id = ${b}::int)
      order by r.register_no limit ${MAX_LIST + 1}`;
    return { rows: rows.slice(0, MAX_LIST), truncated: rows.length > MAX_LIST };
  });
}

// ---------- Writes ----------

export async function createBatch(session: string | undefined, input: BatchInput): Promise<{ id: number }> {
  const c = centreOf(input?.centreId);
  const k = code(input?.code), n = geoName(input?.name), s = time("startsAt", input?.startsAt), e = time("endsAt", input?.endsAt);
  order(s, e);
  const cap = capacityOf(input?.capacity);
  // the id first: scopedAction fixes the audit target before its callback (C4)
  const id = await withScope(session, async (tx) => (await tx.$queryRaw<{ id: number }[]>`select nextval('app.batch_id_seq')::int as id`)[0]!.id);
  return scopedAction(session, { action: "batch.create", permission: "batch.manage", centreId: c, targetType: "batch", targetId: String(id) },
    (tx) => batchDb(async () => {
      await writeGate(tx, c);
      await tx.$executeRaw`insert into app.batch (id, centre_id, code, name, starts_at, ends_at, capacity)
        values (${id}, ${c}, ${k}, ${n}, ${s}::time, ${e}::time, ${cap})`;
      return { id };
    }), () => ({ after: { code: k, name: n, startsAt: s, endsAt: e, capacity: cap, active: true } }));
}

export async function updateBatch(session: string | undefined, centreId: number, id: number, changes: BatchChanges): Promise<void> {
  const c = centreOf(centreId), i = idOf("id", id);
  const f: BatchChanges = {};
  if (changes?.name !== undefined) f.name = geoName(changes.name);
  if (changes?.startsAt !== undefined) f.startsAt = time("startsAt", changes.startsAt);
  if (changes?.endsAt !== undefined) f.endsAt = time("endsAt", changes.endsAt);
  if (changes?.capacity !== undefined) f.capacity = capacityOf(changes.capacity);
  if (Object.keys(f).length === 0) throw bad("nothing to change");
  let diff: [keyof BatchChanges, unknown, unknown][] = [];
  return scopedAction(session, { action: "batch.update", permission: "batch.manage", centreId: c, targetType: "batch", targetId: String(i) },
    (tx) => batchDb(async () => {
      await writeGate(tx, c);
      const [cur] = await tx.$queryRaw<{ name: string; startsAt: string; endsAt: string; capacity: number }[]>`
        select name, to_char(starts_at, 'HH24:MI') as "startsAt", to_char(ends_at, 'HH24:MI') as "endsAt", capacity
        from app.batch where id = ${i} and centre_id = ${c} for no key update`;
      if (!cur) throw new RbacError("notfound", "batch not found");
      const next = { ...cur, ...f };
      order(next.startsAt, next.endsAt);
      diff = (Object.keys(f) as (keyof BatchChanges)[]).filter((k) => cur[k] !== next[k]).map((k) => [k, cur[k], next[k]]);
      if (diff.length === 0) throw bad("nothing to change");
      if (next.capacity < cur.capacity) {
        const [p] = await tx.$queryRaw<{ n: number }[]>`select count(*)::int as n from app.registration where batch_id = ${i} and status = 'ACTIVE'`;
        if (p!.n > next.capacity) throw bad("capacity: below the learners placed");
      }
      await tx.$executeRaw`update app.batch set name = ${next.name}, starts_at = ${next.startsAt}::time, ends_at = ${next.endsAt}::time,
        capacity = ${next.capacity} where id = ${i}`;
    }), () => ({ before: Object.fromEntries(diff.map(([k, b]) => [k, b])), after: Object.fromEntries(diff.map(([k, , a]) => [k, a])) }));
}

// Two calls with literal actions, so the audit catalogue gate can read both names.
export async function setBatchActive(session: string | undefined, centreId: number, id: number, active: boolean, reason: string): Promise<void> {
  const c = centreOf(centreId), i = idOf("id", id);
  if (typeof active !== "boolean") throw bad("active: invalid");
  const r = reasonOf(reason);
  const run = (tx: Tx) => batchDb(async () => {
    await writeGate(tx, c);
    const [row] = await tx.$queryRaw<{ active: boolean }[]>`select active from app.batch where id = ${i} and centre_id = ${c} for no key update`;
    if (!row) throw new RbacError("notfound", "batch not found");
    if (row.active === active) throw bad(`already ${active ? "active" : "inactive"}`);
    await tx.$executeRaw`update app.batch set active = ${active} where id = ${i}`;
    return { before: { active: row.active }, after: { active } };
  });
  await (active
    ? scopedAction(session, { action: "batch.activate", permission: "batch.manage", centreId: c, targetType: "batch", targetId: String(i), reason: r }, run, (x) => x)
    : scopedAction(session, { action: "batch.deactivate", permission: "batch.manage", centreId: c, targetType: "batch", targetId: String(i), reason: r }, run, (x) => x));
}

/** Places registrations into a batch, moves them, or (batchId null) removes them. Capacity and the active target are the
 * guard trigger's (I4); the app locks in a fixed order (batch, then registrations by id) and skips unchanged rows. */
export async function placeLearners(session: string | undefined, centreId: number, batchId: number | null, registrationIds: string[])
  : Promise<{ changed: number }> {
  const c = centreOf(centreId);
  const b = batchId === null ? null : idOf("batchId", batchId);
  if (!Array.isArray(registrationIds) || registrationIds.length < 1 || registrationIds.length > MAX_PLACE
    || registrationIds.some((x) => typeof x !== "string" || !UUID.test(x)) || new Set(registrationIds.map((x) => x.toLowerCase())).size !== registrationIds.length) {
    throw bad(`registrationIds: 1-${MAX_PLACE} distinct ids`);
  }
  const ids = [...registrationIds].map((x) => x.toLowerCase()).sort();
  let audit: { before: Record<string, string | null>; after: { batch: string | null; registerNos: string[] } } | null = null;
  const meta = b === null
    ? { action: "batch.place", permission: "batch.manage", centreId: c, targetType: "centre", targetId: String(c) }
    : { action: "batch.place", permission: "batch.manage", centreId: c, targetType: "batch", targetId: String(b) };
  return scopedAction(session, meta, (tx) => batchDb(async () => {
    audit = null;
    await writeGate(tx, c);
    let target: string | null = null;
    if (b !== null) {
      const [t] = await tx.$queryRaw<{ code: string; active: boolean }[]>`select code, active from app.batch
        where id = ${b} and centre_id = ${c} for no key update`;
      if (!t || !t.active) throw bad("batchId: inactive or unknown");
      target = t.code;
    }
    const rows = await tx.$queryRaw<{ id: string; registerNo: string; status: string; batchId: number | null; batchCode: string | null }[]>`
      select r.id::text, r.register_no as "registerNo", r.status::text, r.batch_id as "batchId", bt.code as "batchCode"
      from app.registration r left join app.batch bt on bt.id = r.batch_id
      where r.id = any (${ids}::uuid[]) and r.centre_id = ${c} order by r.id for no key update of r`;
    if (rows.length !== ids.length || rows.some((r) => r.status !== "ACTIVE")) throw bad("registrationIds: not active here");
    const moving = rows.filter((r) => r.batchId !== b);
    if (moving.length === 0) throw bad("nothing to change");
    await tx.$executeRaw`update app.registration set batch_id = ${b}::int where id = any (${moving.map((r) => r.id)}::uuid[])`;
    audit = { before: Object.fromEntries(moving.map((r) => [r.registerNo, r.batchCode])),
      after: { batch: target, registerNos: moving.map((r) => r.registerNo).sort() } };
    return { changed: moving.length };
  }), () => audit ?? {});
}
