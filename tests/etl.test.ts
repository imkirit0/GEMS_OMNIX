// Migration framework acceptance tests: P8 and T-MIG (audit 09; docs/designs/migration-framework, item 8).
// Runs the ETL as gems_etl against the local Docker database (scripts/etl/setup.mjs has run in ci.sh).
import { beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { canonicalRow, codeHash, codePointCompare } from "../etl/canonical";
import { k5, runStatus, validateResults, type Check, type KeyMapRow } from "../etl/checks";
import { AS_OF } from "../etl/fixture";
import { uuidv5 } from "../etl/ids";
import { centre } from "../etl/rules/centre";
import { registration } from "../etl/rules/registration";
import { RULES, run, RunRefused } from "../etl/run";
import type { Ctx, Result } from "../etl/types";
import { admit } from "../src/server/people";
import { asAdmin, C, reset, ST_TOKEN } from "./fixtures";

const RESET_SQL = fs.readFileSync("scripts/etl/reset.sql", "utf8");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "etl-"));
const artifactDir = () => (process.env["ETL_EVIDENCE"] === "1" ? "evidence" : tmp());

/** Tests only: also clears migration.rule (operators keep it; reset.sql does not touch it). */
async function resetEtl() {
  await reset();
  await asAdmin(async (db) => { await db.query(RESET_SQL); await db.query("truncate migration.rule cascade"); });
}
const approveAll = () => asAdmin(async (db) => {
  for (const { rule, file } of RULES) {
    const r = await db.query(`update migration.rule set approved_by = 'test approver', approved_at = now()
      where rule_id = $1 and version = $2 and code_hash = $3`, [rule.id, rule.version, codeHash(file)]);
    expect(r.rowCount).toBe(1);
  }
});
const keyMap = (runId: string) => asAdmin((db) => db.query(`select * from migration.key_map where run_id = $1`, [runId]).then((r) => r.rows));
const asEtl = async <T>(fn: (db: pg.Client) => Promise<T>) => {
  const db = new pg.Client({ connectionString: process.env["ETL_DATABASE_URL"] });
  await db.connect();
  try { return await fn(db); } finally { await db.end(); }
};
const outcome = async (runId: string, entity: string, table: string, where: string, params: unknown[]) =>
  asAdmin((db) => db.query(`select k.disposition, k.reason from migration.key_map k join raw.${table} r on r.source_key = k.source_key
    where k.run_id = $1 and k.entity = $2 and ${where} order by k.source_key collate "C"`, [runId, entity, ...params]).then((r) => r.rows));

beforeEach(() => resetEtl());

describe("migration framework units", () => {
  test("uuidv5 matches the RFC 9562 example; canonical rows sort keys by code point", () => {
    expect(uuidv5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    expect(canonicalRow({ b: "1", a: null, "\u{1F600}": "x", "￿": "y" })).toBe('{"a":null,"b":"1","￿":"y","\u{1F600}":"x"}');
    expect(codePointCompare("￿", "\u{1F600}")).toBeLessThan(0); // UTF-16 order would say the opposite
  });

  test("mapping rules on hand-written rows", () => {
    const ctx = { centres: [{ id: 1, code: "KL2-25" }], courses: new Set(["DCA", "OLD"]), academicYears: new Set(["2026-27"]),
      result: () => undefined, sourceRows: () => [] } as unknown as Ctx;
    const out = centre.map([{ source_key: "1", code: " kl2-25 " }, { source_key: "2", code: "KL2-25" }, { source_key: "3", code: "GDEMO" },
      { source_key: "4", code: "ZZ" }], ctx);
    expect([...out.values()].map((r) => r["centre"]!.disposition)).toEqual(["IMPORTED", "REJECTED", "EXCLUDED", "REJECTED"]);
    const reg = registration.map([{ source_key: "1", admission_key: "9", course_code: "DCA", register_no: "7", join_date: "2026-02-30", status: "Completed" }],
      { ...ctx, result: () => undefined } as Ctx);
    expect((reg.get("1")!["registration"] as { errors: { field: string; message: string }[] }).errors.map((e) => `${e.field}: ${e.message}`))
      .toEqual(["admission_key: admission not imported", "join_date: not a date", "status: not in the status map"]);
    // DD-11: ctx.courses holds every code, active or not, so a course deactivated since ("OLD") still imports; codes are normalised
    const adm: Result = { disposition: "IMPORTED", target: { table: "app.admission", id: "a", row: { centre_id: 1 } } };
    const old = registration.map([{ source_key: "2", admission_key: "9", course_code: " old ", register_no: "8", join_date: "2026-02-01", status: "Active" }],
      { ...ctx, result: () => adm, id: () => "r" } as Ctx);
    expect(old.get("2")!["registration"]).toMatchObject({ disposition: "IMPORTED", target: { row: { course_code: "OLD" } } });
  });

  test("the hash covers what the rules load: person-rules.ts imports nothing; rules import only it, ids and types", () => {
    expect(fs.readFileSync("src/server/person-rules.ts", "utf8")).not.toMatch(/^\s*import\b/m);
    for (const f of fs.readdirSync("etl/rules")) {
      const from = [...fs.readFileSync(path.join("etl/rules", f), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      expect(from.filter((m) => !["../../src/server/person-rules", "../ids", "../types"].includes(m!)), f).toEqual([]);
    }
  });

  test("T-MIG-005 K5 and strictness and run status are pure functions", () => {
    const row = (k: string, d: KeyMapRow["disposition"]): KeyMapRow => ({ entity: "e", source_key: k, disposition: d, target_table: "t", target_id: k, survivor_target_id: null, reason: null });
    expect(k5([row("a", "SPLIT"), row("a", "SPLIT"), row("b", "SPLIT")], { e: 2 })[0]).toMatchObject({ expected: 2, actual: 1, passed: false });
    const rule = { id: "r", entities: ["e"], dispositions: { e: ["IMPORTED" as const] } };
    const res = new Map<string, Record<string, Result>>([["1", { e: { disposition: "EXCLUDED", reason: "x" } }], ["2", { f: { disposition: "IMPORTED", existing: { table: "t", id: "1" } } }]]);
    expect(validateResults(rule, [{ source_key: "1" }, { source_key: "2" }, { source_key: "3" }], res)).toEqual([
      "r: undeclared disposition EXCLUDED for e 1", "r: no e result for 2", "r: undeclared entity f for 2", "r: no e result for 3"]);
    const ok: Check = { check: "K1", scope: {}, expected: 1, actual: 1, passed: true, detail: {} };
    const na: Check = { ...ok, check: "K7", passed: null };
    const base = { mode: "dry" as const, fatal: false, checks: [ok, na], rejected: 3, unparsedNumbers: [1], laterYearNumbers: [1] };
    expect(runStatus(base)).toBe("PASSED");
    expect(runStatus({ ...base, fatal: true })).toBe("FAILED");
    expect(runStatus({ ...base, checks: [{ ...ok, passed: false }] })).toBe("FAILED");
    const clean = { ...base, mode: "cutover" as const, rejected: 0, unparsedNumbers: [], laterYearNumbers: [] };
    expect(runStatus({ ...clean, checks: [ok] })).toBe("PASSED");
    expect(runStatus({ ...clean, checks: [ok, na] })).toBe("FAILED"); // only K7 null
    expect(runStatus({ ...clean, checks: [ok], rejected: 1 })).toBe("FAILED");
    expect(runStatus({ ...clean, checks: [ok], unparsedNumbers: [1] })).toBe("FAILED");
    expect(runStatus({ ...clean, checks: [ok], laterYearNumbers: [1] })).toBe("FAILED");
  });
});

describe("P8 dry run on synthetic data (T-MIG)", () => {
  test("T-MIG-001…004, 006, 009: dispositions, defects, reruns identical, numbers continue", async () => {
    const r1 = await run({ mode: "dry", asOf: AS_OF, artifactDir: tmp() });
    expect(r1.errors).toEqual([]);
    expect(r1.status).toBe("PASSED");
    await approveAll();
    const failing = r1.checks.filter((c) => c.passed === false);
    expect(failing).toEqual([]);
    for (const k of ["K1", "K2", "K3", "K4", "K6"]) expect(r1.checks.some((c) => c.check === k && c.passed === true), k).toBe(true);
    // T-MIG-001 K1: every raw key of every entity has a key-map row
    const counts = await asAdmin((db) => db.query(`select (select count(*)::int from raw.legacy_admission) a, (select count(*)::int from raw.legacy_course_row) c,
      (select count(distinct source_key)::int from migration.key_map where entity = 'person') p,
      (select count(distinct source_key)::int from migration.key_map where entity = 'registration') r`).then((q) => q.rows[0]));
    expect([counts.p, counts.r]).toEqual([counts.a, counts.c]);
    // defects (design table)
    const c = (code: string) => outcome(r1.runId, "centre", "legacy_centre", "r.code = $3", [code]);
    expect(await c(" kl2-25 ")).toEqual([{ disposition: "IMPORTED", reason: "existing" }]);
    expect((await c("KL3-07")).map((x) => x.disposition)).toEqual(["IMPORTED", "REJECTED"]);
    expect(await c("GDEMO")).toEqual([{ disposition: "EXCLUDED", reason: "test centre" }]);
    expect(await c("XX9-99")).toEqual([{ disposition: "REJECTED", reason: "code: no such centre" }]);
    const a = (where: string, p: unknown[], entity = "admission") => outcome(r1.runId, entity, "legacy_admission", where, p);
    expect((await a("r.centre_code = $3", ["GDEMO"])).map((x) => x.reason)).toEqual(["centre_code: centre excluded", "centre_code: centre excluded"]);
    expect((await a("r.centre_code = $3", ["XX9-99"], "person")).map((x) => x.reason)).toEqual(["centre_code: centre not imported"]);
    expect((await a("r.first_name in ('Meera', 'Nair') and r.dob = '2001-01-11'", [], "person")).map((x) => x.disposition)).toEqual(["IMPORTED", "MERGED"]);
    expect((await a("r.first_name = 'Rahul'", [], "person")).map((x) => x.disposition)).toEqual(["IMPORTED", "MERGED"]);
    expect((await a("r.first_name = 'Rahul'", [])).map((x) => x.disposition)).toEqual(["IMPORTED", "IMPORTED"]);
    expect(await a("r.first_name = 'Sona'", [], "person")).toEqual([{ disposition: "IMPORTED", reason: null }]);
    expect(await a("r.admitted_on = '45231'", [], "person")).toEqual([{ disposition: "REJECTED", reason: "admitted_on: YYYY-MM-DD" }]);
    expect(await a("r.academic_year = '2026-2027'", [])).toEqual([{ disposition: "REJECTED", reason: "academic_year: YYYY-YY, consecutive years" }]);
    const dupNo = await asAdmin((db) => db.query(`select admission_no from raw.legacy_admission group by 1 having count(*) > 1`).then((q) => q.rows));
    expect(dupNo).toHaveLength(1);
    expect((await a("r.admission_no = $3", [dupNo[0].admission_no])).map((x) => x.reason)).toEqual([null, "admission_no: duplicate"]);
    const reg = (where: string) => outcome(r1.runId, "registration", "legacy_course_row", where, []);
    expect(await reg("r.admission_key = '999999'")).toEqual([{ disposition: "REJECTED", reason: "admission_key: admission not imported" }]);
    expect(await reg("r.status = 'Completed'")).toEqual([{ disposition: "REJECTED", reason: "status: not in the status map" }]);
    // catalogue skeleton: an unknown course; a well-formed year that is not in the academic year master
    expect(await reg("r.course_code = 'XYZ'")).toEqual([{ disposition: "REJECTED", reason: "course_code: no such course" }]);
    // admission screens DD-16: the second admission of one person at one centre in one year
    expect((await a("r.first_name = 'Vani'", [], "person")).map((x) => x.disposition)).toEqual(["IMPORTED", "REJECTED"]);
    expect((await a("r.first_name = 'Vani'", [])).map((x) => x.reason)).toEqual([null, "academic_year: already admitted at this centre this year"]);
    expect((await reg("r.admission_key = (select max(source_key collate \"C\") from raw.legacy_admission where first_name = 'Vani')")).map((x) => x.reason))
      .toEqual(["admission_key: admission not imported"]);
    expect(await a("r.academic_year = '2030-31'", [])).toEqual([{ disposition: "REJECTED", reason: "academic_year: not in the academic year master" }]);
    expect(await reg("r.admission_key = (select source_key from raw.legacy_admission where academic_year = '2030-31')"))
      .toEqual([{ disposition: "REJECTED", reason: "admission_key: admission not imported" }]);
    const dupReg = await asAdmin((db) => db.query(`select register_no from raw.legacy_course_row group by 1 having count(*) > 1`).then((q) => q.rows));
    expect(dupReg).toHaveLength(1);
    expect((await reg(`r.register_no = '${dupReg[0].register_no}'`)).map((x) => x.reason)).toEqual([null, "register_no: duplicate"]);
    // every REJECTED key has exceptions, without raw values
    const rej = await asAdmin((db) => db.query(`select count(*)::int n from migration.key_map k where k.disposition = 'REJECTED'
      and not exists (select 1 from migration.exception e where e.run_id = k.run_id and e.entity = k.entity and e.source_key = k.source_key)`).then((q) => q.rows[0].n));
    expect(rej).toBe(0);
    const csv = fs.readFileSync(r1.artifactPaths[1]!, "utf8");
    expect(csv).not.toContain("45231");
    expect(csv).not.toContain("Completed");
    // no person without an admission; the 45231 learner left no person row
    expect(await asAdmin((db) => db.query(`select count(*)::int n from app.person where given_name = 'Tara'`).then((q) => q.rows[0].n))).toBe(0);
    // numbers: unparsable and later-year listed; counters above the highest raw numbers (on GDEMO rows)
    const art = JSON.parse(fs.readFileSync(r1.artifactPaths[0]!, "utf8"));
    expect(art.unparsedNumbers.map((u: { column: string }) => u.column)).toEqual(["admission_no", "admission_no"]); // G-TEC/26/0042, LEGACY-UMA
    expect(art.laterYearNumbers.map((l: { year: string }) => l.year)).toEqual(["2027-28", "2030-31"]);
    expect(art.seeds).toEqual([{ series: "REGISTER", period: "ALL", value: "2064112" }, { series: "ADMISSION", period: "2026-27", value: "43887" }]);
    expect(art.rules.every((x: { approved: boolean }) => !x.approved)).toBe(true); // a dry run lists unapproved rules

    // T-MIG-009: a second run on the same input after reset gives the same digest
    await asAdmin((db) => db.query(RESET_SQL));
    const r2 = await run({ mode: "dry", asOf: AS_OF, artifactDir: artifactDir() });
    expect(r2.status).toBe("PASSED");
    expect(r2.digest).toBe(r1.digest);
    expect(r2.runId).not.toBe(r1.runId);

    // G7: the app continues the legacy numbers
    const next = await admit(ST_TOKEN.sa, { person: { givenName: "After", mobile: "9000000099", dateOfBirth: "2000-01-01" }, centreId: C.A,
      academicYear: "2026-27", admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }] });
    expect([next.admissionNo, next.registrations[0]!.registerNo]).toEqual(["GTEC262743888", "2064113"]);
  });

  test("T-MIG-002 the database refuses a second disposition for a key and entity", async () => {
    const r = await run({ mode: "dry", asOf: AS_OF, artifactDir: tmp() });
    const err = await asEtl((db) => db.query(`insert into migration.key_map (run_id, entity, source_system, source_table, source_key, source_row_hash,
      disposition, rule_id, rule_version) select run_id, entity, source_system, source_table, source_key, source_row_hash, 'EXCLUDED', rule_id, rule_version
      from migration.key_map where run_id = $1 and entity = 'centre' limit 1`, [r.runId]).catch((e) => e));
    expect(err).toMatchObject({ code: "23505" });
  });

  test("audit rows: one start and one finish per run, actor migration:<run>", async () => {
    const r = await run({ mode: "dry", asOf: AS_OF, artifactDir: tmp() });
    const rows = await asAdmin((db) => db.query(`select action, outcome, actor_kind, user_id, target_type, target_id, actor_roles
      from app.audit_log where actor_kind like 'migration:%' order by id`).then((q) => q.rows));
    expect(rows).toEqual([
      { action: "migration.run.start", outcome: "OK", actor_kind: `migration:${r.runId}`, user_id: null, target_type: "migration.run", target_id: r.runId, actor_roles: [] },
      { action: "migration.run.finish", outcome: "OK", actor_kind: `migration:${r.runId}`, user_id: null, target_type: "migration.run", target_id: r.runId, actor_roles: [] },
    ]);
  });
});

describe("refusals and confinement (G5, G6)", () => {
  test("G5 cutover refused without approvals, leaving no rule or run row", async () => {
    const e = await run({ mode: "cutover", asOf: AS_OF, artifactDir: tmp() }).catch((x) => x);
    expect(e).toBeInstanceOf(RunRefused);
    expect(await asAdmin((db) => db.query(`select (select count(*)::int from migration.rule) + (select count(*)::int from migration.run) n`)
      .then((q) => q.rows[0].n))).toBe(0);
  });

  test("G5 the same version with changed code is refused in dry mode", async () => {
    await run({ mode: "dry", asOf: AS_OF, artifactDir: tmp() });
    await asAdmin(async (db) => { await db.query(RESET_SQL); await db.query(`update migration.rule set code_hash = 'x' where rule_id = 'centre'`); });
    const e = await run({ mode: "dry", asOf: AS_OF, artifactDir: tmp() }).catch((x) => x);
    expect(e).toBeInstanceOf(RunRefused);
    expect((e as RunRefused).reasons).toEqual(["rule centre v4: code changed; give it a new version"]);
  });

  test("an existing counter and a non-empty database are refused", async () => {
    await asAdmin((db) => db.query(`insert into app.global_number_series (series, period, current) values ('REGISTER', 'ALL', 1)`));
    expect(((await run({ mode: "dry", asOf: AS_OF }).catch((x) => x)) as RunRefused).reasons).toEqual(["counters already exist: REGISTER/ALL"]);
    await asAdmin((db) => db.query(`delete from app.global_number_series; insert into raw.legacy_centre (source_key) values ('1')`));
    expect(((await run({ mode: "dry", asOf: AS_OF }).catch((x) => x)) as RunRefused).reasons).toEqual(["database is not empty: run scripts/etl/reset.sql"]);
  });

  test("an empty catalogue is refused before anything is written", async () => {
    await asAdmin((db) => db.query(`truncate app.course, app.academic_year cascade`));
    expect(((await run({ mode: "dry", asOf: AS_OF }).catch((x) => x)) as RunRefused).reasons).toEqual(["catalogue is empty: load courses and academic years"]);
  });

  test("a cutover with approved rules on the fixture ends FAILED (K7/K8/K10/K11 not built; rejects present)", async () => {
    await run({ mode: "dry", asOf: AS_OF, artifactDir: tmp() });
    await approveAll();
    await asAdmin((db) => db.query(RESET_SQL));
    const r = await run({ mode: "cutover", asOf: AS_OF, artifactDir: tmp() });
    expect(r.status).toBe("FAILED");
  });

  test("G6 gems_etl: no Prisma migration creates it; it owns nothing; it cannot approve or change rules", async () => {
    for (const d of fs.readdirSync("prisma/migrations")) {
      const f = path.join("prisma/migrations", d, "migration.sql");
      if (fs.existsSync(f)) expect(fs.readFileSync(f, "utf8"), d).not.toContain("gems_etl");
    }
    expect(await asAdmin((db) => db.query(`select count(*)::int n from pg_class where relowner = (select oid from pg_roles where rolname = 'gems_etl')`)
      .then((q) => q.rows[0].n))).toBe(0);
    await run({ mode: "dry", asOf: AS_OF, artifactDir: tmp() });
    const denied = [
      `insert into migration.rule (rule_id, version, source_table, entity_list, description, owner, dispositions, code_hash, approved_by, approved_at)
        values ('x', 1, 't', '{}', 'd', 'o', '{}', 'h', 'me', now())`,
      `update migration.rule set approved_by = 'me', approved_at = now()`,
      `insert into migration.key_map (run_id, entity, source_system, source_table, source_key, source_row_hash, disposition, rule_id, rule_version, approved_by)
        select run_id, 'x', 's', 't', 'k', 'h', 'IMPORTED', 'centre', 1, 'me' from migration.run limit 1`,
    ];
    for (const sql of denied) expect(await asEtl((db) => db.query(sql).catch((e) => e)), sql.slice(0, 40)).toMatchObject({ code: "42501" });
  });
});
