// Centre and catalogue skeleton, Stage 2 (docs/designs/catalogue-skeleton/catalogue-skeleton.md). Every write goes
// through adminWrite: catalogue.manage at ALL scope, fresh step-up, before/after audited. The tables' RLS write policy
// re-checks catalogue.manage in the database (0012, 0016). Codes never change; rows are never deleted, except a course's
// centre-class links, which are replaced as a set.
import { Prisma } from "../../generated/prisma/client";
import { Forbidden } from "./action";
import { withScope, type Tx } from "./db";
import { academicYearOk, ACADEMIC_YEAR_RULE, CODE_RULE, isoDate, normCode, PersonError } from "./people";
import { adminWrite, RbacError } from "./rbac";

export type MasterKind = "course_category" | "course_division" | "centre_class";
// fixed fragments: no caller-supplied text reaches SQL as an identifier
const TABLES: Record<MasterKind, Prisma.Sql> = {
  course_category: Prisma.sql`app.course_category`,
  course_division: Prisma.sql`app.course_division`,
  centre_class: Prisma.sql`app.centre_class`,
};

type Master = { id: number; code: string; name: string; active: boolean };
type YearRow = { code: string; startsOn: string; endsOn: string; open: boolean };

const bad = (message: string) => new RbacError("invalid", message);
const MANAGE = "catalogue.manage";

// ---------- Validation (before any database access) ----------

function table(kind: unknown): Prisma.Sql {
  if (typeof kind !== "string" || !Object.hasOwn(TABLES, kind)) throw bad("kind: unknown");
  return TABLES[kind as MasterKind];
}
function code(v: unknown): string {
  const c = normCode(v);
  if (c === "") throw bad("code: required");
  if (!CODE_RULE.test(c) || c.length > 30) throw bad("code: printable ASCII, single spaces, at most 30");
  return c;
}
function name(v: unknown): string {
  const n = typeof v === "string" ? v.trim() : "";
  if (n.length < 1 || n.length > 200) throw bad("name: 1-200 characters");
  return n;
}
function id(field: string, v: unknown): number {
  if (!Number.isSafeInteger(v)) throw bad(`${field}: invalid`);
  return v as number;
}
function bool(field: string, v: unknown): boolean {
  if (typeof v !== "boolean") throw bad(`${field}: invalid`);
  return v;
}
function reasonOf(v: unknown): string {
  const r = typeof v === "string" ? v.trim() : "";
  if (!r) throw bad("reason: required"); // DD-9
  return r;
}
function date(field: string, v: unknown): string {
  try { return isoDate(field, v); } catch (e) {
    if (e instanceof PersonError) throw bad(e.message);
    throw e;
  }
}
function yearCode(v: unknown): string {
  if (typeof v !== "string" || !academicYearOk(v)) throw bad(`code: ${ACADEMIC_YEAR_RULE}`);
  return v;
}
function datesOk(startsOn: string, endsOn: string) {
  if (!(endsOn > startsOn)) throw bad("endsOn: after startsOn");
}

// A duplicate code gives its own message, not db()'s login-or-key text.
async function unique<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) {
    if (e instanceof RbacError && e.reason === "duplicate") throw new RbacError("duplicate", "a record with that code already exists", "catalogue.duplicate");
    throw e;
  }
}

// ---------- Row locks and reference checks (inside the transaction) ----------

async function lockMaster(tx: Tx, t: Prisma.Sql, kind: string, rowId: number): Promise<Master> {
  const [r] = await tx.$queryRaw<Master[]>`select id, code, name, active from ${t} where id = ${rowId} for update`;
  if (!r) throw new RbacError("notfound", `${kind} not found`);
  return r;
}
async function lockYear(tx: Tx, yc: string): Promise<YearRow> {
  const [r] = await tx.$queryRaw<YearRow[]>`select code, starts_on::text as "startsOn", ends_on::text as "endsOn", open
    from app.academic_year where code = ${yc} for update`;
  if (!r) throw new RbacError("notfound", "academic_year not found");
  return r;
}
// DD-10: a course is created in, or moved to, an active category and division only
async function liveRef(tx: Tx, t: Prisma.Sql, field: string, rowId: number) {
  const [r] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from ${t} where id = ${rowId} and active for share`;
  if (!r) throw bad(`${field}: inactive or unknown`);
}
const already = (state: string) => bad(`already ${state}`);
const done = () => undefined;

// ---------- Masters: course category, course division, centre class ----------

export async function createMaster(session: string | undefined, kind: MasterKind, m: { code: string; name: string }) {
  const t = table(kind);
  const c = code(m.code), n = name(m.name);
  return unique(() => adminWrite(session, { action: "catalogue.create", permission: MANAGE, targetType: kind },
    async (tx) => (await tx.$queryRaw<Master[]>`insert into ${t} (code, name) values (${c}, ${n}) returning id, code, name, active`)[0]!,
    (r) => ({ after: r }))).then((r) => ({ id: r.id, code: r.code }));
}

export async function updateMaster(session: string | undefined, kind: MasterKind, rowId: number, m: { name: string }) {
  const t = table(kind);
  const i = id("id", rowId), n = name(m.name);
  return adminWrite(session, { action: "catalogue.update", permission: MANAGE, targetType: kind, targetId: String(i) },
    async (tx) => {
      const before = await lockMaster(tx, t, kind, i);
      if (before.name === n) throw bad("nothing to change");
      await tx.$executeRaw`update ${t} set name = ${n} where id = ${i}`;
      return { before, after: { ...before, name: n } };
    }, (r) => r).then(done);
}

// Two calls, not one with a computed action name, so the audit catalogue gate can read both names.
export async function setMasterActive(session: string | undefined, kind: MasterKind, rowId: number, active: boolean, reason: string) {
  const t = table(kind);
  const i = id("id", rowId), a = bool("active", active), r = reasonOf(reason);
  const run = async (tx: Tx) => {
    const row = await lockMaster(tx, t, kind, i);
    if (row.active === a) throw already(a ? "active" : "inactive");
    await tx.$executeRaw`update ${t} set active = ${a} where id = ${i}`;
    return { before: { active: row.active }, after: { active: a } };
  };
  return (a
    ? adminWrite(session, { action: "catalogue.activate", permission: MANAGE, targetType: kind, targetId: String(i), reason: r }, run, (x) => x)
    : adminWrite(session, { action: "catalogue.deactivate", permission: MANAGE, targetType: kind, targetId: String(i), reason: r }, run, (x) => x)
  ).then(done);
}

// ---------- Courses (course master: docs/designs/course-master/course-master.md) ----------

export type DurationType = "MONTH" | "WEEK" | "DAY" | "NA";
export type CourseDetails = {
  displayName: string | null; department: string | null; durationType: DurationType | null;
  durationMonths: number | null; durationWeeks: number | null; durationDays: number | null; durationHours: number | null;
  capacity: number | null; examMinDays: number | null; sortOrder: number;
  visible: boolean; materialsRequired: boolean; marklistRequired: boolean; noRegFee: boolean; itMagic: boolean;
  keltron: boolean; internshipKeltron: boolean; selected: boolean; keltronShare: number | null;
};
type CourseKeys = { id: number; code: string; name: string; categoryId: number; divisionId: number; active: boolean };
type CourseRow = CourseKeys & CourseDetails;

// the column defaults of 0016
export const COURSE_DEFAULTS: CourseDetails = {
  displayName: null, department: null, durationType: null,
  durationMonths: null, durationWeeks: null, durationDays: null, durationHours: null,
  capacity: null, examMinDays: null, sortOrder: 0,
  visible: true, materialsRequired: false, marklistRequired: false, noRegFee: false, itMagic: false,
  keltron: false, internshipKeltron: false, selected: false, keltronShare: null,
};
const COURSE_KEYS = Object.keys(COURSE_DEFAULTS) as (keyof CourseDetails)[];
const FLAGS = ["visible", "materialsRequired", "marklistRequired", "noRegFee", "itMagic", "keltron", "internshipKeltron", "selected"] as const;
// [field, min, max, nullable]
const INTS = [["durationMonths", 0, 120], ["durationWeeks", 0, 520], ["durationDays", 0, 3650], ["durationHours", 0, 10000],
  ["capacity", 1, 100000], ["examMinDays", 0, 3650], ["sortOrder", 0, 100000]] as const;
const DURATION_TYPES: readonly string[] = ["MONTH", "WEEK", "DAY", "NA"];

// every audited read casts the share to float8: a raw numeric read is a Decimal and audits as a string
const COURSE_BASE = Prisma.sql`id, code, name, category_id as "categoryId", division_id as "divisionId", active,
  display_name as "displayName", department, duration_type as "durationType", duration_months as "durationMonths",
  duration_weeks as "durationWeeks", duration_days as "durationDays", duration_hours as "durationHours", capacity,
  exam_min_days as "examMinDays", sort_order as "sortOrder", visible, materials_required as "materialsRequired",
  marklist_required as "marklistRequired", no_reg_fee as "noRegFee", it_magic as "itMagic", keltron,
  internship_keltron as "internshipKeltron", selected`;
const COURSE_COLS = Prisma.sql`${COURSE_BASE}, keltron_share::float8 as "keltronShare"`;

function int(field: string, v: unknown, min: number, max: number, nullable: boolean): number | null {
  if (v === null) { if (nullable) return null; throw bad(`${field}: invalid`); }
  if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) throw bad(`${field}: ${min}-${max}`);
  return v as number;
}
function text(field: string, v: unknown, max: number): string | null {
  if (v === null) return null;
  const t = typeof v === "string" ? v.trim() : "";
  if (t.length < 1 || t.length > max) throw bad(`${field}: 1-${max} characters`);
  return t;
}
// two decimals, never rounded: a posted string is pattern-checked by the route (D2); a number from code passes within
// a tolerance, then is normalised so the audit records what the database stores (R9)
function share(v: unknown): number | null {
  if (v === null) return null;
  const x = v as number;
  if (typeof v !== "number" || !Number.isFinite(x) || x < 0 || x > 100 || Math.abs(x * 100 - Math.round(x * 100)) >= 1e-6) {
    throw bad("keltronShare: 0-100, two decimals");
  }
  return Math.round(x * 100) / 100;
}
/** Validates the given detail keys (absent = unchanged) and merges them onto base; merged: also checks Keltron and its share on the result. */
function details(u: Partial<Record<keyof CourseDetails, unknown>>, base: CourseDetails, merged = true): CourseDetails {
  const d: CourseDetails = { ...base };
  const has = (k: keyof CourseDetails) => Object.hasOwn(u, k) && u[k] !== undefined;
  if (has("displayName")) d.displayName = text("displayName", u.displayName, 200);
  if (has("department")) d.department = text("department", u.department, 100);
  if (has("durationType")) {
    const t = u.durationType;
    if (t !== null && (typeof t !== "string" || !DURATION_TYPES.includes(t))) throw bad("durationType: invalid");
    d.durationType = t as DurationType | null;
  }
  for (const [k, min, max] of INTS) if (has(k)) (d[k] as number | null) = int(k, u[k], min, max, k !== "sortOrder");
  for (const k of FLAGS) if (has(k)) d[k] = bool(k, u[k]);
  if (has("keltronShare")) d.keltronShare = share(u.keltronShare);
  if (!merged) return d;
  if (d.keltron && d.keltronShare === null) throw bad("keltronShare: required with Keltron");
  if (!d.keltron && d.keltronShare !== null) throw bad("keltronShare: only with Keltron");
  return d;
}
const pick = (r: CourseRow): CourseDetails => Object.fromEntries(COURSE_KEYS.map((k) => [k, r[k]])) as CourseDetails;

async function lockCourse(tx: Tx, rowId: number): Promise<CourseRow> {
  const [r] = await tx.$queryRaw<CourseRow[]>`select ${COURSE_COLS} from app.course where id = ${rowId} for update`;
  if (!r) throw new RbacError("notfound", "course not found");
  return r;
}

export async function createCourse(session: string | undefined,
  k: { code: string; name: string; categoryId: number; divisionId: number } & Partial<CourseDetails>) {
  const c = code(k.code), n = name(k.name), cat = id("categoryId", k.categoryId), div = id("divisionId", k.divisionId);
  const d = details(k, COURSE_DEFAULTS);
  return unique(() => adminWrite(session, { action: "catalogue.create", permission: MANAGE, targetType: "course" },
    async (tx) => {
      await liveRef(tx, TABLES.course_category, "categoryId", cat);
      await liveRef(tx, TABLES.course_division, "divisionId", div);
      return (await tx.$queryRaw<CourseRow[]>`insert into app.course (code, name, category_id, division_id, display_name, department,
          duration_type, duration_months, duration_weeks, duration_days, duration_hours, capacity, exam_min_days, sort_order,
          visible, materials_required, marklist_required, no_reg_fee, it_magic, keltron, internship_keltron, selected, keltron_share)
        values (${c}, ${n}, ${cat}, ${div}, ${d.displayName}, ${d.department}, ${d.durationType}, ${d.durationMonths}::int,
          ${d.durationWeeks}::int, ${d.durationDays}::int, ${d.durationHours}::int, ${d.capacity}::int, ${d.examMinDays}::int,
          ${d.sortOrder}::int, ${d.visible}, ${d.materialsRequired}, ${d.marklistRequired}, ${d.noRegFee}, ${d.itMagic},
          ${d.keltron}, ${d.internshipKeltron}, ${d.selected}, ${d.keltronShare}::numeric)
        returning ${COURSE_COLS}`)[0]!;
    }, (r) => ({ after: r }))).then((r) => ({ id: r.id, code: r.code }));
}

export async function updateCourse(session: string | undefined, rowId: number,
  u: Partial<{ name: string; categoryId: number; divisionId: number } & CourseDetails>) {
  const i = id("id", rowId);
  const n = u.name === undefined ? undefined : name(u.name);
  const cat = u.categoryId === undefined ? undefined : id("categoryId", u.categoryId);
  const div = u.divisionId === undefined ? undefined : id("divisionId", u.divisionId);
  details(u, COURSE_DEFAULTS, false); // field rules before any database access; Keltron on the merged row below
  return adminWrite(session, { action: "catalogue.update", permission: MANAGE, targetType: "course", targetId: String(i) },
    async (tx) => {
      const before = await lockCourse(tx, i);
      const d = details(u, pick(before));
      const after: CourseRow = { ...before, ...d, name: n ?? before.name, categoryId: cat ?? before.categoryId, divisionId: div ?? before.divisionId };
      if ((Object.keys(after) as (keyof CourseRow)[]).every((k) => after[k] === before[k])) throw bad("nothing to change");
      if (after.categoryId !== before.categoryId) await liveRef(tx, TABLES.course_category, "categoryId", after.categoryId);
      if (after.divisionId !== before.divisionId) await liveRef(tx, TABLES.course_division, "divisionId", after.divisionId);
      await tx.$executeRaw`update app.course set name = ${after.name}, category_id = ${after.categoryId}, division_id = ${after.divisionId},
          display_name = ${after.displayName}, department = ${after.department}, duration_type = ${after.durationType},
          duration_months = ${after.durationMonths}::int, duration_weeks = ${after.durationWeeks}::int,
          duration_days = ${after.durationDays}::int, duration_hours = ${after.durationHours}::int, capacity = ${after.capacity}::int,
          exam_min_days = ${after.examMinDays}::int, sort_order = ${after.sortOrder}::int, visible = ${after.visible},
          materials_required = ${after.materialsRequired}, marklist_required = ${after.marklistRequired}, no_reg_fee = ${after.noRegFee},
          it_magic = ${after.itMagic}, keltron = ${after.keltron}, internship_keltron = ${after.internshipKeltron},
          selected = ${after.selected}, keltron_share = ${after.keltronShare}::numeric
        where id = ${i}`;
      return { before, after };
    }, (r) => r).then(done);
}

export async function setCourseActive(session: string | undefined, rowId: number, active: boolean, reason: string) {
  const i = id("id", rowId), a = bool("active", active), r = reasonOf(reason);
  const run = async (tx: Tx) => {
    const row = await lockCourse(tx, i);
    if (row.active === a) throw already(a ? "active" : "inactive");
    await tx.$executeRaw`update app.course set active = ${a} where id = ${i}`;
    return { before: row, after: { ...row, active: a } }; // whole row (Z2)
  };
  return (a
    ? adminWrite(session, { action: "catalogue.activate", permission: MANAGE, targetType: "course", targetId: String(i), reason: r }, run, (x) => x)
    : adminWrite(session, { action: "catalogue.deactivate", permission: MANAGE, targetType: "course", targetId: String(i), reason: r }, run, (x) => x)
  ).then(done);
}

/** The centre classes a course may be sold at (DD-2). An inactive class may stay, but is never newly added (Z3). */
export async function setCourseClasses(session: string | undefined, courseId: number, classIds: number[]) {
  const i = id("id", courseId);
  if (!Array.isArray(classIds) || !classIds.every((x) => Number.isSafeInteger(x))) throw bad("classIds: invalid");
  const ids = [...classIds];
  if (new Set(ids).size !== ids.length) throw bad("classIds: duplicate");
  return adminWrite(session, { action: "catalogue.course.classes", permission: MANAGE, targetType: "course", targetId: String(i) },
    async (tx) => {
      await lockCourse(tx, i); // concurrent saves of one course run one after the other
      const current = await tx.$queryRaw<{ id: number; code: string }[]>`select k.id, k.code from app.course_centre_class cc
        join app.centre_class k on k.id = cc.centre_class_id where cc.course_id = ${i}`;
      const code = new Map(current.map((k) => [k.id, k.code]));
      const added = ids.filter((x) => !code.has(x));
      if (added.length > 0) {
        const live = await tx.$queryRaw<{ id: number; code: string }[]>`select id, code from app.centre_class
          where id = any (${added}::int[]) and active for share`;
        if (live.length !== added.length) throw bad("classIds: inactive or unknown");
        for (const k of live) code.set(k.id, k.code);
      }
      if (added.length === 0 && ids.length === current.length) throw bad("nothing to change");
      await tx.$executeRaw`delete from app.course_centre_class where course_id = ${i}`;
      await tx.$executeRaw`insert into app.course_centre_class (course_id, centre_class_id) select ${i}, unnest(${ids}::int[])`;
      const sorted = (xs: number[]) => xs.map((x) => code.get(x)!).sort();
      return { before: { classes: sorted(current.map((k) => k.id)) }, after: { classes: sorted(ids) } };
    }, (r) => r).then(done);
}

type Entry = { id: number; code: string; name: string; active: boolean };
export type CourseListRow = Pick<CourseRow, "id" | "code" | "name" | "displayName" | "categoryId" | "divisionId" | "active" | "visible"
  | "sortOrder" | "durationType" | "durationMonths" | "durationWeeks" | "durationDays" | "durationHours"> & { classes: string[] };

// picklist entries: active ones, plus those the given course uses (shown "(inactive)")
async function picklists(tx: Tx, courseId: number | null) {
  const keep = courseId ?? 0;
  return {
    categories: await tx.$queryRaw<Entry[]>`select id, code, name, active from app.course_category
      where active or id = (select category_id from app.course where id = ${keep}) order by code`,
    divisions: await tx.$queryRaw<Entry[]>`select id, code, name, active from app.course_division
      where active or id = (select division_id from app.course where id = ${keep}) order by code`,
    classes: await tx.$queryRaw<Entry[]>`select id, code, name, active from app.centre_class
      where active or id in (select centre_class_id from app.course_centre_class where course_id = ${keep}) order by code`,
  };
}
const canManage = async (tx: Tx) =>
  (await tx.$queryRaw<{ ok: boolean }[]>`select app.has_permission('catalogue.manage', null) as ok`)[0]!.ok;
const CLASS_CODES = (alias: Prisma.Sql) => Prisma.sql`coalesce((select array_agg(k.code order by k.code) from app.course_centre_class cc
  join app.centre_class k on k.id = cc.centre_class_id where cc.course_id = ${alias}.id), '{}') as classes`;

/** Every signed-in user may read the catalogue; the KELTRON share is never listed (DD-13). */
export async function listCourses(session: string | undefined, f: { categoryId?: number; divisionId?: number; active?: boolean; q?: string } = {}) {
  const q = (f.q ?? "").trim();
  const like = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
  return withScope(session, async (tx) => ({
    courses: await tx.$queryRaw<CourseListRow[]>`select co.id, co.code, co.name, co.display_name as "displayName",
        co.category_id as "categoryId", co.division_id as "divisionId", co.active, co.visible, co.sort_order as "sortOrder",
        co.duration_type as "durationType", co.duration_months as "durationMonths", co.duration_weeks as "durationWeeks",
        co.duration_days as "durationDays", co.duration_hours as "durationHours", ${CLASS_CODES(Prisma.sql`co`)}
      from app.course co where true
        ${Number.isSafeInteger(f.categoryId) ? Prisma.sql`and co.category_id = ${f.categoryId}` : Prisma.empty}
        ${Number.isSafeInteger(f.divisionId) ? Prisma.sql`and co.division_id = ${f.divisionId}` : Prisma.empty}
        ${typeof f.active === "boolean" ? Prisma.sql`and co.active = ${f.active}` : Prisma.empty}
        ${q ? Prisma.sql`and (co.code ilike ${like} or co.name ilike ${like} or co.display_name ilike ${like})` : Prisma.empty}
      order by co.sort_order, co.code`,
    ...(await picklists(tx, null)),
    canManage: await canManage(tx),
  }));
}

/** One course; the share only for catalogue managers (DD-13 revised). An unknown id is Forbidden (the page 404s). */
export async function getCourse(session: string | undefined, courseId: number) {
  return withScope(session, async (tx) => {
    if (!Number.isSafeInteger(courseId)) throw new Forbidden("course");
    const [course] = await tx.$queryRaw<(CourseRow & { classes: string[] })[]>`select ${COURSE_BASE},
        case when app.has_permission('catalogue.manage', null) then keltron_share::float8 end as "keltronShare",
        ${CLASS_CODES(Prisma.sql`course`)}
      from app.course where id = ${courseId}`;
    if (!course) throw new Forbidden("course");
    return { course, ...(await picklists(tx, courseId)), canManage: await canManage(tx) };
  });
}

/** For the home link: does this session hold catalogue.manage? */
export const canManageCatalogue = (session: string | undefined) => withScope(session, canManage);

const UNITS = [["durationMonths", "month"], ["durationWeeks", "week"], ["durationDays", "day"], ["durationHours", "hour"]] as const;
/** "6 months · 120 hours"; NA or no counts → "—" (DD-10). */
export function durationSummary(c: Pick<CourseDetails, "durationType" | "durationMonths" | "durationWeeks" | "durationDays" | "durationHours">): string {
  if (c.durationType === "NA") return "—";
  const parts = UNITS.flatMap(([k, unit]) => { const n = c[k]; return n ? [`${n} ${unit}${n === 1 ? "" : "s"}`] : []; });
  return parts.length ? parts.join(" · ") : "—";
}

// ---------- Academic years (R-028; dates are reference data, DD-6) ----------

export async function openAcademicYear(session: string | undefined, y: { code: string; startsOn: string; endsOn: string }) {
  const c = yearCode(y.code), s = date("startsOn", y.startsOn), e = date("endsOn", y.endsOn);
  datesOk(s, e);
  return unique(() => adminWrite(session, { action: "catalogue.create", permission: MANAGE, targetType: "academic_year", targetId: c },
    async (tx) => {
      await tx.$executeRaw`insert into app.academic_year (code, starts_on, ends_on) values (${c}, ${s}::date, ${e}::date)`;
      return { code: c, startsOn: s, endsOn: e, open: true };
    }, (r) => ({ after: r }))).then(() => ({ code: c }));
}

export async function updateAcademicYear(session: string | undefined, yc: string, u: { startsOn?: string; endsOn?: string }) {
  const c = yearCode(yc);
  const s = u.startsOn === undefined ? undefined : date("startsOn", u.startsOn);
  const e = u.endsOn === undefined ? undefined : date("endsOn", u.endsOn);
  return adminWrite(session, { action: "catalogue.update", permission: MANAGE, targetType: "academic_year", targetId: c },
    async (tx) => {
      const before = await lockYear(tx, c);
      const after = { ...before, startsOn: s ?? before.startsOn, endsOn: e ?? before.endsOn };
      if (after.startsOn === before.startsOn && after.endsOn === before.endsOn) throw bad("nothing to change");
      datesOk(after.startsOn, after.endsOn);
      await tx.$executeRaw`update app.academic_year set starts_on = ${after.startsOn}::date, ends_on = ${after.endsOn}::date where code = ${c}`;
      return { before, after };
    }, (r) => r).then(done);
}

export async function setAcademicYearOpen(session: string | undefined, yc: string, open: boolean, reason: string) {
  const c = yearCode(yc), o = bool("open", open), r = reasonOf(reason);
  const run = async (tx: Tx) => {
    const row = await lockYear(tx, c);
    if (row.open === o) throw already(o ? "open" : "closed");
    await tx.$executeRaw`update app.academic_year set open = ${o} where code = ${c}`;
    return { before: { open: row.open }, after: { open: o } };
  };
  return (o
    ? adminWrite(session, { action: "catalogue.activate", permission: MANAGE, targetType: "academic_year", targetId: c, reason: r }, run, (x) => x)
    : adminWrite(session, { action: "catalogue.deactivate", permission: MANAGE, targetType: "academic_year", targetId: c, reason: r }, run, (x) => x)
  ).then(done);
}
