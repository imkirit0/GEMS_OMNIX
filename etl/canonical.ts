// Canonical form, hashes and fingerprints (design: "Canonical Form", "Exceptions Without PII", DD-10).
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import type pg from "pg";

/** Unicode code-point order (Array.prototype.sort compares UTF-16 code units). */
export function codePointCompare(a: string, b: string): number {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** One row as JSON: keys in code-point order, no whitespace, values as text or null. */
export function canonicalRow(row: Record<string, unknown>): string {
  const keys = Object.keys(row).sort(codePointCompare);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${row[k] == null ? "null" : JSON.stringify(String(row[k]))}`).join(",")}}`;
}

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** HMAC-SHA256 keyed with ETL_SALT, first 16 hex characters; null for a null value. */
export function fingerprint(value: string | null, salt: string): string | null {
  return value == null ? null : createHmac("sha256", Buffer.from(salt, "utf8")).update(value, "utf8").digest("hex").slice(0, 16);
}

/** The rule's own file plus the code it reaches; repo-relative POSIX paths, read from the repository root. */
export const HASHED_WITH_EVERY_RULE = ["src/server/person-rules.ts", "etl/ids.ts"]; // learner-details Z3: exactly what the rules import
export function codeHash(ruleFile: string): string {
  const files = [...new Set([ruleFile, ...HASHED_WITH_EVERY_RULE])].sort(codePointCompare);
  const h = createHash("sha256");
  for (const f of files) h.update(`${f}\n`, "utf8").update(fs.readFileSync(f));
  return h.digest("hex");
}

// Rows of a table as text values (a UTC session gives a fixed timestamp form), in "C" collation order.
async function section(db: pg.Client, name: string, sql: string, params: unknown[] = []): Promise<string> {
  const { rows } = await db.query<{ j: Record<string, string | null> }>(sql, params);
  return `${name}\n${rows.map((r) => `${canonicalRow(r.j)}\n`).join("")}`;
}
const asText = (alias: string, drop: string[] = []) =>
  `(select jsonb_object_agg(key, value) from jsonb_each_text(to_jsonb(${alias})${drop.map((d) => ` - '${d}'`).join("")})) as j`;

export const RAW_TABLES = ["legacy_centre", "legacy_admission", "legacy_course_row"] as const;

export async function inputHash(db: pg.Client): Promise<string> {
  let s = "";
  for (const t of RAW_TABLES) s += await section(db, t, `select ${asText("t")} from raw.${t} t order by source_key collate "C"`);
  return sha256(s);
}

export async function digest(db: pg.Client, runId: string): Promise<string> {
  let s = await section(db, "key_map", `select ${asText("k", ["id", "run_id"])} from migration.key_map k where run_id = $1
    order by entity collate "C", source_table collate "C", source_key collate "C", target_table collate "C", target_id collate "C"`, [runId]);
  s += await section(db, "exception", `select ${asText("e", ["id", "run_id", "value_fingerprint"])} from migration.exception e
    where run_id = $1 order by entity collate "C", source_table collate "C", source_key collate "C", field collate "C", message collate "C"`, [runId]);
  for (const t of ["person", "admission", "registration"]) {
    s += await section(db, `app.${t}`, `select ${asText("t")} from app.${t} t order by id::text collate "C"`);
  }
  return sha256(s);
}
