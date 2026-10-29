// Centre and catalogue skeleton, Stage 2 (docs/designs/catalogue-skeleton/catalogue-skeleton.md). Every write goes
// through adminWrite: catalogue.manage at ALL scope, fresh step-up, before/after audited. The tables' RLS write policy
// re-checks catalogue.manage in the database (0012). Codes never change and rows are never deleted.
import { Prisma } from "../../generated/prisma/client";
import { type Tx } from "./db";
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
type CourseRow = { id: number; code: string; name: string; categoryId: number; divisionId: number; active: boolean };
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
async function lockCourse(tx: Tx, rowId: number): Promise<CourseRow> {
  const [r] = await tx.$queryRaw<CourseRow[]>`select id, code, name, category_id as "categoryId", division_id as "divisionId", active
    from app.course where id = ${rowId} for update`;
  if (!r) throw new RbacError("notfound", "course not found");
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

// ---------- Courses ----------

export async function createCourse(session: string | undefined, k: { code: string; name: string; categoryId: number; divisionId: number }) {
  const c = code(k.code), n = name(k.name), cat = id("categoryId", k.categoryId), div = id("divisionId", k.divisionId);
  return unique(() => adminWrite(session, { action: "catalogue.create", permission: MANAGE, targetType: "course" },
    async (tx) => {
      await liveRef(tx, TABLES.course_category, "categoryId", cat);
      await liveRef(tx, TABLES.course_division, "divisionId", div);
      return (await tx.$queryRaw<CourseRow[]>`insert into app.course (code, name, category_id, division_id)
        values (${c}, ${n}, ${cat}, ${div}) returning id, code, name, category_id as "categoryId", division_id as "divisionId", active`)[0]!;
    }, (r) => ({ after: r }))).then((r) => ({ id: r.id, code: r.code }));
}

export async function updateCourse(session: string | undefined, rowId: number, u: { name?: string; categoryId?: number; divisionId?: number }) {
  const i = id("id", rowId);
  const n = u.name === undefined ? undefined : name(u.name);
  const cat = u.categoryId === undefined ? undefined : id("categoryId", u.categoryId);
  const div = u.divisionId === undefined ? undefined : id("divisionId", u.divisionId);
  return adminWrite(session, { action: "catalogue.update", permission: MANAGE, targetType: "course", targetId: String(i) },
    async (tx) => {
      const before = await lockCourse(tx, i);
      const after = { ...before, name: n ?? before.name, categoryId: cat ?? before.categoryId, divisionId: div ?? before.divisionId };
      if (after.name === before.name && after.categoryId === before.categoryId && after.divisionId === before.divisionId) throw bad("nothing to change");
      if (after.categoryId !== before.categoryId) await liveRef(tx, TABLES.course_category, "categoryId", after.categoryId);
      if (after.divisionId !== before.divisionId) await liveRef(tx, TABLES.course_division, "divisionId", after.divisionId);
      await tx.$executeRaw`update app.course set name = ${after.name}, category_id = ${after.categoryId}, division_id = ${after.divisionId}
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
    return { before: { active: row.active }, after: { active: a } };
  };
  return (a
    ? adminWrite(session, { action: "catalogue.activate", permission: MANAGE, targetType: "course", targetId: String(i), reason: r }, run, (x) => x)
    : adminWrite(session, { action: "catalogue.deactivate", permission: MANAGE, targetType: "course", targetId: String(i), reason: r }, run, (x) => x)
  ).then(done);
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
