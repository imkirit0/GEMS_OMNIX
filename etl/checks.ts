// Reconciliation checks K1-K11 and run status (design: "Checks and Outputs"; C-03.3).
import type pg from "pg";
import { normCode as norm } from "../src/server/people";
import type { Ctx, Disposition, RawRow, Result, Rule } from "./types";

export type Check = { check: string; scope: Record<string, unknown>; expected: number | null; actual: number | null; passed: boolean | null; detail: Record<string, unknown> };
export type KeyMapRow = { entity: string; source_key: string; disposition: Disposition; target_table: string | null; target_id: string | null; survivor_target_id: string | null; reason: string | null };

/** Strictness: undeclared entity, undeclared disposition, or a missing result. Any violation is fatal. */
export function validateResults(rule: Pick<Rule, "id" | "entities" | "dispositions">, rows: RawRow[], results: Map<string, Record<string, Result>>): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const r = results.get(row.source_key);
    for (const e of rule.entities) if (!r?.[e]) out.push(`${rule.id}: no ${e} result for ${row.source_key}`);
    for (const [e, res] of Object.entries(r ?? {})) {
      if (!rule.entities.includes(e)) out.push(`${rule.id}: undeclared entity ${e} for ${row.source_key}`);
      else if (!rule.dispositions[e]!.includes(res.disposition)) out.push(`${rule.id}: undeclared disposition ${res.disposition} for ${e} ${row.source_key}`);
    }
  }
  return out;
}

/** K5: each SPLIT key has the target count its rule declares. */
export function k5(rows: KeyMapRow[], cardinality: Record<string, number>): Check[] {
  return Object.keys(cardinality).map((entity) => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.entity === entity && r.disposition === "SPLIT") counts.set(r.source_key, (counts.get(r.source_key) ?? 0) + 1);
    const ok = [...counts.values()].filter((n) => n === cardinality[entity]).length;
    return { check: "K5", scope: { entity }, expected: counts.size, actual: ok, passed: ok === counts.size, detail: {} };
  });
}

export type StatusInput = { mode: "dry" | "cutover"; fatal: boolean; checks: Check[]; rejected: number; unparsedNumbers: unknown[]; laterYearNumbers: unknown[] };
export function runStatus(s: StatusInput): "PASSED" | "FAILED" {
  if (s.fatal || s.checks.some((c) => c.passed === false)) return "FAILED";
  if (s.mode === "cutover" && (s.checks.some((c) => c.passed !== true) || s.rejected > 0 || s.unparsedNumbers.length || s.laterYearNumbers.length)) return "FAILED";
  return "PASSED";
}

const ENTITY_TABLE: Record<string, string> = { centre: "legacy_centre", person: "legacy_admission", admission: "legacy_admission", registration: "legacy_course_row" };
const TARGET_TABLES = ["app.person", "app.admission", "app.registration"];

/** K1-K6 and the not-applicable rows, computed from the stored key map and the database. */
export async function computeChecks(db: pg.Client, runId: string, rules: Rule[], raw: Record<string, RawRow[]>, ctx: Ctx): Promise<Check[]> {
  const { rows: km } = await db.query<KeyMapRow>(`select entity, source_key, disposition, target_table, target_id, survivor_target_id, reason
    from migration.key_map where run_id = $1`, [runId]);
  const checks: Check[] = [];
  const admissionByKey = new Map(raw["legacy_admission"]!.map((r) => [r.source_key, r]));
  const scopeOf = (entity: string, row: RawRow) => {
    if (entity === "centre") return { centre: norm(row["code"]), academic_year: null };
    const a = entity === "registration" ? admissionByKey.get((row["admission_key"] ?? "").trim()) : row;
    return { centre: a ? norm(a["centre_code"]) : null, academic_year: a ? a["academic_year"] ?? null : null };
  };
  for (const entity of Object.keys(ENTITY_TABLE)) {
    const rows = raw[ENTITY_TABLE[entity]!]!;
    const mine = km.filter((r) => r.entity === entity);
    // K1 coverage
    checks.push({ check: "K1", scope: { entity }, expected: rows.length, actual: new Set(mine.map((r) => r.source_key)).size,
      passed: rows.length === new Set(mine.map((r) => r.source_key)).size, detail: {} });
    // K2 balance per entity, centre, year: non-SPLIT rows count each, a SPLIT key once
    const byKey = new Map<string, KeyMapRow[]>();
    for (const r of mine) byKey.set(r.source_key, [...(byKey.get(r.source_key) ?? []), r]);
    const scopes = new Map<string, { scope: Record<string, unknown>; expected: number; actual: number; byDisposition: Record<string, number>; mixed: boolean }>();
    for (const row of rows) {
      const scope = { entity, ...scopeOf(entity, row) };
      const id = JSON.stringify(scope);
      const s = scopes.get(id) ?? { scope, expected: 0, actual: 0, byDisposition: {} as Record<string, number>, mixed: false };
      s.expected++;
      const entries = byKey.get(row.source_key) ?? [];
      const split = entries.filter((e) => e.disposition === "SPLIT");
      s.actual += entries.length - split.length + (split.length ? 1 : 0);
      if (split.length && split.length !== entries.length) s.mixed = true;
      for (const e of entries) s.byDisposition[e.disposition] = (s.byDisposition[e.disposition] ?? 0) + 1;
      scopes.set(id, s);
    }
    for (const s of scopes.values()) checks.push({ check: "K2", scope: s.scope, expected: s.expected, actual: s.actual,
      passed: s.expected === s.actual && !s.mixed, detail: { dispositions: s.byDisposition } });
  }
  // K3 provenance, both directions
  for (const t of TARGET_TABLES) {
    const ids = km.filter((r) => r.target_table === t && (r.disposition === "IMPORTED" || r.disposition === "SPLIT")).map((r) => r.target_id!);
    const [{ total, mapped, missing }] = (await db.query(`select (select count(*)::int from ${t}) total,
      (select count(*)::int from ${t} x where x.id::text = any($1::text[])) mapped,
      (select count(*)::int from unnest($1::text[]) i where not exists (select 1 from ${t} x where x.id::text = i)) missing`, [ids])).rows;
    checks.push({ check: "K3", scope: { table: t }, expected: total, actual: mapped, passed: total === mapped && missing === 0, detail: { missing } });
  }
  // K4 merge integrity; every person has at least one admission
  for (const entity of ["person"]) {
    const imported = new Set(km.filter((r) => r.entity === entity && r.disposition === "IMPORTED").map((r) => r.target_id));
    const merged = km.filter((r) => r.entity === entity && r.disposition === "MERGED");
    const surv = merged.map((r) => r.survivor_target_id).filter((x): x is string => !!x);
    const { rows: [{ found }] } = await db.query(`select count(*)::int found from app.person where id::text = any($1::text[])`, [[...new Set(surv)]]);
    const ok = merged.filter((r) => r.survivor_target_id && imported.has(r.survivor_target_id)).length;
    const { rows: [{ lonely }] } = await db.query(`select count(*)::int lonely from app.person p where not exists (select 1 from app.admission a where a.person_id = p.id)`);
    checks.push({ check: "K4", scope: { entity }, expected: merged.length, actual: ok,
      passed: ok === merged.length && found === new Set(surv).size && lonely === 0, detail: { personsWithoutAdmission: lonely } });
  }
  // K5 split integrity
  for (const rule of rules) checks.push(...k5(km, rule.splitCardinality ?? {}).map((c) => ({ ...c, scope: { rule: rule.id, ...c.scope } })));
  // K6 referential: every source orphan is REJECTED with a reason; every target foreign key validated
  const disp = new Map(km.map((r) => [`${r.entity}|${r.source_key}`, r]));
  for (const rule of rules) {
    for (const [entity, parent] of Object.entries(rule.parent ?? {})) {
      let expected = 0, actual = 0;
      for (const row of raw[rule.sourceTable]!) {
        const p = parent(row, ctx);
        const pd = p ? disp.get(`${p.entity}|${p.sourceKey}`)?.disposition : undefined;
        if (pd === "IMPORTED") continue;
        expected++;
        const mine = disp.get(`${entity}|${row.source_key}`);
        if (mine?.disposition === "REJECTED" && mine.reason) actual++;
      }
      const { rows: [{ unvalidated }] } = await db.query(`select count(*)::int unvalidated from pg_constraint
        where contype = 'f' and not convalidated and conrelid in ('app.person'::regclass, 'app.admission'::regclass, 'app.registration'::regclass)`);
      checks.push({ check: "K6", scope: { entity }, expected, actual, passed: expected === actual && unvalidated === 0, detail: { unvalidatedForeignKeys: unvalidated } });
    }
  }
  for (const k of ["K7", "K8", "K10", "K11"]) checks.push({ check: k, scope: {}, expected: null, actual: null, passed: null, detail: { reason: "not applicable in Stage 2" } });
  return checks;
}
