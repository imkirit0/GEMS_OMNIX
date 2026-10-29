// Enquiry to admission (docs/designs/enquiry/enquiry.md): one merged enquiry per prospective learner at a centre (DD-1),
// worked through statuses with a counsellor and an append-only follow-up log, then enrolled through admit() (DD-9).
// Every write is a scopedAction on enquiry.manage at the enquiry's centre and locks its rows first, in id order (D1).
// Audit rows name fields, never values (DD-14). The database guards in 0018 back up the enrolment rules (DD-6, DD-15).
import { Prisma } from "../../generated/prisma/client";
import { Forbidden, scopedAction } from "./action";
import { withScope, type Tx } from "./db";
import { detailField, ownText, phoneDigits } from "./details";
import { unique } from "./catalogue";
import { CODE_RULE } from "./people";
import { identityField, invalid, isoDate, istToday, normCode, PersonError } from "./person-rules";
import { limitSearch } from "./rate-limit";
import { adminWrite, RbacError } from "./rbac";

// ---------- Types ----------

export type EnquiryInput = {
  centreId: number; givenName: string; familyName?: string | null; dateOfBirth: string; gender: string; mobile: string;
  email?: string | null; currentAddress?: string | null; currentPincode?: string | null; qualification?: string | null;
  guardianName?: string | null; guardianPhone?: string | null; whatsapp?: string | null; landline?: string | null;
  instagram?: string | null; lastSchool?: string | null; remark?: string | null;
  pathId: number; typeId: number; statusId?: number; enquiredOn?: string; courseCodes: string[];
};
export type EnquiryChanges = Partial<Omit<EnquiryInput, "centreId" | "statusId" | "enquiredOn">>;
export type Warning = { kind: "enquiry"; id: string; givenName: string; familyName: string | null }
  | { kind: "learner"; personId: string; givenName: string; familyName: string | null };
export const STATUS_KINDS = ["OPEN", "ENROLLED", "LOST", "JUNK"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];
export const FOLLOW_UP_KINDS: Record<string, string> = {
  CALL_IN: "Incoming call", CALL_OUT: "Outgoing call", VISIT: "Visit", MESSAGE: "Message", NOTE: "Note",
};

/** The same mobile as an open enquiry or a learner the caller may view; saving needs a confirm naming these (DD-10). */
export class SameMobile extends Error {
  override name = "SameMobile";
  constructor(readonly warnings: Warning[]) { super("same mobile"); }
}

const MANAGE = "enquiry.manage";
const VIEW = "enquiry.view";
const SETUP = "enquiry.setup";
const ID = /^\d{1,18}$/;

// ---------- Field validation (mirrored by the 0018 checks) ----------

function phone(field: string, v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") throw invalid(field, "invalid");
  if (v.trim() === "") return null;
  return phoneDigits(field, v);
}
const required = (field: string, v: string | null) => { if (v == null) throw invalid(field, "required"); return v; };
const intId = (field: string, v: unknown) => { if (!Number.isSafeInteger(v) || (v as number) < 1) throw invalid(field, "inactive or unknown"); return v as number; };

type Col = { key: keyof EnquiryChanges; column: string; cast?: string; check: (v: unknown) => string | number | null };
/** The editable columns in one place: key, column, cast and rule (DD-14 audits the keys). */
const COLUMNS: Col[] = [
  { key: "givenName", column: "given_name", check: (v) => identityField("givenName", v) },
  { key: "familyName", column: "family_name", check: (v) => identityField("familyName", v) },
  { key: "dateOfBirth", column: "date_of_birth", cast: "date", check: (v) => required("dateOfBirth", identityField("dateOfBirth", v === "" ? null : v)) },
  { key: "gender", column: "gender", cast: 'app."Gender"', check: (v) => required("gender", identityField("gender", v === "" ? null : v)) },
  { key: "mobile", column: "mobile", check: (v) => required("mobile", v === "" ? null : identityField("mobile", v)) },
  { key: "email", column: "email", check: (v) => identityField("email", v) },
  { key: "currentAddress", column: "current_address", check: (v) => detailField("currentAddress", v) },
  { key: "currentPincode", column: "current_pincode", check: (v) => detailField("currentPincode", v) },
  { key: "qualification", column: "qualification", check: (v) => detailField("qualification", v) },
  { key: "guardianName", column: "guardian_name", check: (v) => detailField("guardianName", v) },
  { key: "guardianPhone", column: "guardian_phone", check: (v) => detailField("guardianPhone", v) },
  { key: "whatsapp", column: "whatsapp", check: (v) => phone("whatsapp", v) },
  { key: "landline", column: "landline", check: (v) => phone("landline", v) },
  { key: "instagram", column: "instagram", check: (v) => ownText("instagram", v, 100) },
  { key: "lastSchool", column: "last_school", check: (v) => ownText("lastSchool", v, 100) },
  { key: "remark", column: "remark", check: (v) => ownText("remark", v, 1000, true) },
  { key: "pathId", column: "path_id", check: (v) => intId("pathId", v) },
  { key: "typeId", column: "type_id", check: (v) => intId("typeId", v) },
];
const COURSE_COLUMNS = ["course_code_1", "course_code_2", "course_code_3"] as const;

function courseCodes(v: unknown): [string, string | null, string | null] {
  if (!Array.isArray(v)) throw invalid("courseCodes", "1-3");
  const codes = v.map((c) => normCode(c)).filter((c) => c !== "");
  if (codes.length < 1 || codes.length > 3) throw invalid("courseCodes", "1-3");
  if (new Set(codes).size !== codes.length) throw invalid("courseCodes", "distinct");
  return [codes[0]!, codes[1] ?? null, codes[2] ?? null];
}
/** Validates the given keys (absent = unchanged); returns column -> stored value. */
function validate(input: Record<string, unknown>, all: boolean): Map<string, string | number | null> {
  const out = new Map<string, string | number | null>();
  for (const c of COLUMNS) {
    if (!all && (!Object.hasOwn(input, c.key) || input[c.key] === undefined)) continue;
    out.set(c.column, c.check(input[c.key]));
  }
  if (all || (Object.hasOwn(input, "courseCodes") && input["courseCodes"] !== undefined)) {
    courseCodes(input["courseCodes"]).forEach((code, i) => out.set(COURSE_COLUMNS[i]!, code));
  }
  return out;
}
const keyOf = (column: string) => COLUMNS.find((c) => c.column === column)?.key ?? (column.startsWith("course_code_") ? "courseCodes" : column);
const castOf = (column: string) => COLUMNS.find((c) => c.column === column)?.cast;
const valueSql = (column: string, v: string | number | null) => {
  const cast = castOf(column);
  return cast ? Prisma.sql`${v}::${Prisma.raw(cast)}` : Prisma.sql`${v}`;
};

/** Ids from a form or a list: 1-18 digits, deduplicated (R11). */
function idList(ids: unknown): string[] {
  if (!Array.isArray(ids)) throw invalid("ids", "1-100");
  const list = [...new Set(ids.map(String))];
  if (list.length < 1 || list.length > 100) throw invalid("ids", "1-100");
  if (!list.every((i) => ID.test(i))) throw invalid("ids", "one centre");
  return list;
}
const oneId = (id: unknown) => { if (typeof id !== "string" || !ID.test(id)) throw new PersonError("notfound"); return id; };
const centreOf = (v: unknown) => { if (!Number.isSafeInteger(v)) throw new PersonError("notfound"); return v as number; };

// A check the app's own validation should have caught becomes a field error; a guard refusal (P0001) is a bug.
async function enquiryDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const cause = (e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } }).meta?.driverAdapterError?.cause;
    const code = cause?.originalCode;
    const constraint = /constraint "([^"]+)"/.exec(cause?.originalMessage ?? "")?.[1];
    const column = code === "23514" ? /^enquiry_(\w+)_check$/.exec(constraint ?? "")?.[1] : undefined;
    if (column === "courses") throw invalid("courseCodes", "distinct");
    if (column) throw invalid(keyOf(column), "invalid");
    if (code === "23503") throw invalid("reference", "inactive or unknown");
    if (code === "42501") throw new Forbidden(cause?.originalMessage ?? "forbidden");
    throw e;
  }
}

// ---------- Locks and references (inside the action) ----------

type Locked = { id: string; admissionId: string | null; kind: StatusKind; version: number };
/** The ordered lock every write takes first (D1): serialises with admit() and with overlapping bulk writes. */
async function lockEnquiries(tx: Tx, centreId: number, ids: string[]): Promise<Locked[]> {
  const rows = await tx.$queryRaw<Locked[]>`select e.id::text, e.admission_id::text as "admissionId", s.kind, e.version
    from app.enquiry e join app.enquiry_status s on s.id = e.status_id
    where e.id = any (${ids}::bigint[]) and e.centre_id = ${centreId} order by e.id for no key update of e`;
  if (rows.length !== ids.length) throw ids.length === 1 ? new PersonError("notfound") : invalid("ids", "one centre");
  if (rows.some((r) => r.admissionId)) throw invalid("enquiry", "enrolled"); // DD-15
  return rows;
}
// plain reads, no "for share": the masters' update policy would hide rows from enquiry writers (Z9)
async function liveMaster(tx: Tx, table: "enquiry_path" | "enquiry_type", field: string, id: number) {
  const [r] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from ${Prisma.raw(`app.${table}`)} where id = ${id} and active`;
  if (!r) throw invalid(field, "inactive or unknown");
}
async function liveCourses(tx: Tx, codes: string[]) {
  if (codes.length === 0) return;
  const live = new Set((await tx.$queryRaw<{ code: string }[]>`select code from app.course
    where code = any (${codes}::text[]) and active and visible`).map((r) => r.code));
  const i = codes.findIndex((c) => !live.has(c));
  if (i >= 0) throw invalid(`courseCodes[${i}]`, "no such course");
}

// ---------- Writes ----------

export async function createEnquiry(session: string | undefined, input: EnquiryInput, confirm: string[] = []): Promise<{ id: string }> {
  const centreId = centreOf(input.centreId);
  const cols = validate(input as unknown as Record<string, unknown>, true);
  const enquiredOn = input.enquiredOn == null || input.enquiredOn === "" ? istToday() : isoDate("enquiredOn", input.enquiredOn);
  if (enquiredOn > istToday()) throw invalid("enquiredOn", "not in the future");
  const statusId = input.statusId == null ? null : intId("statusId", input.statusId);
  if (!Array.isArray(confirm) || confirm.some((c) => typeof c !== "string")) throw invalid("confirm", "invalid");
  // pre-flight (I1, I2): every create counts against the search limit, and the id is known before the audit row
  const id = await withScope(session, async (tx) => {
    await limitSearch(tx);
    return (await tx.$queryRaw<{ id: string }[]>`select nextval('app.enquiry_id_seq')::text as id`)[0]!.id;
  });
  let matches: Warning[] = [];
  return scopedAction(session, { action: "enquiry.create", permission: "enquiry.manage", centreId, targetType: "enquiry", targetId: id },
    (tx) => enquiryDb(async () => {
      matches = [];
      const [st] = await tx.$queryRaw<{ s: string }[]>`select status::text as s from app.centre where id = ${centreId}`;
      if (st?.s !== "ACTIVE") throw invalid("centreId", "centre is not active"); // an inactive centre cannot trade (centre onboarding DD-3)
      await liveMaster(tx, "enquiry_path", "pathId", cols.get("path_id") as number);
      await liveMaster(tx, "enquiry_type", "typeId", cols.get("type_id") as number);
      await liveCourses(tx, COURSE_COLUMNS.map((c) => cols.get(c)).filter((c): c is string => typeof c === "string"));
      const [status] = statusId === null
        ? await tx.$queryRaw<{ id: number }[]>`select id from app.enquiry_status where kind = 'OPEN' and active order by sort_order, id limit 1`
        : await tx.$queryRaw<{ id: number; kind: string }[]>`select id, kind from app.enquiry_status where id = ${statusId} and active`;
      if (!status) throw invalid("statusId", "inactive or unknown");
      if ("kind" in status && status.kind !== "OPEN") throw invalid("statusId", "open statuses only"); // DD-15
      // the same mobile (DD-10): open enquiries at this centre, learners admitted where the caller may view them
      const mobile = cols.get("mobile") as string;
      const enquiries = await tx.$queryRaw<{ id: string; givenName: string; familyName: string | null }[]>`
        select e.id::text, e.given_name as "givenName", e.family_name as "familyName" from app.enquiry e
          join app.enquiry_status s on s.id = e.status_id
        where e.centre_id = ${centreId} and e.mobile = ${mobile} and s.kind = 'OPEN' order by e.id`;
      const learners = await tx.$queryRaw<{ personId: string; givenName: string; familyName: string | null }[]>`
        select distinct p.id::text as "personId", p.given_name as "givenName", p.family_name as "familyName"
        from app.person p join app.admission a on a.person_id = p.id
        where p.mobile = ${mobile} and a.centre_id = any (app.scoped_centre_ids('student.view'))`;
      matches = [...enquiries.map((m) => ({ kind: "enquiry" as const, ...m })), ...learners.map((m) => ({ kind: "learner" as const, ...m }))];
      const unseen = matches.filter((m) => !confirm.includes(m.kind === "enquiry" ? m.id : m.personId));
      if (unseen.length > 0) throw new SameMobile(matches);
      const names = [...cols.keys()];
      await tx.$executeRaw`insert into app.enquiry (id, centre_id, status_id, enquired_on, ${Prisma.join(names.map((n) => Prisma.raw(n)))})
        values (${id}::bigint, ${centreId}, ${status.id}, ${enquiredOn}::date, ${Prisma.join(names.map((n) => valueSql(n, cols.get(n)!)))})`;
      return { id };
    }),
    () => ({ fields: [...new Set([...cols].filter(([, v]) => v != null).map(([c]) => keyOf(c)))] }),
    (e) => e instanceof SameMobile ? { action: "enquiry.create", extra: { reason: "duplicate", // ids only (D3)
      enquiries: e.warnings.flatMap((w) => (w.kind === "enquiry" ? [w.id] : [])),
      persons: e.warnings.flatMap((w) => (w.kind === "learner" ? [w.personId] : [])) } } : null);
}

// qualified: the detail read joins app.centre, which has its own email, phone and address (0020)
const SELECT_COLUMNS = Prisma.raw(COLUMNS.map((c) => `e.${c.column}${c.cast ? "::text" : ""} as ${c.column}`).join(", ")
  + ", e.course_code_1, e.course_code_2, e.course_code_3");

export async function updateEnquiry(session: string | undefined, centreId: number, id: string, version: number, changes: EnquiryChanges)
  : Promise<{ version: number; changed: string[] }> {
  const c = centreOf(centreId), i = oneId(id);
  if (!Number.isSafeInteger(version)) throw invalid("enquiry", "changed since you opened it; reload the page");
  const cols = validate(changes as Record<string, unknown>, false);
  let changed: string[] = [];
  return scopedAction(session, { action: "enquiry.update", permission: "enquiry.manage", centreId: c, targetType: "enquiry", targetId: i },
    (tx) => enquiryDb(async () => {
      const [row] = await lockEnquiries(tx, c, [i]);
      if (row!.version !== version) throw invalid("enquiry", "changed since you opened it; reload the page"); // DD-12
      const [cur] = await tx.$queryRaw<Record<string, string | number | null>[]>`select ${SELECT_COLUMNS} from app.enquiry e where e.id = ${i}::bigint`;
      const diff = [...cols].filter(([col, v]) => String(cur![col] ?? "") !== String(v ?? ""));
      if (diff.length === 0) throw invalid("enquiry", "nothing to change");
      // a new or changed reference must be active; an unchanged one is kept (C18, I9, R14)
      for (const [col, v] of diff) {
        if (col === "path_id") await liveMaster(tx, "enquiry_path", "pathId", v as number);
        if (col === "type_id") await liveMaster(tx, "enquiry_type", "typeId", v as number);
      }
      const stored = COURSE_COLUMNS.map((k) => cur![k]);
      await liveCourses(tx, diff.filter(([col]) => col.startsWith("course_code_")).map(([, v]) => v)
        .filter((v): v is string => typeof v === "string" && !stored.includes(v)));
      await tx.$executeRaw`update app.enquiry set ${Prisma.join(diff.map(([col, v]) => Prisma.sql`${Prisma.raw(col)} = ${valueSql(col, v)}`))},
        version = version + 1 where id = ${i}::bigint`;
      changed = [...new Set(diff.map(([col]) => keyOf(col)))];
      return { version: version + 1, changed };
    }), () => ({ fields: changed }));
}

export async function setEnquiryStatus(session: string | undefined, centreId: number, ids: string[], statusId: number, note: string | null)
  : Promise<{ count: number }> {
  const c = centreOf(centreId), list = idList(ids), s = intId("statusId", statusId);
  const text = ownText("note", note, 2000, true);
  return scopedAction(session, { action: "enquiry.status", permission: "enquiry.manage", centreId: c, targetType: "enquiry", ...(list.length === 1 ? { targetId: list[0]! } : {}) },
    (tx) => enquiryDb(async () => {
      const rows = await lockEnquiries(tx, c, list);
      const [target] = await tx.$queryRaw<{ kind: StatusKind }[]>`select kind from app.enquiry_status where id = ${s} and active`;
      if (!target) throw invalid("statusId", "inactive or unknown");
      if (target.kind === "ENROLLED") throw invalid("statusId", "not by hand"); // only Enroll (DD-6)
      const closing = target.kind === "LOST" || target.kind === "JUNK";
      const reopening = target.kind === "OPEN" && rows.some((r) => r.kind === "LOST" || r.kind === "JUNK");
      if ((closing || reopening) && !text) throw invalid("note", "required"); // DD-15
      await tx.$executeRaw`update app.enquiry set status_id = ${s},
        next_follow_up_on = case when ${closing} then null else next_follow_up_on end where id = any (${list}::bigint[])`;
      if (text) {
        await tx.$executeRaw`insert into app.enquiry_followup (enquiry_id, centre_id, kind, note)
          select unnest(${list}::bigint[]), ${c}, 'NOTE', ${text}`;
      }
      return { count: list.length };
    }), () => ({ ids: list, fields: text ? ["statusId", "note"] : ["statusId"] }));
}

export async function setCounsellor(session: string | undefined, centreId: number, ids: string[], userId: string | null)
  : Promise<{ count: number }> {
  const c = centreOf(centreId), list = idList(ids);
  if (userId !== null && (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId))) throw invalid("userId", "cannot receive enquiries here");
  return scopedAction(session, { action: "enquiry.counsellor", permission: "enquiry.manage", centreId: c, targetType: "enquiry", ...(list.length === 1 ? { targetId: list[0]! } : {}) },
    (tx) => enquiryDb(async () => {
      await lockEnquiries(tx, c, list);
      if (userId !== null) {
        const [r] = await tx.$queryRaw<{ ok: boolean }[]>`select app.enquiry_may_receive(${c}, ${userId}::uuid) as ok`;
        if (!r?.ok) throw invalid("userId", "cannot receive enquiries here");
      }
      await tx.$executeRaw`update app.enquiry set counsellor_id = ${userId}::uuid where id = any (${list}::bigint[])`;
      return { count: list.length };
    }), () => ({ ids: list, fields: ["counsellorId"] }));
}

export async function addFollowUp(session: string | undefined, centreId: number, id: string,
  f: { kind: string; durationMin?: number | null; note: string; nextOn?: string | null }): Promise<{ id: string }> {
  const c = centreOf(centreId), i = oneId(id);
  if (typeof f?.kind !== "string" || !Object.hasOwn(FOLLOW_UP_KINDS, f.kind)) throw invalid("kind", "one of the listed values");
  const duration = f.durationMin == null ? null : f.durationMin;
  if (duration !== null && (!Number.isSafeInteger(duration) || duration < 0 || duration > 600)) throw invalid("durationMin", "0-600");
  const note = ownText("note", f.note, 2000, true);
  if (!note) throw invalid("note", "1-2000 characters");
  const setNext = Object.hasOwn(f, "nextOn") && f.nextOn !== undefined; // absent keeps the date; null clears it (D11)
  const nextOn = setNext && f.nextOn !== null && f.nextOn !== "" ? isoDate("nextOn", f.nextOn) : null;
  if (nextOn && nextOn < istToday()) throw invalid("nextOn", "not in the past");
  const contact = f.kind !== "NOTE";
  return scopedAction(session, { action: "enquiry.followup", permission: "enquiry.manage", centreId: c, targetType: "enquiry", targetId: i },
    (tx) => enquiryDb(async () => {
      await lockEnquiries(tx, c, [i]);
      const [row] = await tx.$queryRaw<{ id: string; at: Date }[]>`insert into app.enquiry_followup (enquiry_id, centre_id, kind, duration_min, note, next_on)
        values (${i}::bigint, ${c}, ${f.kind}, ${duration}::int, ${note}, ${nextOn}::date) returning id::text, at`;
      await tx.$executeRaw`update app.enquiry set
        last_contact_at = case when ${contact} then ${row!.at}::timestamptz else last_contact_at end,
        next_follow_up_on = case when ${setNext} then ${nextOn}::date else next_follow_up_on end
        where id = ${i}::bigint`;
      return { id: row!.id };
    }), () => ({ fields: ["kind", "note", ...(duration !== null ? ["durationMin"] : []), ...(setNext ? ["nextOn"] : [])] }));
}

// ---------- Reads ----------

async function requireView(tx: Tx) {
  const [r] = await tx.$queryRaw<{ n: number }[]>`select cardinality(app.scoped_centre_ids('enquiry.view'))::int as n`;
  if (!r?.n) throw new Forbidden("enquiry.view denied", VIEW);
}
async function names(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ id: string; displayName: string }[]>`
    select id::text, display_name as "displayName" from app.enquiry_people(${ids}::bigint[])`;
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

export type EnquiryRow = { id: string; enquiredOn: string; givenName: string; familyName: string | null; statusName: string;
  statusColour: string; kind: StatusKind; counsellorName: string | null; nextFollowUpOn: string | null; centreCode: string };
export type EnquiryFilter = { centreId?: string; statusId?: string; kind?: string; counsellorId?: string; from?: string; to?: string; due?: string; q?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Enquiries at centres in the caller's enquiry.view scope, newest first, at most 100. q comes only from a POST body (Z5). */
export async function listEnquiries(session: string | undefined, f: EnquiryFilter = {}): Promise<EnquiryRow[]> {
  const q = (f.q ?? "").trim();
  return withScope(session, async (tx) => {
    await requireView(tx);
    // an invalid filter matches nothing, it never raises (C13)
    const bad = (f.centreId && !/^\d+$/.test(f.centreId)) || (f.statusId && !/^\d+$/.test(f.statusId))
      || (f.kind && !(STATUS_KINDS as readonly string[]).includes(f.kind)) || (f.counsellorId && !/^[0-9a-f-]{36}$/i.test(f.counsellorId))
      || [f.from, f.to, f.due].some((d) => d && (!DATE.test(d) || Number.isNaN(Date.parse(d))));
    if (bad) return [];
    if (q) await limitSearch(tx);
    let mobile: string | null = null;
    if (q) try { mobile = identityField("mobile", q); } catch { /* not a mobile number */ }
    const like = q.replace(/[\\%_]/g, "\\$&") + "%";
    const rows = await tx.$queryRaw<(EnquiryRow & { counsellorId: string | null })[]>`
      select e.id::text, e.enquired_on::text as "enquiredOn", e.given_name as "givenName", e.family_name as "familyName",
             s.name as "statusName", s.colour as "statusColour", s.kind, e.counsellor_id::text as "counsellorId",
             e.next_follow_up_on::text as "nextFollowUpOn", c.code as "centreCode"
      from app.enquiry e join app.enquiry_status s on s.id = e.status_id join app.centre c on c.id = e.centre_id
      where true
        ${f.centreId ? Prisma.sql`and e.centre_id = ${Number(f.centreId)}` : Prisma.empty}
        ${f.statusId ? Prisma.sql`and e.status_id = ${Number(f.statusId)}` : Prisma.empty}
        ${f.kind ? Prisma.sql`and s.kind = ${f.kind}` : Prisma.empty}
        ${f.counsellorId ? Prisma.sql`and e.counsellor_id = ${f.counsellorId}::uuid` : Prisma.empty}
        ${f.from ? Prisma.sql`and e.enquired_on >= ${f.from}::date` : Prisma.empty}
        ${f.to ? Prisma.sql`and e.enquired_on <= ${f.to}::date` : Prisma.empty}
        ${f.due ? Prisma.sql`and e.next_follow_up_on <= ${f.due}::date` : Prisma.empty}
        ${q ? Prisma.sql`and (${ID.test(q) ? Prisma.sql`e.id = ${q}::bigint or` : Prisma.empty}
          ${mobile ? Prisma.sql`e.mobile = ${mobile} or` : Prisma.empty}
          e.given_name ilike ${like} or e.family_name ilike ${like})` : Prisma.empty}
      order by e.id desc limit 100`;
    const who = await names(tx, rows.map((r) => r.id));
    return rows.map(({ counsellorId, ...r }) => ({ ...r, counsellorName: counsellorId ? who.get(counsellorId) ?? null : null }));
  });
}

export type FollowUpRow = { id: string; at: string; kind: string; durationMin: number | null; note: string; nextOn: string | null; byName: string | null };

/** One enquiry; not found and not allowed are the same answer (404 parity). */
export async function getEnquiry(session: string | undefined, id: string) {
  const i = oneId(id);
  return withScope(session, async (tx) => {
    const [e] = await tx.$queryRaw<Record<string, unknown>[]>`
      select e.id::text, e.centre_id as "centreId", c.code as "centreCode", c.name as "centreName", ${SELECT_COLUMNS},
             e.status_id as "statusId", s.name as "statusName", s.kind, s.colour as "statusColour",
             e.counsellor_id::text as "counsellorId", e.enquired_on::text as "enquiredOn",
             e.next_follow_up_on::text as "nextFollowUpOn", e.last_contact_at::text as "lastContactAt",
             e.admission_id::text as "admissionId", a.admission_no as "admissionNo", e.version
      from app.enquiry e join app.enquiry_status s on s.id = e.status_id join app.centre c on c.id = e.centre_id
        left join app.admission a on a.id = e.admission_id
      where e.id = ${i}::bigint`;
    if (!e) throw new PersonError("notfound");
    const followUps = await tx.$queryRaw<(FollowUpRow & { byUser: string })[]>`
      select id::text, at::text, kind, duration_min as "durationMin", note, next_on::text as "nextOn", by_user::text as "byUser"
      from app.enquiry_followup where enquiry_id = ${i}::bigint order by at desc, id desc`;
    const who = await names(tx, [i]);
    const [p] = await tx.$queryRaw<{ manage: boolean; admit: boolean }[]>`
      select app.has_permission('enquiry.manage', ${e["centreId"] as number}) as manage,
             app.has_permission('student.admit', ${e["centreId"] as number}) as admit`;
    const record = Object.fromEntries(Object.entries(e).map(([k, v]) => [COLUMNS.find((c) => c.column === k)?.key ?? k, v]));
    const counsellorId = e["counsellorId"] as string | null;
    return {
      enquiry: { ...record, courseCodes: COURSE_COLUMNS.map((k) => e[k]).filter((v): v is string => typeof v === "string"),
        counsellorName: counsellorId ? who.get(counsellorId) ?? null : null } as unknown as Record<string, unknown> & {
        id: string; centreId: number; kind: StatusKind; version: number; admissionId: string | null; courseCodes: string[] },
      followUps: followUps.map(({ byUser, ...r }) => ({ ...r, byName: who.get(byUser) ?? null })),
      canManage: p!.manage,
      canEnrol: p!.manage && p!.admit && !e["admissionId"] && e["kind"] === "OPEN", // Z11, DD-15
    };
  });
}

/** Open enquiries due in a month, by day, at most 1000 (C19). */
export async function followUpCalendar(session: string | undefined, month: string, centreId?: number) {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new PersonError("notfound");
  return withScope(session, async (tx) => {
    await requireView(tx);
    const rows = await tx.$queryRaw<{ id: string; day: string; givenName: string; familyName: string | null; statusName: string; counsellorId: string | null }[]>`
      select e.id::text, e.next_follow_up_on::text as day, e.given_name as "givenName", e.family_name as "familyName",
             s.name as "statusName", e.counsellor_id::text as "counsellorId"
      from app.enquiry e join app.enquiry_status s on s.id = e.status_id
      where s.kind = 'OPEN' and e.next_follow_up_on >= ${`${month}-01`}::date
        and e.next_follow_up_on < (${`${month}-01`}::date + interval '1 month')
        ${Number.isSafeInteger(centreId) ? Prisma.sql`and e.centre_id = ${centreId}` : Prisma.empty}
      order by e.next_follow_up_on, e.id limit 1000`;
    const who = await names(tx, rows.map((r) => r.id));
    const days = new Map<string, { id: string; givenName: string; familyName: string | null; statusName: string; counsellorName: string | null }[]>();
    for (const { day, counsellorId, ...r } of rows) {
      if (!days.has(day)) days.set(day, []);
      days.get(day)!.push({ ...r, counsellorName: counsellorId ? who.get(counsellorId) ?? null : null });
    }
    return [...days].map(([day, list]) => ({ day, rows: list }));
  });
}

/** For the home link. */
export const canViewEnquiries = (session: string | undefined) => withScope(session, async (tx) =>
  (await tx.$queryRaw<{ n: number }[]>`select cardinality(app.scoped_centre_ids('enquiry.view'))::int as n`)[0]!.n > 0);

/** The pickers of the enquiry forms: centres the caller may manage enquiries at, active masters and offered courses. */
export async function enquiryOptions(session: string | undefined) {
  return withScope(session, async (tx) => {
    await requireView(tx);
    return {
      // active: only active centres take new enquiries (centre onboarding R3); manage alone keeps bulk actions on old ones
      centres: await tx.$queryRaw<{ id: number; code: string; name: string; manage: boolean; active: boolean }[]>`
        select c.id, c.code, c.name, c.id = any (app.scoped_centre_ids('enquiry.manage')) as manage, c.status = 'ACTIVE' as active
        from app.centre c
        where c.id = any (app.scoped_centre_ids('enquiry.view')) order by c.code`,
      paths: await tx.$queryRaw<{ id: number; name: string }[]>`select id, name from app.enquiry_path where active order by name`,
      types: await tx.$queryRaw<{ id: number; name: string }[]>`select id, name from app.enquiry_type where active order by name`,
      statuses: await tx.$queryRaw<{ id: number; name: string; kind: StatusKind; colour: string }[]>`
        select id, name, kind, colour from app.enquiry_status where active order by sort_order, id`,
      courses: await tx.$queryRaw<{ code: string; name: string }[]>`select code, name from app.course where active and visible order by code`,
      canSetup: (await tx.$queryRaw<{ ok: boolean }[]>`select app.has_permission('enquiry.setup', null) as ok`)[0]!.ok,
    };
  });
}

/** Counsellors who may receive enquiries at a centre (an empty list for callers who may not view it). */
export const enquiryCounsellors = (session: string | undefined, centreId: number) => withScope(session, (tx) =>
  tx.$queryRaw<{ id: string; displayName: string }[]>`select id::text, display_name as "displayName"
    from app.enquiry_counsellors(${Number.isSafeInteger(centreId) ? centreId : 0})`);

// ---------- Status master (DD-4, DD-6; enquiry.setup at ALL scope, step-up, audited) ----------

export type StatusRow = { id: number; code: string; name: string; kind: StatusKind; colour: string; sortOrder: number; active: boolean };
const bad = (message: string) => new RbacError("invalid", message);
const keep = () => new RbacError("invalid", "active: last of its kind", "enquiry.setup.keep");
const STATUS_COLS = Prisma.sql`id, code, name, kind, colour, sort_order as "sortOrder", active`;

function statusFields(u: { name?: unknown; colour?: unknown; sortOrder?: unknown }) {
  const out: { name?: string; colour?: string; sortOrder?: number } = {};
  if (u.name !== undefined) {
    const n = typeof u.name === "string" ? u.name.trim() : "";
    if (n.length < 1 || n.length > 200) throw bad("name: 1-200 characters");
    out.name = n;
  }
  if (u.colour !== undefined) {
    const c = typeof u.colour === "string" ? u.colour.trim().toLowerCase() : "";
    if (!/^#[0-9a-f]{6}$/.test(c)) throw bad("colour: #rrggbb");
    out.colour = c;
  }
  if (u.sortOrder !== undefined) {
    if (!Number.isSafeInteger(u.sortOrder) || (u.sortOrder as number) < 0 || (u.sortOrder as number) > 1000) throw bad("sortOrder: 0-1000");
    out.sortOrder = u.sortOrder as number;
  }
  return out;
}

/** Statuses for the setup page: holders of enquiry.view somewhere or of enquiry.setup (R15). */
export async function listEnquiryStatuses(session: string | undefined) {
  return withScope(session, async (tx) => {
    const [p] = await tx.$queryRaw<{ setup: boolean; view: number }[]>`select app.has_permission('enquiry.setup', null) as setup,
      cardinality(app.scoped_centre_ids('enquiry.view'))::int as view`;
    if (!p!.setup && !p!.view) throw new Forbidden("enquiry.view denied", VIEW);
    return { rows: await tx.$queryRaw<StatusRow[]>`select ${STATUS_COLS} from app.enquiry_status order by sort_order, id`, canManage: p!.setup };
  });
}

export async function createEnquiryStatus(session: string | undefined, s: { code: string; name: string; kind: string; colour: string; sortOrder: number }) {
  const code = normCode(s.code);
  if (code === "") throw bad("code: required");
  if (!CODE_RULE.test(code) || code.length > 30) throw bad("code: printable ASCII, single spaces, at most 30");
  if (s.kind !== "OPEN" && s.kind !== "LOST" && s.kind !== "JUNK") throw bad("kind: one of OPEN, LOST, JUNK"); // never a second ENROLLED
  const f = statusFields({ name: s.name, colour: s.colour, sortOrder: s.sortOrder }) as { name: string; colour: string; sortOrder: number };
  return unique(() => adminWrite(session, { action: "enquiry.setup.status.create", permission: SETUP, targetType: "enquiry_status" },
    async (tx) => (await tx.$queryRaw<StatusRow[]>`insert into app.enquiry_status (code, name, kind, colour, sort_order)
      values (${code}, ${f.name}, ${s.kind}, ${f.colour}, ${f.sortOrder}) returning ${STATUS_COLS}`)[0]!,
    (r) => ({ after: r }))).then((r) => ({ id: r.id }));
}

async function lockStatus(tx: Tx, id: number): Promise<StatusRow> {
  const [r] = await tx.$queryRaw<StatusRow[]>`select ${STATUS_COLS} from app.enquiry_status where id = ${id} for update`;
  if (!r) throw new RbacError("notfound", "status not found");
  return r;
}

export async function updateEnquiryStatus(session: string | undefined, id: number, u: { name?: string; colour?: string; sortOrder?: number }) {
  if (!Number.isSafeInteger(id)) throw bad("id: invalid");
  const f = statusFields(u);
  return adminWrite(session, { action: "enquiry.setup.status.update", permission: SETUP, targetType: "enquiry_status", targetId: String(id) },
    async (tx) => {
      const before = await lockStatus(tx, id);
      const after = { ...before, ...f };
      if (after.name === before.name && after.colour === before.colour && after.sortOrder === before.sortOrder) throw bad("nothing to change");
      await tx.$executeRaw`update app.enquiry_status set name = ${after.name}, colour = ${after.colour}, sort_order = ${after.sortOrder} where id = ${id}`;
      return { before, after };
    }, (r) => r).then(() => undefined);
}

// Two calls with literal actions, so the audit catalogue gate can read both names (as setMasterActive).
export async function setEnquiryStatusActive(session: string | undefined, id: number, active: boolean, reason: string) {
  if (!Number.isSafeInteger(id)) throw bad("id: invalid");
  if (typeof active !== "boolean") throw bad("active: invalid");
  const r = typeof reason === "string" ? reason.trim() : "";
  if (!r) throw bad("reason: required");
  const run = async (tx: Tx) => {
    // the whole kind, in id order, so two managers cannot each switch off "the other" last one (R4)
    const kindRows = await tx.$queryRaw<StatusRow[]>`select ${STATUS_COLS} from app.enquiry_status
      where kind = (select kind from app.enquiry_status where id = ${id}) order by id for update`;
    const row = kindRows.find((k) => k.id === id);
    if (!row) throw new RbacError("notfound", "status not found");
    if (row.active === active) throw bad(`already ${active ? "active" : "inactive"}`);
    if (!active && (row.kind === "ENROLLED" || !kindRows.some((k) => k.id !== id && k.active))) throw keep(); // D18, I11
    await tx.$executeRaw`update app.enquiry_status set active = ${active} where id = ${id}`;
    return { before: { active: row.active }, after: { active } };
  };
  return (active
    ? adminWrite(session, { action: "enquiry.setup.status.activate", permission: SETUP, targetType: "enquiry_status", targetId: String(id), reason: r }, run, (x) => x)
    : adminWrite(session, { action: "enquiry.setup.status.deactivate", permission: SETUP, targetType: "enquiry_status", targetId: String(id), reason: r }, run, (x) => x)
  ).then(() => undefined);
}
