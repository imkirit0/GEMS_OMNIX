// Fee schemes (docs/designs/fee-schemes, Stage 4 F5, WF5, D-SCH-1): a dated discount with rules per fee type (PERCENT, or
// AMOUNT as a total per fee type) for listed courses and, optionally, centres. scheme.manage drafts it; another holder of
// scheme.approve makes it LIVE, after which it never changes and can only be RETIRED. Both permissions are sensitive (step-up,
// adminWrite); the database checks the permission, the step-up and the persons on every transition (fee_scheme_guard, 0032).
import { withScope, type Tx } from "./db";
import { bad, code, date, name, reasonOf } from "./catalogue";
import { adminWrite, RbacError, StepUpRequired } from "./rbac";

const MANAGE = "scheme.manage", APPROVE = "scheme.approve";
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const MAX_TARGETS = 500;

const idOf = (field: string, v: unknown) => { if (!Number.isSafeInteger(v) || (v as number) < 1) throw bad(`${field}: inactive or unknown`); return v as number; };

// Database refusals by name (the driver drops error.constraint, so it is read from the message), inside adminWrite before its
// db() turns every 23514 into "invalid value" (Z8-2, R4)
const GUARD_KEY: Record<string, [string, string]> = {
  fee_scheme_guard: ["fee.scheme.locked", "this scheme is live or retired and cannot change"],
  fee_scheme_part_guard: ["fee.scheme.locked", "this scheme is live or retired and cannot change"],
  fee_scheme_self_guard: ["fee.scheme.self", "the maker or last editor of a scheme cannot approve it"],
  fee_scheme_incomplete_guard: ["fee.scheme.incomplete", "a scheme needs at least one rule and one course"],
  fee_scheme_expired_guard: ["fee.scheme.expired", "the scheme's validity has ended"],
};
async function schemeDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const cause = (e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } }).meta?.driverAdapterError?.cause;
    const constraint = /constraint "([^"]+)"/.exec(cause?.originalMessage ?? "")?.[1] ?? "";
    if (constraint === "fee_scheme_stepup_guard") throw new StepUpRequired("re-enter your password to continue");
    if (cause?.originalCode === "23514" && Object.hasOwn(GUARD_KEY, constraint)) {
      const [key, message] = GUARD_KEY[constraint]!;
      throw new RbacError("invalid", message, key);
    }
    if (cause?.originalCode === "23505") throw new RbacError("duplicate", "a scheme with that code already exists", "fee.duplicate");
    throw e;
  }
}
const can = async (tx: Tx) => (await tx.$queryRaw<{ manage: boolean; approve: boolean }[]>`
  select app.has_permission('scheme.manage', null) as manage, app.has_permission('scheme.approve', null) as approve`)[0]!;

export type SchemeRow = { id: number; code: string; name: string; validFrom: string; validTo: string; status: string;
  rules: number; courses: number; centres: number };

/** Live and retired schemes for everyone; drafts too for scheme holders (RLS, Z8-7). */
export const listSchemes = (session: string | undefined) => withScope(session, async (tx) => ({
  rows: await tx.$queryRaw<SchemeRow[]>`select s.id, s.code, s.name, s.valid_from::text as "validFrom", s.valid_to::text as "validTo", s.status,
      (select count(*) from app.fee_scheme_rule r where r.scheme_id = s.id)::int as rules,
      (select count(*) from app.fee_scheme_course c where c.scheme_id = s.id)::int as courses,
      (select count(*) from app.fee_scheme_centre c where c.scheme_id = s.id)::int as centres
    from app.fee_scheme s order by s.status = 'RETIRED', s.valid_from desc, s.code`,
  ...(await can(tx)),
}));

export type SchemeRule = { feeTypeId: number; feeTypeCode: string; feeTypeName: string; kind: string; value: string };
/** A scheme with its rules and targets, the pickers for editing, and who made, last edited, approved and retired it. */
export async function getScheme(session: string | undefined, id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new RbacError("notfound", "scheme not found");
  return withScope(session, async (tx) => {
    const [scheme] = await tx.$queryRaw<(SchemeRow & { createdBy: string; updatedBy: string; approvedBy: string | null; approvedAt: string | null;
      retiredBy: string | null; retiredAt: string | null; retiredReason: string | null })[]>`
      select s.id, s.code, s.name, s.valid_from::text as "validFrom", s.valid_to::text as "validTo", s.status, 0 as rules, 0 as courses, 0 as centres,
        coalesce(cu.display_name, s.created_by::text) as "createdBy", coalesce(uu.display_name, s.updated_by::text) as "updatedBy",
        coalesce(au.display_name, s.approved_by::text) as "approvedBy", to_char(s.approved_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "approvedAt",
        coalesce(ru.display_name, s.retired_by::text) as "retiredBy", to_char(s.retired_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "retiredAt",
        s.retired_reason as "retiredReason"
      from app.fee_scheme s left join app.app_user cu on cu.id = s.created_by left join app.app_user uu on uu.id = s.updated_by
        left join app.app_user au on au.id = s.approved_by left join app.app_user ru on ru.id = s.retired_by
      where s.id = ${id}`;
    if (!scheme) throw new RbacError("notfound", "scheme not found");
    const rules = await tx.$queryRaw<SchemeRule[]>`select r.fee_type_id as "feeTypeId", t.code as "feeTypeCode", t.name as "feeTypeName", r.kind,
        trim_scale(r.value)::text as value
      from app.fee_scheme_rule r join app.fee_type t on t.id = r.fee_type_id where r.scheme_id = ${id} order by t.sort_order, t.code`;
    const courses = await tx.$queryRaw<{ id: number; code: string; name: string }[]>`select c.id, c.code, c.name
      from app.fee_scheme_course x join app.course c on c.id = x.course_id where x.scheme_id = ${id} order by c.code`;
    const centres = await tx.$queryRaw<{ id: number; code: string; name: string }[]>`select c.id, c.code, c.name
      from app.fee_scheme_centre x join app.centre c on c.id = x.centre_id where x.scheme_id = ${id} order by c.code`;
    const options = {
      feeTypes: await tx.$queryRaw<{ id: number; code: string; name: string }[]>`select id, code, name from app.fee_type where active order by sort_order, code`,
      courses: await tx.$queryRaw<{ id: number; code: string; name: string }[]>`select id, code, name from app.course where active order by code`,
      centres: await tx.$queryRaw<{ id: number; code: string; name: string }[]>`select id, code, name from app.centre order by code`,
    };
    return { scheme, rules, courses, centres, options, ...(await can(tx)) };
  });
}

/** The validity: two dates, the end not before the start (fee_scheme_valid_check). */
function validity(from: unknown, to: unknown) {
  const f = date("validFrom", from), t = date("validTo", to);
  if (t < f) throw bad("validTo: not before validFrom");
  return { f, t };
}

/** Creates a DRAFT scheme with no rules or targets yet; the id first, so the audit names it. */
export async function createScheme(session: string | undefined, s: { code: string; name: string; validFrom: string; validTo: string }): Promise<{ id: number }> {
  const c = code(s?.code), n = name(s?.name), { f, t } = validity(s?.validFrom, s?.validTo);
  const id = await withScope(session, async (tx) => (await tx.$queryRaw<{ id: number }[]>`select nextval('app.fee_scheme_id_seq')::int as id`)[0]!.id);
  return adminWrite(session, { action: "fee.scheme.create", permission: MANAGE, targetType: "fee_scheme", targetId: String(id) }, (tx) => schemeDb(async () => {
    await tx.$executeRaw`insert into app.fee_scheme (id, code, name, valid_from, valid_to) values (${id}, ${c}, ${n}, ${f}::date, ${t}::date)`;
    return { id };
  }), () => ({ after: { code: c, name: n, validFrom: f, validTo: t } }));
}

/** The scheme row for update, or not found (a draft the caller cannot see is not found). */
async function locked(tx: Tx, id: number) {
  const [s] = await tx.$queryRaw<{ status: string; code: string; name: string; validFrom: string; validTo: string }[]>`
    select status, code, name, valid_from::text as "validFrom", valid_to::text as "validTo" from app.fee_scheme where id = ${id} for update`;
  if (!s) throw new RbacError("notfound", "scheme not found");
  return s;
}

/** Edits a draft's name or validity (the database stamps the editor, who then cannot approve it). */
export async function updateScheme(session: string | undefined, id: number, ch: Partial<{ name: string; validFrom: string; validTo: string }>): Promise<void> {
  const i = idOf("id", id);
  let before: Record<string, string> = {}, after: Record<string, string> = {};
  return adminWrite(session, { action: "fee.scheme.update", permission: MANAGE, targetType: "fee_scheme", targetId: String(i) }, (tx) => schemeDb(async () => {
    const cur = await locked(tx, i);
    const next = { name: ch?.name === undefined ? cur.name : name(ch.name), ...(() => { const v = validity(ch?.validFrom ?? cur.validFrom, ch?.validTo ?? cur.validTo); return { validFrom: v.f, validTo: v.t }; })() };
    const diff = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== cur[k]);
    if (diff.length === 0) throw bad("nothing to change");
    before = Object.fromEntries(diff.map((k) => [k, cur[k]])); after = Object.fromEntries(diff.map((k) => [k, next[k]]));
    await tx.$executeRaw`update app.fee_scheme set name = ${next.name}, valid_from = ${next.validFrom}::date, valid_to = ${next.validTo}::date where id = ${i}`;
  }), () => ({ before, after }));
}

/** Sets the rule for one fee type, or removes it (null). PERCENT 0.01-100 of each due; AMOUNT a total over the fee type's dues. */
export async function setSchemeRule(session: string | undefined, schemeId: number, r: { feeTypeId: number; kind: string; value: string } | { feeTypeId: number; kind?: undefined; value: null })
  : Promise<void> {
  const s = idOf("schemeId", schemeId), t = idOf("feeTypeId", r?.feeTypeId);
  const remove = r?.value === null;
  let kind = "", value = "";
  if (!remove) {
    kind = r.kind;
    if (kind !== "PERCENT" && kind !== "AMOUNT") throw bad("kind: percent or amount");
    value = typeof r.value === "string" ? r.value.trim() : "";
    if (kind === "PERCENT" ? !PERCENT.test(value) || Number(value) < 0.01 || Number(value) > 100 : !AMOUNT.test(value) || Number(value) <= 0)
      throw bad(kind === "PERCENT" ? "value: a percentage from 0.01 to 100" : "value: an amount above 0, up to 2 decimals");
  }
  let before: { kind: string; value: string } | null = null;
  return adminWrite(session, { action: "fee.scheme.rule", permission: MANAGE, targetType: "fee_scheme", targetId: String(s) }, (tx) => schemeDb(async () => {
    await locked(tx, s);
    const [cur] = await tx.$queryRaw<{ kind: string; value: string }[]>`select kind, trim_scale(value)::text as value from app.fee_scheme_rule
      where scheme_id = ${s} and fee_type_id = ${t}`;
    before = cur ?? null;
    if (remove) {
      if (!cur) throw bad("nothing to change");
      await tx.$executeRaw`delete from app.fee_scheme_rule where scheme_id = ${s} and fee_type_id = ${t}`;
      return;
    }
    const [ft] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from app.fee_type where id = ${t} and active`;
    if (!ft) throw bad("feeTypeId: inactive or unknown");
    await tx.$executeRaw`insert into app.fee_scheme_rule (scheme_id, fee_type_id, kind, value) values (${s}, ${t}, ${kind}, ${value}::numeric(14,2))
      on conflict (scheme_id, fee_type_id) do update set kind = excluded.kind, value = excluded.value`;
  }), () => ({ before: { feeTypeId: t, rule: before }, after: { feeTypeId: t, rule: remove ? null : { kind, value } } }));
}

const idList = (field: string, v: unknown) => {
  if (!Array.isArray(v) || v.length > MAX_TARGETS) throw bad(`${field}: a list`);
  return [...new Set(v.map((x) => idOf(field, x)))].sort((a, b) => a - b);
};

/** Replaces the scheme's courses (at least one is needed to approve). */
export async function setSchemeCourses(session: string | undefined, schemeId: number, courseIds: number[]): Promise<void> {
  const s = idOf("schemeId", schemeId), ids = idList("courseIds", courseIds);
  let before: number[] = [];
  return adminWrite(session, { action: "fee.scheme.courses", permission: MANAGE, targetType: "fee_scheme", targetId: String(s) }, (tx) => schemeDb(async () => {
    await locked(tx, s);
    before = (await tx.$queryRaw<{ id: number }[]>`select course_id as id from app.fee_scheme_course where scheme_id = ${s} order by 1`).map((x) => x.id);
    if (before.join() === ids.join()) throw bad("nothing to change");
    const [ok] = await tx.$queryRaw<{ n: number }[]>`select count(*)::int as n from app.course where id = any (${ids}::int[]) and active`;
    if (ok!.n !== ids.length) throw bad("courseIds: inactive or unknown");
    await tx.$executeRaw`delete from app.fee_scheme_course where scheme_id = ${s} and not (course_id = any (${ids}::int[]))`;
    await tx.$executeRaw`insert into app.fee_scheme_course (scheme_id, course_id) select ${s}, x from unnest(${ids}::int[]) x on conflict do nothing`;
  }), () => ({ before: { courseIds: before }, after: { courseIds: ids } }));
}

/** Replaces the scheme's centres; none means every centre (DD-3). */
export async function setSchemeCentres(session: string | undefined, schemeId: number, centreIds: number[]): Promise<void> {
  const s = idOf("schemeId", schemeId), ids = idList("centreIds", centreIds);
  let before: number[] = [];
  return adminWrite(session, { action: "fee.scheme.centres", permission: MANAGE, targetType: "fee_scheme", targetId: String(s) }, (tx) => schemeDb(async () => {
    await locked(tx, s);
    before = (await tx.$queryRaw<{ id: number }[]>`select centre_id as id from app.fee_scheme_centre where scheme_id = ${s} order by 1`).map((x) => x.id);
    if (before.join() === ids.join()) throw bad("nothing to change");
    const [ok] = await tx.$queryRaw<{ n: number }[]>`select count(*)::int as n from app.centre where id = any (${ids}::int[])`;
    if (ok!.n !== ids.length) throw bad("centreIds: inactive or unknown");
    await tx.$executeRaw`delete from app.fee_scheme_centre where scheme_id = ${s} and not (centre_id = any (${ids}::int[]))`;
    await tx.$executeRaw`insert into app.fee_scheme_centre (scheme_id, centre_id) select ${s}, x from unnest(${ids}::int[]) x on conflict do nothing`;
  }), () => ({ before: { centreIds: before }, after: { centreIds: ids } }));
}

/** Deletes a draft: its rules and targets, then the scheme (R7). */
export async function deleteScheme(session: string | undefined, schemeId: number): Promise<void> {
  const s = idOf("schemeId", schemeId);
  let gone: Record<string, unknown> = {};
  return adminWrite(session, { action: "fee.scheme.delete", permission: MANAGE, targetType: "fee_scheme", targetId: String(s) }, (tx) => schemeDb(async () => {
    const cur = await locked(tx, s);
    if (cur.status !== "DRAFT") throw new RbacError("invalid", GUARD_KEY["fee_scheme_guard"]![1], "fee.scheme.locked");
    const rules = await tx.$executeRaw`delete from app.fee_scheme_rule where scheme_id = ${s}`;
    const courses = await tx.$executeRaw`delete from app.fee_scheme_course where scheme_id = ${s}`;
    const centres = await tx.$executeRaw`delete from app.fee_scheme_centre where scheme_id = ${s}`;
    await tx.$executeRaw`delete from app.fee_scheme where id = ${s}`;
    gone = { code: cur.code, rules, courses, centres };
  }), () => ({ before: gone }));
}

/** Makes a draft LIVE: by a holder of scheme.approve who neither made nor last edited it (DD-1). */
export async function approveScheme(session: string | undefined, schemeId: number): Promise<void> {
  const s = idOf("schemeId", schemeId);
  return adminWrite(session, { action: "fee.scheme.approve", permission: APPROVE, targetType: "fee_scheme", targetId: String(s) }, (tx) => schemeDb(async () => {
    const cur = await locked(tx, s);
    if (cur.status !== "DRAFT") throw new RbacError("invalid", GUARD_KEY["fee_scheme_guard"]![1], "fee.scheme.locked");
    await tx.$executeRaw`update app.fee_scheme set status = 'LIVE' where id = ${s}`;
  }), () => ({ before: { status: "DRAFT" }, after: { status: "LIVE" } }));
}

/** Retires a LIVE scheme with a reason: no new assignments; given concessions stay. */
export async function retireScheme(session: string | undefined, schemeId: number, reason: string): Promise<void> {
  const s = idOf("schemeId", schemeId), r = reasonOf(reason);
  if (r.length > 500) throw bad("reason: 1-500 characters");
  return adminWrite(session, { action: "fee.scheme.retire", permission: APPROVE, targetType: "fee_scheme", targetId: String(s), reason: r }, (tx) => schemeDb(async () => {
    const cur = await locked(tx, s);
    if (cur.status !== "LIVE") throw new RbacError("invalid", "only a live scheme is retired", "fee.scheme.notlive");
    await tx.$executeRaw`update app.fee_scheme set status = 'RETIRED', retired_reason = ${r} where id = ${s}`;
  }), () => ({ before: { status: "LIVE" }, after: { status: "RETIRED" } }));
}
