// Centre master (FR-022 list, FR-022.02 view) and centre onboarding (docs/designs/centre-onboarding, WF3). Reads have two
// gates: RLS limits rows to the session's scope, and every row must also pass org.centre.view for that centre, or the
// session holds org.centre.manage at ALL scope (R4). Filters only narrow (T-SEC-005). Writes go through adminWrite on
// org.centre.manage (ALL scope, fresh step-up); the database adds RLS and centre_write_guard (0020).
import { Prisma } from "../../generated/prisma/client";
import { withScope, type Tx } from "./db";
import { bad, code, date, name, reasonOf } from "./catalogue";
import { ownText, phoneDigits } from "./details";
import { PersonError } from "./person-rules";
import { limitSearch } from "./rate-limit";
import { adminWrite, RbacError } from "./rbac";

export type CentreRow = { id: number; code: string; name: string; status: string; area: string; region: string };
export type CentreFilter = { regionIds?: number[]; areaIds?: number[]; centreIds?: number[]; q?: string };

const ints = (xs?: number[]) => (xs && xs.length ? xs.filter(Number.isSafeInteger) : null);
const MANAGE = "org.centre.manage";

// A search term counts against the search rate limit (T-SEC-015); a plain or filtered list does not.
export function listCentres(session: string | undefined, f: CentreFilter = {}): Promise<CentreRow[]> {
  return withScope(session, async (tx) => {
    if (f.q?.trim()) await limitSearch(tx);
    return tx.$queryRaw<CentreRow[]>`
    select c.id, c.code, c.name, c.status::text, a.name as area, r.code as region
    from app.centre c join app.area a on a.id = c.area_id join app.region r on r.id = a.region_id
    where (c.id in (select unnest(app.scoped_centre_ids('org.centre.view'))) -- scope computed once, hash join
           or app.has_permission('org.centre.manage', null))
      and (${ints(f.regionIds)}::int[] is null or r.id = any (${ints(f.regionIds)}::int[]))
      and (${ints(f.areaIds)}::int[] is null or a.id = any (${ints(f.areaIds)}::int[]))
      and (${ints(f.centreIds)}::int[] is null or c.id = any (${ints(f.centreIds)}::int[]))
      and (${f.q?.trim() || null}::text is null or c.code ilike '%' || ${f.q?.trim() ?? ""} || '%' or c.name ilike '%' || ${f.q?.trim() ?? ""} || '%')
    order by c.code`;
  });
}

export type CentreView = CentreRow & { areaId: number; classCode: string | null; email: string | null; phone: string | null;
  address: string | null; category: string | null; gstEnabled: boolean; gstSupply: string | null; gstin: string | null;
  ownership: string | null; agreementFrom: string | null; agreementTo: string | null; openedOn: string | null; canManage: boolean };

/** null for missing, out-of-scope and forbidden alike, so callers answer 404 in every case (T-SEC-001). */
export function getCentre(session: string | undefined, id: number): Promise<CentreView | null> {
  if (!Number.isSafeInteger(id)) return Promise.resolve(null);
  return withScope(session, async (tx) => (await tx.$queryRaw<CentreView[]>`
    select c.id, c.code, c.name, c.status::text, a.name as area, r.code as region, c.area_id as "areaId", k.code as "classCode",
           c.email, c.phone, c.address, c.category, c.gst_enabled as "gstEnabled", c.gst_supply as "gstSupply", c.gstin,
           c.ownership, c.agreement_from::text as "agreementFrom", c.agreement_to::text as "agreementTo",
           c.opened_on::text as "openedOn", app.has_permission('org.centre.manage', null) as "canManage"
    from app.centre c join app.area a on a.id = c.area_id join app.region r on r.id = a.region_id
      left join app.centre_class k on k.id = c.centre_class_id
    where c.id = ${id} and (app.has_permission('org.centre.view', c.id) or app.has_permission('org.centre.manage', null))`)[0] ?? null);
}

// ---------- Centre onboarding: validation (before any database access) ----------

export type CentreInput = { code: string; name: string; areaId: number; email?: string | null; phone: string; address?: string | null;
  category?: "SCHOOL" | "COLLEGE" | null; gstEnabled: boolean; gstSupply?: "STATE" | "INTERSTATE" | null; gstin?: string | null;
  ownership?: "FRANCHISE" | "OWN" | null; agreementFrom?: string | null; agreementTo?: string | null; openedOn?: string | null };
export type CentreChanges = Partial<Omit<CentreInput, "code" | "phone">> & { phone?: string | null };

type Fields = { name: string; areaId: number; email: string | null; phone: string | null; address: string | null; category: string | null;
  gstEnabled: boolean; gstSupply: string | null; gstin: string | null; ownership: string | null; agreementFrom: string | null;
  agreementTo: string | null; openedOn: string | null };
const COLUMN: Record<keyof Fields, string> = { name: "name", areaId: "area_id", email: "email", phone: "phone", address: "address",
  category: "category", gstEnabled: "gst_enabled", gstSupply: "gst_supply", gstin: "gstin", ownership: "ownership",
  agreementFrom: "agreement_from", agreementTo: "agreement_to", openedOn: "opened_on" };
const ORDER: (keyof Fields)[] = ["name", "areaId", "email", "phone", "address", "category", "gstSupply", "gstin", "ownership",
  "agreementFrom", "agreementTo", "openedOn", "gstEnabled"]; // the message order (C6)
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/; // PMC

// a PersonError from the shared field helpers becomes this module's RbacError (R5)
const rb = <T>(run: () => T): T => { try { return run(); } catch (e) { if (e instanceof PersonError) throw bad(e.message); throw e; } };
const oneOf = (field: string, list: readonly string[]) => (v: unknown) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !list.includes(v)) throw bad(`${field}: one of the listed values`);
  return v;
};
const RULES: Record<keyof Fields, (v: unknown) => unknown> = {
  name: (v) => name(v),
  areaId: (v) => { if (!Number.isSafeInteger(v) || (v as number) < 1) throw bad("areaId: unknown"); return v; },
  email: (v) => {
    if (v == null) return null;
    const s = typeof v === "string" ? v.trim() : "";
    if (s === "") return null; // R13
    if (s.split("@").length !== 2) throw bad("email: one @");
    if (s.length > 200) throw bad("email: at most 200");
    return s;
  },
  phone: (v) => (v == null || v === "" ? null : typeof v === "string" ? rb(() => phoneDigits("phone", v)) : (() => { throw bad("phone: 10 digits"); })()),
  address: (v) => rb(() => ownText("address", v, 500, true)),
  category: oneOf("category", ["SCHOOL", "COLLEGE"]),
  gstSupply: oneOf("gstSupply", ["STATE", "INTERSTATE"]),
  gstin: (v) => {
    if (v == null || v === "") return null;
    const s = typeof v === "string" ? v.trim().toUpperCase() : "";
    if (!GSTIN.test(s)) throw bad("gstin: 15 characters, GSTIN format");
    return s;
  },
  ownership: oneOf("ownership", ["FRANCHISE", "OWN"]),
  agreementFrom: (v) => (v == null || v === "" ? null : date("agreementFrom", v)),
  agreementTo: (v) => (v == null || v === "" ? null : date("agreementTo", v)),
  openedOn: (v) => (v == null || v === "" ? null : date("openedOn", v)),
  gstEnabled: (v) => { if (typeof v !== "boolean") throw bad("gstEnabled: invalid"); return v; },
};
/** Validates the given keys in the message order; absent keys are not returned. */
function validate(u: Record<string, unknown>): Partial<Fields> {
  const out: Partial<Fields> = {};
  for (const k of ORDER) if (Object.hasOwn(u, k) && u[k] !== undefined) (out as Record<string, unknown>)[k] = RULES[k](u[k]);
  return out;
}
/** The rules on the merged row (C6, D5): GST combination, the GST-while-active rule, the agreement dates. */
function merged(f: Fields, active: boolean) {
  if (!f.gstEnabled) {
    if (f.gstSupply !== null) throw bad("gstSupply: only with GST");
    if (f.gstin !== null) throw bad("gstin: only with GST");
  } else if (active) {
    if (f.gstSupply === null) throw bad("gstSupply: required while active");
    if (f.gstin === null) throw bad("gstin: required while active");
  }
  if (f.agreementFrom && f.agreementTo && f.agreementTo < f.agreementFrom) throw bad("agreementTo: not before agreementFrom");
}

// 23505 by constraint name, inside the callback: adminWrite's db() would turn every 23505 into the generic duplicate (I1)
const DUPLICATE: Record<string, [string, string]> = {
  centre_code_key: ["org.centre.duplicate", "a centre with that code already exists"],
  region_code_key: ["org.region.duplicate", "a region with that code already exists"],
  area_region_id_name_key: ["org.area.duplicate", "that region already has an area with that name"],
};
async function centreDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const cause = (e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } }).meta?.driverAdapterError?.cause;
    const constraint = /constraint "([^"]+)"/.exec(cause?.originalMessage ?? "")?.[1];
    if (cause?.originalCode === "23505" && constraint && Object.hasOwn(DUPLICATE, constraint)) {
      const [key, message] = DUPLICATE[constraint]!;
      throw new RbacError("duplicate", message, key);
    }
    throw e;
  }
}
async function areaExists(tx: Tx, areaId: number) {
  const [r] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from app.area where id = ${areaId}`;
  if (!r) throw bad("areaId: unknown");
}
const sqlValue = (k: keyof Fields, v: unknown) =>
  (k === "agreementFrom" || k === "agreementTo" || k === "openedOn") ? Prisma.sql`${v}::date` : Prisma.sql`${v}`;
const FIELD_COLS = Prisma.raw(`name, area_id as "areaId", email, phone, address, category, gst_enabled as "gstEnabled",
  gst_supply as "gstSupply", gstin, ownership, agreement_from::text as "agreementFrom", agreement_to::text as "agreementTo",
  opened_on::text as "openedOn"`);

// ---------- Centre onboarding: writes ----------

export async function createCentre(session: string | undefined, input: CentreInput): Promise<{ id: number; code: string }> {
  const c = code(input?.code);
  const f = validate(input as unknown as Record<string, unknown>);
  if (f.phone == null) throw bad("phone: required"); // DD-1
  const row: Fields = { email: null, address: null, category: null, gstSupply: null, gstin: null, ownership: null, agreementFrom: null,
    agreementTo: null, openedOn: null, gstEnabled: false, ...f } as Fields;
  merged(row, false);
  // the id first (R1): adminWrite fixes its audit target before the callback; the insert cannot return the row, which the
  // select policy's scope snapshot does not yet contain (Z2)
  const id = await withScope(session, async (tx) => (await tx.$queryRaw<{ id: number }[]>`select nextval('app.centre_id_seq')::int as id`)[0]!.id);
  return adminWrite(session, { action: "org.centre.create", permission: "org.centre.manage", targetType: "centre", targetId: String(id) },
    (tx) => centreDb(async () => {
      await areaExists(tx, row.areaId);
      const keys = Object.keys(COLUMN) as (keyof Fields)[];
      await tx.$executeRaw`insert into app.centre (id, code, ${Prisma.join(keys.map((k) => Prisma.raw(COLUMN[k])))})
        values (${id}, ${c}, ${Prisma.join(keys.map((k) => sqlValue(k, row[k])))})`;
      return { id, code: c };
    }), (r) => ({ after: { code: r.code, ...row, status: "INACTIVE" } }));
}

export async function updateCentre(session: string | undefined, id: number, changes: CentreChanges): Promise<void> {
  if (!Number.isSafeInteger(id)) throw new RbacError("notfound", "centre not found");
  const f = validate(changes as Record<string, unknown>);
  let diff: [keyof Fields, unknown, unknown][] = [];
  return adminWrite(session, { action: "org.centre.update", permission: "org.centre.manage", targetType: "centre", targetId: String(id) },
    (tx) => centreDb(async () => {
      const [cur] = await tx.$queryRaw<(Fields & { status: string })[]>`select ${FIELD_COLS}, status::text from app.centre
        where id = ${id} for no key update`;
      if (!cur) throw new RbacError("notfound", "centre not found");
      if (Object.hasOwn(f, "phone") && f.phone == null && cur.phone != null) throw bad("phone: required"); // a set phone stays (Z7)
      const next = { ...cur, ...f } as Fields;
      merged(next, cur.status === "ACTIVE");
      diff = (Object.keys(f) as (keyof Fields)[]).filter((k) => String(cur[k] ?? "") !== String(next[k] ?? "")).map((k) => [k, cur[k], next[k]]);
      if (diff.length === 0) throw bad("nothing to change");
      if (diff.some(([k]) => k === "areaId")) await areaExists(tx, next.areaId);
      await tx.$executeRaw`update app.centre set ${Prisma.join(diff.map(([k, , v]) => Prisma.sql`${Prisma.raw(COLUMN[k])} = ${sqlValue(k, v)}`))}
        where id = ${id}`;
    }), () => ({ before: Object.fromEntries(diff.map(([k, b]) => [k, b])), after: Object.fromEntries(diff.map(([k, , a]) => [k, a])) }));
}

// Two calls with literal actions, so the audit catalogue gate can read both names (as setMasterActive).
export async function setCentreActive(session: string | undefined, id: number, active: boolean, reason: string): Promise<void> {
  if (!Number.isSafeInteger(id)) throw new RbacError("notfound", "centre not found");
  if (typeof active !== "boolean") throw bad("active: invalid");
  const r = reasonOf(reason);
  const run = async (tx: Tx) => {
    const [row] = await tx.$queryRaw<{ status: string; classId: number | null; gstEnabled: boolean; gstSupply: string | null; gstin: string | null }[]>`
      select status::text, centre_class_id as "classId", gst_enabled as "gstEnabled", gst_supply as "gstSupply", gstin
      from app.centre where id = ${id} for no key update`;
    if (!row) throw new RbacError("notfound", "centre not found");
    const target = active ? "ACTIVE" : "INACTIVE";
    if (row.status === target) throw bad(`already ${active ? "active" : "inactive"}`);
    // the checklist (DD-2): a class, and complete GST details when GST is enabled
    if (active && (row.classId === null || (row.gstEnabled && (row.gstSupply === null || row.gstin === null)))) {
      throw new RbacError("invalid", "status: checklist", "org.centre.checklist");
    }
    await tx.$executeRaw`update app.centre set status = ${target}::app."CentreStatus" where id = ${id}`;
    // a centre activated here gets its receipt series for this financial year, at 0 (fee-receipts DD-4 rule b);
    // legacy centres are seeded at cutover by an upsert that never lowers a counter (NP-8)
    if (active) await tx.$executeRaw`insert into app.number_series (centre_id, doc_type, period, gap_rule)
      values (${id}, 'FEEREC', app.financial_year((now() at time zone 'Asia/Kolkata')::date), 'GAPLESS'::app."GapRule")
      on conflict do nothing`;
    return { before: { status: row.status }, after: { status: target } };
  };
  return (active
    ? adminWrite(session, { action: "org.centre.activate", permission: "org.centre.manage", targetType: "centre", targetId: String(id), reason: r }, run, (x) => x)
    : adminWrite(session, { action: "org.centre.deactivate", permission: "org.centre.manage", targetType: "centre", targetId: String(id), reason: r }, run, (x) => x)
  ).then(() => undefined);
}

// ---------- Regions and areas (DD-4: add and rename; areas never move between regions) ----------

export const geoName = (v: unknown) => {
  const n = typeof v === "string" ? v.trim() : "";
  if (n.length < 1 || n.length > 100) throw bad("name: 1-100 characters");
  return n;
};
const geoId = (field: string, v: unknown) => { if (!Number.isSafeInteger(v) || (v as number) < 1) throw bad(`${field}: unknown`); return v as number; };

export async function createRegion(session: string | undefined, g: { code: string; name: string }): Promise<{ id: number }> {
  const c = code(g?.code), n = geoName(g?.name);
  return adminWrite(session, { action: "org.region.create", permission: MANAGE, targetType: "region" },
    (tx) => centreDb(async () => (await tx.$queryRaw<{ id: number; code: string; name: string }[]>`
      insert into app.region (code, name) values (${c}, ${n}) returning id, code, name`)[0]!),
    (r) => ({ after: r })).then((r) => ({ id: r.id }));
}

export async function updateRegion(session: string | undefined, id: number, g: { name: string }): Promise<void> {
  const i = geoId("id", id), n = geoName(g?.name);
  return adminWrite(session, { action: "org.region.update", permission: MANAGE, targetType: "region", targetId: String(i) },
    async (tx) => {
      const [cur] = await tx.$queryRaw<{ name: string }[]>`select name from app.region where id = ${i} for no key update`; // R12
      if (!cur) throw new RbacError("notfound", "region not found");
      if (cur.name === n) throw bad("nothing to change");
      await tx.$executeRaw`update app.region set name = ${n} where id = ${i}`;
      return { before: { name: cur.name }, after: { name: n } };
    }, (x) => x).then(() => undefined);
}

export async function createArea(session: string | undefined, g: { regionId: number; name: string }): Promise<{ id: number }> {
  const rid = geoId("regionId", g?.regionId), n = geoName(g?.name);
  return adminWrite(session, { action: "org.area.create", permission: MANAGE, targetType: "area" },
    (tx) => centreDb(async () => {
      const [ok] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from app.region where id = ${rid}`;
      if (!ok) throw bad("regionId: unknown");
      return (await tx.$queryRaw<{ id: number; regionId: number; name: string }[]>`insert into app.area (region_id, name)
        values (${rid}, ${n}) returning id, region_id as "regionId", name`)[0]!;
    }), (r) => ({ after: r })).then((r) => ({ id: r.id }));
}

export async function updateArea(session: string | undefined, id: number, g: { name: string }): Promise<void> {
  const i = geoId("id", id), n = geoName(g?.name);
  return adminWrite(session, { action: "org.area.update", permission: MANAGE, targetType: "area", targetId: String(i) },
    (tx) => centreDb(async () => {
      const [cur] = await tx.$queryRaw<{ name: string }[]>`select name from app.area where id = ${i} for no key update`;
      if (!cur) throw new RbacError("notfound", "area not found");
      if (cur.name === n) throw bad("nothing to change");
      await tx.$executeRaw`update app.area set name = ${n} where id = ${i}`;
      return { before: { name: cur.name }, after: { name: n } };
    }), (x) => x).then(() => undefined);
}

/** For the "New centre" and "Regions and areas" links. */
export const canManageCentres = (session: string | undefined) => withScope(session, async (tx) =>
  (await tx.$queryRaw<{ ok: boolean }[]>`select app.has_permission('org.centre.manage', null) as ok`)[0]!.ok);

/** Regions and areas for every signed-in user (select is open); canManage for the forms. */
export const listGeography = (session: string | undefined) => withScope(session, async (tx) => ({
  regions: await tx.$queryRaw<{ id: number; code: string; name: string }[]>`select id, code, name from app.region order by code`,
  areas: await tx.$queryRaw<{ id: number; regionId: number; name: string; regionCode: string }[]>`select a.id, a.region_id as "regionId",
    a.name, r.code as "regionCode" from app.area a join app.region r on r.id = a.region_id order by r.code, a.name`,
  canManage: (await tx.$queryRaw<{ ok: boolean }[]>`select app.has_permission('org.centre.manage', null) as ok`)[0]!.ok,
}));
