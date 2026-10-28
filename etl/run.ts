// Migration runner, steps 0-7 (docs/designs/migration-framework/migration-framework.md, "Components").
// Connects as gems_etl (ETL_DATABASE_URL). Stage 2: called from tests/etl.test.ts only (DD-11).
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { academicYearOk, IDENTITY_KEYS, identityField, isoDate, PERSON_POLICY, PersonError,
  type StoredIdentity } from "../src/server/people";
import { canonicalRow, codeHash, digest, fingerprint, inputHash, RAW_TABLES, sha256 } from "./canonical";
import { computeChecks, runStatus, validateResults, type Check } from "./checks";
import { buildFixture } from "./fixture";
import { uuidv5 } from "./ids";
import { admission } from "./rules/admission";
import { centre } from "./rules/centre";
import { registration } from "./rules/registration";
import { SOURCE_SYSTEM, type Ctx, type RawRow, type Result, type Rule, type RuleError } from "./types";

/** The fixed rule registry: each rule with its file, which (with people.ts and ids.ts) forms its code hash. */
export const RULES: { rule: Rule; file: string }[] = [
  { rule: centre, file: "etl/rules/centre.ts" },
  { rule: admission, file: "etl/rules/admission.ts" },
  { rule: registration, file: "etl/rules/registration.ts" },
];

export type RunOptions = {
  mode: "dry" | "cutover"; asOf: string; seedYears?: string[];
  legacyCurrent?: { REGISTER?: bigint; ADMISSION?: Record<string, bigint> }; artifactDir?: string;
};
export type RunResult = { runId: string; status: "PASSED" | "FAILED"; digest: string | null; checks: Check[]; artifactPaths: string[]; errors: string[] };
export class RunRefused extends Error {
  override name = "RunRefused";
  constructor(readonly reasons: string[]) { super(reasons.join("; ")); }
}

const BATCH = 1000;
const IDENTITY_COLUMN: Record<string, string> = { givenName: "first_name", familyName: "last_name", dateOfBirth: "dob", mobile: "mobile" };
const blankToNull = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v);

async function insertRows(db: pg.Client, sql: string, rows: unknown[]) {
  for (let i = 0; i < rows.length; i += BATCH) await db.query(sql, [JSON.stringify(rows.slice(i, i + BATCH))]);
}

async function audit(db: pg.Client, action: "migration.run.start" | "migration.run.finish", outcome: "OK" | "FAILED", runId: string, detail: object) {
  await db.query(`insert into app.audit_log (action, outcome, actor_kind, target_type, target_id, actor_roles, actor_scope, detail)
    values ($1, $2::app."AuditOutcome", $3, 'migration.run', $4, '{}', '{}', app.redact($5::jsonb))`,
    [action, outcome, `migration:${runId}`, runId, JSON.stringify(detail)]);
}

/** Admission No → (year, sequence) by PERSON_POLICY.admissionPrefix (DD-9); null when it does not parse. */
function parseAdmissionNo(no: string, academicYear: string | null): { year: string; seq: bigint } | null {
  const candidates = [] as string[];
  if (academicYear && academicYearOk(academicYear)) candidates.push(academicYear);
  const m = /^GTEC(\d{2})(\d{2})/.exec(no);
  if (m) candidates.push(`20${m[1]}-${m[2]}`);
  for (const y of candidates) {
    const prefix = PERSON_POLICY.admissionPrefix(y);
    if (no.startsWith(prefix) && /^\d+$/.test(no.slice(prefix.length))) return { year: y, seq: BigInt(no.slice(prefix.length)) };
  }
  return null;
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const url = process.env["ETL_DATABASE_URL"];
  const salt = process.env["ETL_SALT"];
  if (!url || !salt) throw new Error("ETL_DATABASE_URL and ETL_SALT must be set");
  const seedYears = opts.seedYears ?? ["2026-27"];
  const artifactDir = opts.artifactDir ?? "evidence";
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query(`set timezone = 'UTC'`);
    // ---------- 0. preflight ----------
    await db.query(`select pg_advisory_lock(hashtext('gems.etl.run'))`);
    const reasons: string[] = [];
    if (opts.mode !== "dry" && opts.mode !== "cutover") reasons.push("mode must be dry or cutover");
    try { isoDate("asOf", opts.asOf); } catch { reasons.push("asOf must be YYYY-MM-DD"); }
    if (seedYears.some((y) => !academicYearOk(y))) reasons.push("seedYears must be YYYY-YY");
    const [empty] = (await db.query(`select (select count(*) from migration.run) + (select count(*) from raw.legacy_centre)
      + (select count(*) from raw.legacy_admission) + (select count(*) from raw.legacy_course_row) + (select count(*) from app.person)
      + (select count(*) from app.admission) + (select count(*) from app.registration) as n`)).rows;
    if (Number(empty.n) !== 0) reasons.push("database is not empty: run scripts/etl/reset.sql");
    const counters = (await db.query(`select series, period from app.global_number_series
      where series = 'REGISTER' or (series = 'ADMISSION' and period = any($1::text[]))`, [seedYears])).rows;
    if (counters.length) reasons.push(`counters already exist: ${counters.map((c) => `${c.series}/${c.period}`).join(", ")}`);
    if (reasons.length) throw new RunRefused(reasons);
    await db.query("begin");
    const hashes = new Map<string, string>();
    for (const { rule, file } of RULES) {
      const h = codeHash(file);
      hashes.set(rule.id, h);
      const [row] = (await db.query(`select code_hash, approved_at from migration.rule where rule_id = $1 and version = $2`, [rule.id, rule.version])).rows;
      if (!row) {
        await db.query(`insert into migration.rule (rule_id, version, source_table, entity_list, description, owner, dispositions, code_hash)
          values ($1, $2, $3, $4, $5, $6, $7, $8)`, [rule.id, rule.version, rule.sourceTable, rule.entities, rule.description, rule.owner,
          [...new Set(Object.values(rule.dispositions).flat())], h]);
      } else if (row.code_hash !== h) reasons.push(`rule ${rule.id} v${rule.version}: code changed; give it a new version`);
      if (opts.mode === "cutover" && !row?.approved_at) reasons.push(`rule ${rule.id} v${rule.version} is not approved`);
    }
    if (reasons.length) { await db.query("rollback"); throw new RunRefused(reasons); }
    await db.query("commit");
    const unapproved = (await db.query(`select rule_id from migration.rule where approved_at is null and rule_id = any($1::text[])`,
      [RULES.map((r) => r.rule.id)])).rows.map((r) => r.rule_id as string);

    // ---------- 1. load raw (fixture: the only source in Stage 2) ----------
    const fixture = buildFixture();
    for (const t of RAW_TABLES) {
      const cols = Object.keys(fixture[t][0]!);
      await insertRows(db, `insert into raw.${t} (${cols.join(", ")}) select ${cols.join(", ")}
        from json_to_recordset($1::json) as x(${cols.map((c) => `${c} text`).join(", ")})`, fixture[t]);
    }
    const raw: Record<string, RawRow[]> = {};
    for (const t of RAW_TABLES) raw[t] = (await db.query<RawRow>(`select * from raw.${t} order by source_key collate "C"`)).rows;
    const input = await inputHash(db);

    // ---------- 2. start run ----------
    const runId = randomUUID();
    const [{ datctype }] = (await db.query(`select datctype from pg_database where datname = current_database()`)).rows;
    await db.query(`insert into migration.run (run_id, mode, source, as_of, input_hash, lc_ctype) values ($1, $2, $3, $4, $5, $6)`,
      [runId, opts.mode, SOURCE_SYSTEM, opts.asOf, input, datctype]);
    await audit(db, "migration.run.start", "OK", runId, { mode: opts.mode, source: SOURCE_SYSTEM, as_of: opts.asOf, input_hash: input });

    const errors: string[] = [];
    let checks: Check[] = [];
    let runDigest: string | null = null;
    const seeds: { series: string; period: string; value: string }[] = [];
    const unparsedNumbers: { table: string; sourceKey: string; column: string }[] = [];
    const laterYearNumbers: { sourceKey: string; year: string }[] = [];
    let rejected = 0;
    try {
      // ---------- 3. prepare: identities field by field, then match keys of the valid ones ----------
      const identity = new Map<string, StoredIdentity | RuleError[]>();
      for (const row of raw["legacy_admission"]!) {
        const given: Record<string, string | null> = { givenName: row["first_name"] ?? null, familyName: blankToNull(row["last_name"]),
          gender: null, dateOfBirth: blankToNull(row["dob"])?.trim() ?? null, mobile: blankToNull(row["mobile"]), email: null };
        const out: Record<string, string | null> = {}; const errs: RuleError[] = [];
        for (const k of IDENTITY_KEYS) {
          try { out[k] = identityField(k, given[k]); } catch (e) {
            if (!(e instanceof PersonError)) throw e;
            const col = IDENTITY_COLUMN[k] ?? k;
            errs.push({ field: col, message: e.message.slice(e.message.indexOf(":") + 2), value: row[col] ?? null });
          }
        }
        identity.set(row.source_key, errs.length ? errs : (out as StoredIdentity));
      }
      const valid = [...identity].filter(([, v]) => !Array.isArray(v)) as [string, StoredIdentity][];
      const matchKey = new Map<string, string | null>((await db.query(`select k, app.person_match_key(g, f, d::date, m) mk
        from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) as t(k, g, f, d, m)`,
        [valid.map(([k]) => k), valid.map(([, v]) => v.givenName), valid.map(([, v]) => v.familyName),
          valid.map(([, v]) => v.dateOfBirth), valid.map(([, v]) => v.mobile)])).rows.map((r) => [r.k, r.mk]));

      // ---------- 4. apply rules ----------
      const results = new Map<string, Map<string, Result>>(); // entity -> key -> result
      const centres = (await db.query(`select id, code from app.centre`)).rows as { id: number; code: string }[];
      const ctx: Ctx = {
        result: (entity, key) => results.get(entity)?.get(key), sourceRows: (t) => raw[t] ?? [], centres, identity, matchKey,
        id: (name) => uuidv5(name), asOf: opts.asOf,
      };
      for (const { rule } of RULES) {
        const out = rule.map(raw[rule.sourceTable]!, ctx);
        errors.push(...validateResults(rule, raw[rule.sourceTable]!, out));
        for (const [key, byEntity] of out) for (const [entity, res] of Object.entries(byEntity)) {
          if (!results.has(entity)) results.set(entity, new Map());
          results.get(entity)!.set(key, res);
        }
      }
      if (errors.length) throw new Error("fatal: strictness violations");

      // ---------- 5. write: one transaction ----------
      const targets: Record<string, Record<string, unknown>[]> = { "app.person": [], "app.admission": [], "app.registration": [] };
      const keyMap: unknown[] = []; const exceptions: unknown[] = [];
      const ruleOf = new Map(RULES.flatMap(({ rule }) => rule.entities.map((e) => [e, rule] as const)));
      for (const [entity, byKey] of results) {
        const rule = ruleOf.get(entity)!;
        const rowByKey = new Map(raw[rule.sourceTable]!.map((r) => [r.source_key, r]));
        for (const [key, res] of byKey) {
          const base = { run_id: runId, entity, source_system: SOURCE_SYSTEM, source_table: rule.sourceTable, source_key: key,
            source_row_hash: sha256(canonicalRow(rowByKey.get(key)!)), disposition: res.disposition, rule_id: rule.id, rule_version: rule.version,
            target_table: null as string | null, target_id: null as string | null, survivor_target_id: null as string | null, reason: null as string | null };
          if (res.disposition === "IMPORTED" && "target" in res) { targets[res.target.table]!.push(res.target.row); keyMap.push({ ...base, target_table: res.target.table, target_id: res.target.id }); }
          else if (res.disposition === "IMPORTED") keyMap.push({ ...base, target_table: res.existing.table, target_id: res.existing.id, reason: "existing" });
          else if (res.disposition === "MERGED") {
            const survivor = byKey.get(res.survivorKey);
            const sid = survivor && survivor.disposition === "IMPORTED" && "target" in survivor ? survivor.target.id : null; // no chain following
            keyMap.push({ ...base, target_table: res.table, survivor_target_id: sid, reason: `merged into ${res.survivorKey}` });
          } else if (res.disposition === "SPLIT") res.targets.forEach((t) => { targets[t.table]!.push(t.row); keyMap.push({ ...base, target_table: t.table, target_id: t.id }); });
          else if (res.disposition === "EXCLUDED") keyMap.push({ ...base, reason: res.reason });
          else {
            rejected++;
            keyMap.push({ ...base, reason: res.errors.map((e) => `${e.field}: ${e.message}`).join("; ") });
            for (const e of res.errors) exceptions.push({ run_id: runId, entity, source_system: SOURCE_SYSTEM, source_table: rule.sourceTable,
              source_key: key, rule_id: rule.id, field: e.field, value_fingerprint: fingerprint(e.value, salt), message: e.message });
          }
        }
      }
      // counters (DD-6, DD-9): highest number on any raw row, whatever its disposition
      let registerMax = 0n;
      for (const r of raw["legacy_course_row"]!) {
        const no = (r["register_no"] ?? "").trim();
        if (/^\d+$/.test(no)) { if (BigInt(no) > registerMax) registerMax = BigInt(no); }
        else unparsedNumbers.push({ table: "legacy_course_row", sourceKey: r.source_key, column: "register_no" });
      }
      const admissionMax = new Map<string, bigint>();
      const newest = [...seedYears].sort().at(-1)!;
      for (const r of raw["legacy_admission"]!) {
        const no = (r["admission_no"] ?? "").trim();
        const p = no ? parseAdmissionNo(no, (r["academic_year"] ?? "").trim()) : null;
        if (!p) { unparsedNumbers.push({ table: "legacy_admission", sourceKey: r.source_key, column: "admission_no" }); continue; }
        if (p.year > newest) laterYearNumbers.push({ sourceKey: r.source_key, year: p.year });
        if (p.seq > (admissionMax.get(p.year) ?? 0n)) admissionMax.set(p.year, p.seq);
      }
      const big = (a: bigint, b: bigint | undefined) => (b != null && b > a ? b : a);
      seeds.push({ series: "REGISTER", period: "ALL", value: String(big(registerMax, opts.legacyCurrent?.REGISTER)) });
      for (const y of seedYears) seeds.push({ series: "ADMISSION", period: y, value: String(big(admissionMax.get(y) ?? 0n, opts.legacyCurrent?.ADMISSION?.[y])) });

      await db.query("begin");
      await insertRows(db, `insert into app.person (id, given_name, family_name, gender, date_of_birth, mobile, email, created_at)
        select id, given_name, family_name, gender, date_of_birth, mobile, email, (created_on::timestamp at time zone 'Asia/Kolkata')
        from json_to_recordset($1::json) as x(id uuid, given_name text, family_name text, gender app."Gender", date_of_birth date,
          mobile text, email text, created_on date)`, targets["app.person"]!);
      await insertRows(db, `insert into app.admission (id, person_id, centre_id, academic_year, admission_no, admitted_on, created_at)
        select id, person_id, centre_id, academic_year, admission_no, admitted_on, (created_on::timestamp at time zone 'Asia/Kolkata')
        from json_to_recordset($1::json) as x(id uuid, person_id uuid, centre_id int, academic_year text, admission_no text,
          admitted_on date, created_on date)`, targets["app.admission"]!);
      await insertRows(db, `insert into app.registration (id, admission_id, centre_id, course_code, register_no, status, join_date, created_at)
        select id, admission_id, centre_id, course_code, register_no, status, join_date, (created_on::timestamp at time zone 'Asia/Kolkata')
        from json_to_recordset($1::json) as x(id uuid, admission_id uuid, centre_id int, course_code text, register_no text,
          status app."RegistrationStatus", join_date date, created_on date)`, targets["app.registration"]!);
      await insertRows(db, `insert into migration.key_map (run_id, entity, source_system, source_table, source_key, source_row_hash,
          disposition, rule_id, rule_version, target_table, target_id, survivor_target_id, reason)
        select run_id, entity, source_system, source_table, source_key, source_row_hash, disposition, rule_id, rule_version,
          target_table, target_id, survivor_target_id, reason
        from json_to_recordset($1::json) as x(run_id uuid, entity text, source_system text, source_table text, source_key text,
          source_row_hash text, disposition text, rule_id text, rule_version int, target_table text, target_id text,
          survivor_target_id text, reason text)`, keyMap);
      await insertRows(db, `insert into migration.exception (run_id, entity, source_system, source_table, source_key, rule_id, field,
          value_fingerprint, message)
        select run_id, entity, source_system, source_table, source_key, rule_id, field, value_fingerprint, message
        from json_to_recordset($1::json) as x(run_id uuid, entity text, source_system text, source_table text, source_key text,
          rule_id text, field text, value_fingerprint text, message text)`, exceptions);
      await db.query(`insert into app.global_number_series (series, period, current)
        select series, period, value::bigint from json_to_recordset($1::json) as x(series text, period text, value text)`, [JSON.stringify(seeds)]);
      await db.query("commit");

      // ---------- 6. check ----------
      checks = await computeChecks(db, runId, RULES.map((r) => r.rule), raw, ctx);
      runDigest = await digest(db, runId);
      checks.push({ check: "K9", scope: { run: runId }, expected: null, actual: null, passed: null, detail: { digest: runDigest } });
      for (const c of checks) {
        await db.query(`insert into migration.reconciliation (run_id, "check", scope, expected, actual, passed, detail)
          values ($1, $2, $3, $4, $5, $6, $7)`, [runId, c.check, JSON.stringify(c.scope), c.expected, c.actual, c.passed, JSON.stringify(c.detail)]);
      }
    } catch (e) {
      await db.query("rollback").catch(() => {});
      if (!errors.length) errors.push(e instanceof Error ? e.message : String(e));
    }

    // ---------- 7. finish ----------
    const status = runStatus({ mode: opts.mode, fatal: errors.length > 0, checks, rejected, unparsedNumbers, laterYearNumbers });
    await db.query(`update migration.run set status = $2, finished_at = now(), digest = $3 where run_id = $1`, [runId, status, runDigest]);
    const dispositions: Record<string, Record<string, number>> = {};
    if (!errors.length) {
      for (const r of (await db.query(`select entity, disposition, count(*)::int n from migration.key_map where run_id = $1
        group by 1, 2`, [runId])).rows) (dispositions[r.entity] ??= {})[r.disposition] = r.n;
    }
    await audit(db, "migration.run.finish", status === "PASSED" ? "OK" : "FAILED", runId, { status, digest: runDigest, counts: dispositions });
    const [runRow] = (await db.query(`select to_jsonb(r) j from migration.run r where run_id = $1`, [runId])).rows;
    fs.mkdirSync(artifactDir, { recursive: true });
    const json = path.join(artifactDir, `etl-${runId}.json`);
    const csv = path.join(artifactDir, `etl-${runId}-exceptions.csv`);
    const j = runRow.j;
    fs.writeFileSync(json, JSON.stringify({
      run: { runId, mode: j.mode, source: j.source, asOf: j.as_of, inputHash: j.input_hash, lcCtype: j.lc_ctype,
        startedAt: j.started_at, finishedAt: j.finished_at, status, digest: runDigest },
      rules: RULES.map(({ rule }) => ({ id: rule.id, version: rule.version, codeHash: hashes.get(rule.id), approved: !unapproved.includes(rule.id) })),
      dispositions, checks, seeds, unparsedNumbers, laterYearNumbers, errors,
    }, null, 2) + "\n");
    const q = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const ex = (await db.query(`select entity, source_table, source_key, rule_id, field, value_fingerprint, message from migration.exception
      where run_id = $1 order by entity collate "C", source_table collate "C", source_key collate "C", field collate "C", message collate "C"`, [runId])).rows;
    fs.writeFileSync(csv, ["entity,source_table,source_key,rule_id,field,value_fingerprint,message",
      ...ex.map((r) => [r.entity, r.source_table, r.source_key, r.rule_id, r.field, r.value_fingerprint, r.message].map(q).join(","))].join("\r\n") + "\r\n");
    return { runId, status, digest: runDigest, checks, artifactPaths: [json, csv], errors };
  } finally {
    await db.end(); // releases the session advisory lock
  }
}

