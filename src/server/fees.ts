// Fee masters and fee structure (docs/designs/fee-structure, Stage 4 F1, WF4): fee types (HSN/SAC, GST rate, order),
// instalments per academic year, and versioned fee plans per year x course x centre class, or per centre as an override.
// Fee categories are a catalogue master (catalogue.ts, fee_category). Writes need fee.setup (sensitive, ALL scope,
// step-up) through adminWrite; the database adds named checks, RLS and guards that make a published plan immutable (0025).
// Money is numeric(14,2): strings in and out, sums in SQL, never a JS number (F13). Plan amounts include GST (DD-1).
import { Prisma } from "../../generated/prisma/client";
import { withScope, type Tx } from "./db";
import { bad, code, date, name, reasonOf } from "./catalogue";
import { offeredAtCentre, offeredInClass } from "./people";
import { adminWrite, RbacError } from "./rbac";

const SETUP = "fee.setup";
/** The GST rates a fee type may carry (PMC; the tax advisor confirms before go-live). */
export const GST_RATES = ["0", "5", "18", "40"];
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const RATE = /^\d{1,3}(\.\d{1,4})?$/;

const idOf = (field: string, v: unknown) => { if (!Number.isSafeInteger(v) || (v as number) < 1) throw bad(`${field}: inactive or unknown`); return v as number; };
const sortOf = (v: unknown) => { if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > 9999) throw bad("sortOrder: 0-9999"); return v as number; };
const hsnOf = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; if (!/^[0-9]{4,8}$/.test(s)) throw bad("hsnSac: 4-8 digits"); return s; };
/** "18.00" -> "18", "05" -> "5"; then one of the allowed rates (R11). */
function rateOf(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!RATE.test(s)) throw bad("gstRate: a percentage");
  const [i, f = ""] = s.split(".");
  const frac = f.replace(/0+$/, ""), r = frac ? `${Number(i)}.${frac}` : String(Number(i));
  if (!GST_RATES.includes(r)) throw bad(`gstRate: one of ${GST_RATES.join(", ")}`);
  return r;
}
const amountOf = (v: unknown) => { if (typeof v !== "string" || !AMOUNT.test(v)) throw bad("amount: up to 12 digits and 2 decimals"); return v; };

// Database refusals by name (the driver drops error.constraint, so it is read from the message); inside adminWrite,
// before its db() turns every 23514 into "invalid value" (I3)
const GUARD_KEY: Record<string, [string, string]> = {
  fee_plan_guard: ["fee.plan.locked", "this plan is published and cannot change"],
  fee_plan_line_guard: ["fee.plan.locked", "this plan is published and cannot change"],
  fee_caption_guard: ["fee.caption.locked", "this instalment is used by a published plan"],
  fee_plan_draft_guard: ["fee.duplicate", "a draft for this plan already exists"],
  fee_plan_empty_guard: ["fee.plan.empty", "add at least one line before publishing"],
  fee_type_account_guard: ["fee.account", "this account cannot take fees"],
};
async function feeDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const cause = (e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } }).meta?.driverAdapterError?.cause;
    const constraint = /constraint "([^"]+)"/.exec(cause?.originalMessage ?? "")?.[1] ?? "";
    if (cause?.originalCode === "23514" && Object.hasOwn(GUARD_KEY, constraint)) {
      const [key, message] = GUARD_KEY[constraint]!;
      throw new RbacError(key === "fee.duplicate" ? "duplicate" : "invalid", message, key);
    }
    if (cause?.originalCode === "23505") throw new RbacError("duplicate", "a record with that code or name already exists", "fee.duplicate");
    throw e;
  }
}
const canManage = async (tx: Tx) => (await tx.$queryRaw<{ ok: boolean }[]>`select app.has_permission('fee.setup', null) as ok`)[0]!.ok;

// ---------- Fee types ----------

export type FeeTypeRow = { id: number; code: string; name: string; categoryId: number; categoryCode: string; sortOrder: number;
  hsnSac: string; gstRate: string; active: boolean; accountId: number | null; accountCode: string | null };
const ACCOUNT_RULE = "accountId: an active income or liability account";
/** null = not mapped; else a positive id, checked in the transaction against the chart (fee-ledger DD-7). */
const accountOf = (v: unknown) => { if (v === null) return null; if (!Number.isSafeInteger(v) || (v as number) < 1) throw bad(ACCOUNT_RULE); return v as number; };
async function accountOk(tx: Tx, id: number | null) {
  if (id === null) return;
  const [a] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from app.account where id = ${id} and active and kind in ('INCOME', 'LIABILITY') and system_key is null`;
  if (!a) throw bad(ACCOUNT_RULE);
}

export const listFeeTypes = (session: string | undefined) => withScope(session, async (tx) => ({
  rows: await tx.$queryRaw<FeeTypeRow[]>`select t.id, t.code, t.name, t.category_id as "categoryId", c.code as "categoryCode",
      t.sort_order as "sortOrder", t.hsn_sac as "hsnSac", trim_scale(t.gst_rate)::text as "gstRate", t.active,
      t.account_id as "accountId", a.code as "accountCode"
    from app.fee_type t join app.fee_category c on c.id = t.category_id left join app.account a on a.id = t.account_id
    order by t.sort_order, t.code`,
  accounts: await tx.$queryRaw<{ id: number; code: string; name: string }[]>`
    select id, code, name from app.account where active and kind in ('INCOME', 'LIABILITY') and system_key is null order by code`,
  categories: await tx.$queryRaw<{ id: number; code: string; name: string }[]>`select id, code, name from app.fee_category where active order by code`,
  canManage: await canManage(tx),
}));

export async function createFeeType(session: string | undefined, t: { code: string; name: string; categoryId: number; sortOrder: number;
  hsnSac: string; gstRate: string; accountId?: number | null }): Promise<{ id: number }> {
  const c = code(t?.code), n = name(t?.name), cat = idOf("categoryId", t?.categoryId), so = sortOf(t?.sortOrder), h = hsnOf(t?.hsnSac), r = rateOf(t?.gstRate);
  const acc = accountOf(t?.accountId ?? null);
  return adminWrite(session, { action: "fee.type.create", permission: SETUP, targetType: "fee_type" }, (tx) => feeDb(async () => {
    const [k] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from app.fee_category where id = ${cat} and active for share`;
    if (!k) throw bad("categoryId: inactive or unknown");
    await accountOk(tx, acc);
    return (await tx.$queryRaw<{ id: number }[]>`insert into app.fee_type (code, name, category_id, sort_order, hsn_sac, gst_rate, account_id)
      values (${c}, ${n}, ${cat}, ${so}, ${h}, ${r}::numeric, ${acc}) returning id`)[0]!;
  }), (x) => ({ after: { id: x.id, code: c, name: n, categoryId: cat, sortOrder: so, hsnSac: h, gstRate: r, accountId: acc } }));
}

type TypeChanges = Partial<{ name: string; sortOrder: number; hsnSac: string; gstRate: string; accountId: number | null }>;
export async function updateFeeType(session: string | undefined, id: number, ch: TypeChanges): Promise<void> {
  const i = idOf("id", id);
  const f: Record<string, string | number | null> = {};
  if (ch?.name !== undefined) f["name"] = name(ch.name);
  if (ch?.sortOrder !== undefined) f["sortOrder"] = sortOf(ch.sortOrder);
  if (ch?.hsnSac !== undefined) f["hsnSac"] = hsnOf(ch.hsnSac);
  if (ch?.gstRate !== undefined) f["gstRate"] = rateOf(ch.gstRate);
  if (ch?.accountId !== undefined) f["accountId"] = accountOf(ch.accountId);
  if (Object.keys(f).length === 0) throw bad("nothing to change");
  let diff: [string, unknown, unknown][] = [];
  return adminWrite(session, { action: "fee.type.update", permission: SETUP, targetType: "fee_type", targetId: String(i) }, (tx) => feeDb(async () => {
    const [cur] = await tx.$queryRaw<{ name: string; sortOrder: number; hsnSac: string; gstRate: string; accountId: number | null }[]>`
      select name, sort_order as "sortOrder", hsn_sac as "hsnSac", trim_scale(gst_rate)::text as "gstRate", account_id as "accountId"
      from app.fee_type where id = ${i} for update`;
    if (!cur) throw new RbacError("notfound", "fee type not found");
    diff = Object.entries(f).filter(([k, v]) => cur[k as keyof typeof cur] !== v).map(([k, v]) => [k, cur[k as keyof typeof cur], v]);
    if (diff.length === 0) throw bad("nothing to change");
    const next = { ...cur, ...f } as typeof cur;
    if (diff.some(([k]) => k === "accountId")) await accountOk(tx, next.accountId);
    await tx.$executeRaw`update app.fee_type set name = ${next.name}, sort_order = ${next.sortOrder}, hsn_sac = ${next.hsnSac},
      gst_rate = ${next.gstRate}::numeric, account_id = ${next.accountId} where id = ${i}`;
  }), () => ({ before: Object.fromEntries(diff.map(([k, b]) => [k, b])), after: Object.fromEntries(diff.map(([k, , a]) => [k, a])) }));
}

// Two calls with literal actions, so the audit catalogue gate reads both names.
export async function setFeeTypeActive(session: string | undefined, id: number, active: boolean, reason: string): Promise<void> {
  const i = idOf("id", id), r = reasonOf(reason);
  if (typeof active !== "boolean") throw bad("active: invalid");
  const run = (tx: Tx) => feeDb(async () => {
    const [cur] = await tx.$queryRaw<{ active: boolean }[]>`select active from app.fee_type where id = ${i} for update`;
    if (!cur) throw new RbacError("notfound", "fee type not found");
    if (cur.active === active) throw bad(`already ${active ? "active" : "inactive"}`);
    await tx.$executeRaw`update app.fee_type set active = ${active} where id = ${i}`;
    return { before: { active: cur.active }, after: { active } };
  });
  await (active
    ? adminWrite(session, { action: "fee.type.activate", permission: SETUP, targetType: "fee_type", targetId: String(i), reason: r }, run, (x) => x)
    : adminWrite(session, { action: "fee.type.deactivate", permission: SETUP, targetType: "fee_type", targetId: String(i), reason: r }, run, (x) => x));
}

// ---------- Instalments (captions) per academic year ----------

export type CaptionRow = { id: number; academicYear: string; name: string; dueOn: string; sortOrder: number; active: boolean };

export const listCaptions = (session: string | undefined, year?: string) => withScope(session, async (tx) => ({
  years: await tx.$queryRaw<{ code: string; open: boolean }[]>`select code, open from app.academic_year order by code`,
  rows: year === undefined ? [] : await tx.$queryRaw<CaptionRow[]>`select id, academic_year as "academicYear", name, due_on::text as "dueOn",
      sort_order as "sortOrder", active from app.fee_caption where academic_year = ${String(year)} order by sort_order, due_on, id`,
  canManage: await canManage(tx),
}));

/** The due date lies within the year (C5, PMC). */
async function inYear(tx: Tx, year: string, dueOn: string) {
  const [y] = await tx.$queryRaw<{ s: string; e: string }[]>`select starts_on::text as s, ends_on::text as e from app.academic_year where code = ${year}`;
  if (!y) throw bad("academicYear: unknown");
  if (dueOn < y.s || dueOn > y.e) throw bad(`dueOn: within ${y.s} to ${y.e}`);
}

export async function createCaption(session: string | undefined, c: { academicYear: string; name: string; dueOn: string; sortOrder: number })
  : Promise<{ id: number }> {
  const y = typeof c?.academicYear === "string" ? c.academicYear : "", n = name(c?.name), d = date("dueOn", c?.dueOn), so = sortOf(c?.sortOrder);
  if (!/^\d{4}-\d{2}$/.test(y)) throw bad("academicYear: unknown");
  return adminWrite(session, { action: "fee.caption.create", permission: SETUP, targetType: "fee_caption" }, (tx) => feeDb(async () => {
    await inYear(tx, y, d);
    return (await tx.$queryRaw<{ id: number }[]>`insert into app.fee_caption (academic_year, name, due_on, sort_order)
      values (${y}, ${n}, ${d}::date, ${so}) returning id`)[0]!;
  }), (x) => ({ after: { id: x.id, academicYear: y, name: n, dueOn: d, sortOrder: so } }));
}

export async function updateCaption(session: string | undefined, id: number, ch: Partial<{ name: string; dueOn: string; sortOrder: number }>)
  : Promise<void> {
  const i = idOf("id", id);
  const f: Record<string, string | number> = {};
  if (ch?.name !== undefined) f["name"] = name(ch.name);
  if (ch?.dueOn !== undefined) f["dueOn"] = date("dueOn", ch.dueOn);
  if (ch?.sortOrder !== undefined) f["sortOrder"] = sortOf(ch.sortOrder);
  if (Object.keys(f).length === 0) throw bad("nothing to change");
  let diff: [string, unknown, unknown][] = [];
  return adminWrite(session, { action: "fee.caption.update", permission: SETUP, targetType: "fee_caption", targetId: String(i) }, (tx) => feeDb(async () => {
    const [cur] = await tx.$queryRaw<{ academicYear: string; name: string; dueOn: string; sortOrder: number }[]>`
      select academic_year as "academicYear", name, due_on::text as "dueOn", sort_order as "sortOrder" from app.fee_caption where id = ${i} for update`;
    if (!cur) throw new RbacError("notfound", "instalment not found");
    diff = Object.entries(f).filter(([k, v]) => cur[k as keyof typeof cur] !== v).map(([k, v]) => [k, cur[k as keyof typeof cur], v]);
    if (diff.length === 0) throw bad("nothing to change");
    const next = { ...cur, ...f } as typeof cur;
    if (next.dueOn !== cur.dueOn) await inYear(tx, cur.academicYear, next.dueOn);
    await tx.$executeRaw`update app.fee_caption set name = ${next.name}, due_on = ${next.dueOn}::date, sort_order = ${next.sortOrder} where id = ${i}`;
  }), () => ({ before: Object.fromEntries(diff.map(([k, b]) => [k, b])), after: Object.fromEntries(diff.map(([k, , a]) => [k, a])) }));
}

export async function setCaptionActive(session: string | undefined, id: number, active: boolean, reason: string): Promise<void> {
  const i = idOf("id", id), r = reasonOf(reason);
  if (typeof active !== "boolean") throw bad("active: invalid");
  const run = (tx: Tx) => feeDb(async () => {
    const [cur] = await tx.$queryRaw<{ active: boolean }[]>`select active from app.fee_caption where id = ${i} for update`;
    if (!cur) throw new RbacError("notfound", "instalment not found");
    if (cur.active === active) throw bad(`already ${active ? "active" : "inactive"}`);
    await tx.$executeRaw`update app.fee_caption set active = ${active} where id = ${i}`;
    return { before: { active: cur.active }, after: { active } };
  });
  await (active
    ? adminWrite(session, { action: "fee.caption.activate", permission: SETUP, targetType: "fee_caption", targetId: String(i), reason: r }, run, (x) => x)
    : adminWrite(session, { action: "fee.caption.deactivate", permission: SETUP, targetType: "fee_caption", targetId: String(i), reason: r }, run, (x) => x));
}

// ---------- Fee plans ----------

type PlanKey = { academicYear: string; courseId: number; centreClassId: number | null; centreId: number | null };
/** The plan key as fee_plan_guard builds it (R1: in TS, so a null side cannot null the whole key). */
const keyText = (k: PlanKey) => `fee-plan:${k.academicYear}:${k.courseId}:K${k.centreClassId ?? ""}C${k.centreId ?? ""}`;
const lockKey = (tx: Tx, k: PlanKey) => tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${keyText(k)}))`;
const sameKey = (k: PlanKey) => Prisma.sql`academic_year = ${k.academicYear} and course_id = ${k.courseId}
  and centre_class_id is not distinct from ${k.centreClassId}::int and centre_id is not distinct from ${k.centreId}::int`;

export type PlanRow = { id: number; academicYear: string; courseId: number; courseCode: string; centreClassId: number | null;
  classCode: string | null; centreId: number | null; centreCode: string | null; version: number; status: string; currency: string;
  lines: number; total: string; publishedAt: string | null };

const planCols = Prisma.sql`p.id, p.academic_year as "academicYear", p.course_id as "courseId", co.code as "courseCode",
  p.centre_class_id as "centreClassId", k.code as "classCode", p.centre_id as "centreId", ce.code as "centreCode", p.version, p.status,
  p.currency::text as currency, (select count(*) from app.fee_plan_line l where l.plan_id = p.id)::int as lines,
  coalesce((select sum(l.amount) from app.fee_plan_line l where l.plan_id = p.id), 0)::numeric(16,2)::text as total,
  to_json(p.published_at) #>> '{}' as "publishedAt"`;
const planFrom = Prisma.sql`from app.fee_plan p join app.course co on co.id = p.course_id
  left join app.centre_class k on k.id = p.centre_class_id left join app.centre ce on ce.id = p.centre_id`;

/** Published plans for everyone, drafts too for fee.setup (RLS); by year, course, key, version. */
export const listPlans = (session: string | undefined, f: { year?: string; courseId?: number } = {}) => withScope(session, async (tx) => ({
  rows: await tx.$queryRaw<PlanRow[]>`select ${planCols} ${planFrom}
    where (${f.year ?? null}::text is null or p.academic_year = ${f.year ?? null}::text)
      and (${Number.isSafeInteger(f.courseId) ? f.courseId! : null}::int is null or p.course_id = ${Number.isSafeInteger(f.courseId) ? f.courseId! : null}::int)
    order by p.academic_year desc, co.code, k.code nulls last, ce.code nulls last, p.version desc`,
  canManage: await canManage(tx),
}));

export type PlanLine = { feeTypeId: number; feeTypeCode: string; feeTypeName: string; captionId: number; captionName: string; dueOn: string; amount: string };
/** A plan with its lines and totals (R13), or notfound when the caller may not see it (a draft for non-holders). */
export async function getPlan(session: string | undefined, id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new RbacError("notfound", "plan not found");
  return withScope(session, async (tx) => {
    const [plan] = await tx.$queryRaw<PlanRow[]>`select ${planCols} ${planFrom} where p.id = ${id}`;
    if (!plan) throw new RbacError("notfound", "plan not found");
    const lines = await tx.$queryRaw<PlanLine[]>`select l.fee_type_id as "feeTypeId", t.code as "feeTypeCode", t.name as "feeTypeName",
        l.caption_id as "captionId", c.name as "captionName", c.due_on::text as "dueOn", l.amount::text as amount
      from app.fee_plan_line l join app.fee_type t on t.id = l.fee_type_id join app.fee_caption c on c.id = l.caption_id
      where l.plan_id = ${id} order by c.sort_order, c.due_on, t.sort_order, t.code`;
    const byCaption = await tx.$queryRaw<{ captionId: number; total: string }[]>`select caption_id as "captionId", sum(amount)::text as total
      from app.fee_plan_line where plan_id = ${id} group by caption_id`;
    const byType = await tx.$queryRaw<{ feeTypeId: number; total: string }[]>`select fee_type_id as "feeTypeId", sum(amount)::text as total
      from app.fee_plan_line where plan_id = ${id} group by fee_type_id`;
    return { plan, lines, byCaption, byType, canManage: await canManage(tx) };
  });
}

/** Creates the next version for a key: empty, or a copy of the current published version (Z8). */
export async function createPlan(session: string | undefined, input: { academicYear: string; courseId: number; centreClassId?: number | null;
  centreId?: number | null }): Promise<{ id: number; version: number }> {
  const y = typeof input?.academicYear === "string" && /^\d{4}-\d{2}$/.test(input.academicYear) ? input.academicYear : null;
  if (!y) throw bad("academicYear: unknown");
  const course = idOf("courseId", input.courseId);
  const cls = input.centreClassId == null ? null : idOf("centreClassId", input.centreClassId);
  const centre = input.centreId == null ? null : idOf("centreId", input.centreId);
  if ((cls === null) === (centre === null)) throw bad("centreClassId: a class or a centre, not both");
  const k: PlanKey = { academicYear: y, courseId: course, centreClassId: cls, centreId: centre };
  // the id first: adminWrite fixes the audit target before the callback
  const id = await withScope(session, async (tx) => (await tx.$queryRaw<{ id: number }[]>`select nextval('app.fee_plan_id_seq')::int as id`)[0]!.id);
  let copied = 0, version = 0;
  return adminWrite(session, { action: "fee.plan.create", permission: SETUP, targetType: "fee_plan", targetId: String(id) }, (tx) => feeDb(async () => {
    await lockKey(tx, k);
    const [yr] = await tx.$queryRaw<{ open: boolean }[]>`select open from app.academic_year where code = ${y}`;
    if (!yr) throw bad("academicYear: unknown");
    if (!yr.open) throw bad("academicYear: closed");
    const [co] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from app.course where id = ${course} and active`;
    if (!co) throw bad("courseId: inactive or unknown");
    if (cls !== null) {
      const [kk] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from app.centre_class where id = ${cls} and active`;
      if (!kk) throw bad("centreClassId: inactive or unknown");
      const [o] = await tx.$queryRaw<{ ok: boolean }[]>`select ${offeredInClass(Prisma.sql`${course}::int`, Prisma.sql`${cls}::int`)} as ok`;
      if (!o!.ok) throw new RbacError("invalid", "courseId: not offered for that class", "fee.plan.offering");
    } else {
      const [ce] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from app.centre where id = ${centre}`;
      if (!ce) throw bad("centreId: inactive or unknown");
      const [o] = await tx.$queryRaw<{ ok: boolean }[]>`select ${offeredAtCentre(Prisma.sql`${course}::int`, Prisma.sql`${centre}::int`)} as ok`;
      if (!o!.ok) throw new RbacError("invalid", "courseId: not offered at that centre", "fee.plan.offering");
    }
    const [v] = await tx.$queryRaw<{ v: number }[]>`select coalesce(max(version), 0)::int + 1 as v from app.fee_plan where ${sameKey(k)}`;
    version = v!.v;
    await tx.$executeRaw`insert into app.fee_plan (id, academic_year, course_id, centre_class_id, centre_id, version)
      values (${id}, ${y}, ${course}, ${cls}::int, ${centre}::int, ${version})`;
    // a new version copies the current published one, lines as they are (inactive masters then block its publish)
    copied = await tx.$executeRaw`insert into app.fee_plan_line (plan_id, academic_year, fee_type_id, caption_id, amount)
      select ${id}, l.academic_year, l.fee_type_id, l.caption_id, l.amount from app.fee_plan_line l
      where l.plan_id = (select p.id from app.fee_plan p where ${sameKey(k)} and p.status = 'PUBLISHED' order by p.version desc limit 1)`;
    return { id, version };
  }), () => ({ after: { key: keyText(k), version, currency: "INR", copiedLines: copied } }));
}

/** Sets a line's amount, or removes the line (amount null). Only on a draft; the type and instalment must be active. */
export async function setPlanLine(session: string | undefined, planId: number, l: { feeTypeId: number; captionId: number; amount: string | null })
  : Promise<void> {
  const p = idOf("planId", planId), t = idOf("feeTypeId", l?.feeTypeId), c = idOf("captionId", l?.captionId);
  const amount = l?.amount === null ? null : amountOf(l?.amount);
  let before: string | null = null;
  return adminWrite(session, { action: "fee.plan.line", permission: SETUP, targetType: "fee_plan", targetId: String(p) }, (tx) => feeDb(async () => {
    const [plan] = await tx.$queryRaw<{ status: string; academicYear: string }[]>`select status, academic_year as "academicYear" from app.fee_plan where id = ${p}`;
    if (!plan) throw new RbacError("notfound", "plan not found");
    if (plan.status !== "DRAFT") throw new RbacError("invalid", "this plan is published and cannot change", "fee.plan.locked");
    const [cur] = await tx.$queryRaw<{ amount: string }[]>`select amount::text as amount from app.fee_plan_line
      where plan_id = ${p} and fee_type_id = ${t} and caption_id = ${c}`;
    before = cur?.amount ?? null;
    if (amount === null) {
      if (!cur) throw bad("nothing to change");
      await tx.$executeRaw`delete from app.fee_plan_line where plan_id = ${p} and fee_type_id = ${t} and caption_id = ${c}`;
      return;
    }
    const [ft] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from app.fee_type where id = ${t} and active`;
    if (!ft) throw bad("feeTypeId: inactive or unknown");
    const [cp] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from app.fee_caption where id = ${c} and active and academic_year = ${plan.academicYear}`;
    if (!cp) throw bad("captionId: inactive, unknown or another year");
    if (cur && (await tx.$queryRaw<{ same: boolean }[]>`select ${cur.amount}::numeric = ${amount}::numeric as same`)[0]!.same) throw bad("nothing to change");
    await tx.$executeRaw`insert into app.fee_plan_line (plan_id, academic_year, fee_type_id, caption_id, amount)
      values (${p}, ${plan.academicYear}, ${t}, ${c}, ${amount}::numeric(14,2))
      on conflict (plan_id, fee_type_id, caption_id) do update set amount = excluded.amount`;
  }), () => ({ before: { feeTypeId: t, captionId: c, amount: before }, after: { feeTypeId: t, captionId: c, amount } }));
}

async function lockedPlan(tx: Tx, id: number) {
  const [k] = await tx.$queryRaw<(PlanKey & { status: string })[]>`select academic_year as "academicYear", course_id as "courseId",
    centre_class_id as "centreClassId", centre_id as "centreId", status from app.fee_plan where id = ${id}`;
  if (!k) throw new RbacError("notfound", "plan not found");
  await lockKey(tx, k);
  const [p] = await tx.$queryRaw<{ status: string; version: number }[]>`select status, version from app.fee_plan where id = ${id} for update`;
  if (!p) throw new RbacError("notfound", "plan not found");
  return { ...k, ...p };
}

/** Deletes a draft: its lines, then the plan, in one transaction (D8). */
export async function deletePlan(session: string | undefined, planId: number): Promise<void> {
  const p = idOf("planId", planId);
  let gone: Record<string, unknown> = {};
  return adminWrite(session, { action: "fee.plan.delete", permission: SETUP, targetType: "fee_plan", targetId: String(p) }, (tx) => feeDb(async () => {
    const k = await lockedPlan(tx, p);
    if (k.status !== "DRAFT") throw new RbacError("invalid", "this plan is published and cannot change", "fee.plan.locked");
    const lines = await tx.$executeRaw`delete from app.fee_plan_line where plan_id = ${p}`;
    await tx.$executeRaw`delete from app.fee_plan where id = ${p}`;
    gone = { key: keyText(k), version: k.version, lines };
  }), () => ({ before: gone }));
}

/** Publishes a draft: it becomes the current plan for its key (the highest published version). */
export async function publishPlan(session: string | undefined, planId: number, reason: string): Promise<void> {
  const p = idOf("planId", planId), r = reasonOf(reason);
  let summary: Record<string, unknown> = {};
  return adminWrite(session, { action: "fee.plan.publish", permission: SETUP, targetType: "fee_plan", targetId: String(p), reason: r },
    (tx) => feeDb(async () => {
      const k = await lockedPlan(tx, p);
      if (k.status !== "DRAFT") throw new RbacError("invalid", "this plan is published and cannot change", "fee.plan.locked");
      // the lines' masters for share (I2): a concurrent deactivation or due-date change waits for this publish
      const refs = await tx.$queryRaw<{ typeActive: boolean; captionActive: boolean }[]>`
        select t.active as "typeActive", c.active as "captionActive" from app.fee_plan_line l
          join app.fee_type t on t.id = l.fee_type_id join app.fee_caption c on c.id = l.caption_id
        where l.plan_id = ${p} order by t.id, c.id for share of t, c`;
      if (refs.length === 0) throw new RbacError("invalid", "add at least one line before publishing", "fee.plan.empty");
      if (refs.some((x) => !x.typeActive || !x.captionActive)) throw new RbacError("invalid", "a line uses an inactive fee type or instalment", "fee.plan.inactive");
      await tx.$executeRaw`update app.fee_plan set status = 'PUBLISHED' where id = ${p}`;
      const [t] = await tx.$queryRaw<{ total: string }[]>`select sum(amount)::text as total from app.fee_plan_line where plan_id = ${p}`;
      summary = { status: "PUBLISHED", version: k.version, lines: refs.length, total: t!.total };
    }), () => ({ before: { status: "DRAFT" }, after: summary }));
}

/**
 * The plan that prices a course at a centre in a year (G3, for F2): the centre's current override if one is published,
 * else its class's current plan, else null. Never a draft. Runs in the caller's transaction (published plans are visible
 * to all). A centre without a class gets an override or nothing.
 */
export async function resolvePlan(tx: Tx, centreId: number, courseId: number, academicYear: string): Promise<{ planId: number; currency: string } | null> {
  const [r] = await tx.$queryRaw<{ planId: number; currency: string }[]>`
    select p.id as "planId", p.currency::text as currency from app.fee_plan p
    where p.status = 'PUBLISHED' and p.academic_year = ${academicYear} and p.course_id = ${courseId}
      and (p.centre_id = ${centreId} or p.centre_class_id = (select centre_class_id from app.centre where id = ${centreId}))
    order by (p.centre_id is not null) desc, p.version desc limit 1`;
  return r ?? null;
}

/** The pickers of the new-plan form: open years, active courses and classes, and the centres the caller sees. */
export const planOptions = (session: string | undefined) => withScope(session, async (tx) => ({
  years: await tx.$queryRaw<{ code: string }[]>`select code from app.academic_year where open order by code`,
  courses: await tx.$queryRaw<{ id: number; code: string; name: string }[]>`select id, code, name from app.course where active order by code`,
  classes: await tx.$queryRaw<{ id: number; code: string; name: string }[]>`select id, code, name from app.centre_class where active order by code`,
  centres: await tx.$queryRaw<{ id: number; code: string; name: string }[]>`select id, code, name from app.centre order by code`,
}));
