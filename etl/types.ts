// Migration framework types (docs/designs/migration-framework/migration-framework.md, "Mapping Rules").
import type { StoredIdentity } from "../src/server/people";

export type Disposition = "IMPORTED" | "MERGED" | "SPLIT" | "EXCLUDED" | "REJECTED"; // no ARCHIVED (DD-8)
export type RawRow = Record<string, string | null> & { source_key: string };
export type Target = { table: string; id: string; row: Record<string, unknown> };
export type RuleError = { field: string; message: string; value: string | null }; // field = raw column name
export type Result =
  | { disposition: "IMPORTED"; target: Target } // a new row
  | { disposition: "IMPORTED"; existing: { table: string; id: string } } // matched an existing row
  | { disposition: "MERGED"; survivorKey: string; table: string }
  | { disposition: "SPLIT"; targets: Target[] }
  | { disposition: "EXCLUDED"; reason: string }
  | { disposition: "REJECTED"; errors: RuleError[] };

export type Ctx = {
  /** results of entities processed before this rule (centre, then admission, then registration) */
  result(entity: string, sourceKey: string): Result | undefined;
  /** raw rows of source tables loaded in this run, by table name (e.g. "legacy_centre") */
  sourceRows(table: string): RawRow[];
  centres: { id: number; code: string }[]; // app.centre, read by the runner
  courses: Set<string>; academicYears: Set<string>; // every app.course code and app.academic_year code, active or not (DD-11)
  identity: Map<string, StoredIdentity | RuleError[]>; // step 3, by admission source key
  matchKey: Map<string, string | null>; // step 3, valid identities only
  id(name: string): string; // uuidv5 under ETL_NAMESPACE
  asOf: string;
};

export type Rule = {
  id: string; version: number; description: string; owner: string;
  sourceTable: string; entities: string[];
  dispositions: Record<string, Disposition[]>; // allowed per entity
  parent?: Record<string, (row: RawRow, ctx: Ctx) => { entity: string; sourceKey: string } | null>; // used by map() and K6
  splitCardinality?: Record<string, number>; // for K5, per entity
  map(rows: RawRow[], ctx: Ctx): Map<string, Record<string, Result>>; // source key -> entity -> result
};

export const SOURCE_SYSTEM = "fixture"; // the only source in Stage 2
