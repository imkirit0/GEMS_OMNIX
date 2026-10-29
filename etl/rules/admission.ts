// Admission and person mapping rule, one pass (design: "Admission and Person, One Pass"):
// a person is written only together with an importable admission.
import { ACADEMIC_YEAR_RULE, academicYearOk, isoDate, normCode, PersonError, type StoredIdentity } from "../../src/server/people";
import { targetName } from "../ids";
import { SOURCE_SYSTEM, type Ctx, type RawRow, type Result, type RuleError, type Rule } from "../types";

const TABLE = "legacy_admission";

/** The earliest centre key whose normalised code equals the row's normalised centre_code. */
function centreParent(row: RawRow, ctx: Ctx) {
  const code = normCode(row["centre_code"] ?? null);
  const hit = ctx.sourceRows("legacy_centre").find((c) => normCode(c["code"] ?? null) === code);
  return hit ? { entity: "centre", sourceKey: hit.source_key } : null;
}

/** A PersonError "<field>: <check>" from isoDate() as a RuleError on the raw column. */
function dateError(column: string, v: string | null, e: unknown): RuleError {
  if (!(e instanceof PersonError)) throw e;
  return { field: column, message: e.message.slice(e.message.indexOf(":") + 2), value: v };
}

export const admission = {
  id: "admission", version: 2, owner: "Admissions, PRO", sourceTable: TABLE, entities: ["person", "admission"],
  description: "Legacy admissions to person + admission in one pass; duplicates merged by app.person_match_key (synthetic stand-in for D-MIG-4 maps)",
  dispositions: { person: ["IMPORTED", "MERGED", "REJECTED"], admission: ["IMPORTED", "REJECTED"] },
  parent: { person: centreParent, admission: centreParent },
  map(rows: RawRow[], ctx: Ctx) {
    const errorsOf = new Map<string, RuleError[]>();
    const centreOf = new Map<string, number>();
    const usedNo = new Set<string>();
    for (const row of rows) {
      const k = row.source_key;
      const identity = ctx.identity.get(k);
      const errors: RuleError[] = Array.isArray(identity) ? [...identity] : [];
      const parent = centreParent(row, ctx);
      const pr = parent ? ctx.result("centre", parent.sourceKey) : undefined;
      if (pr?.disposition === "IMPORTED" && "existing" in pr) centreOf.set(k, Number(pr.existing.id));
      else errors.push({ field: "centre_code", message: pr?.disposition === "EXCLUDED" ? "centre excluded" : "centre not imported", value: row["centre_code"] ?? null });
      const year = (row["academic_year"] ?? "").trim();
      if (!academicYearOk(year)) errors.push({ field: "academic_year", message: ACADEMIC_YEAR_RULE, value: row["academic_year"] ?? null });
      else if (!ctx.academicYears.has(year)) errors.push({ field: "academic_year", message: "not in the academic year master", value: row["academic_year"] ?? null });
      const on = row["admitted_on"] ?? null;
      try {
        if (isoDate("admittedOn", (on ?? "").trim()) > ctx.asOf) errors.push({ field: "admitted_on", message: "after the run date", value: on });
      } catch (e) { errors.push(dateError("admitted_on", on, e)); }
      const no = (row["admission_no"] ?? "").trim();
      if (!no) errors.push({ field: "admission_no", message: "required", value: row["admission_no"] ?? null });
      else if (usedNo.has(no)) errors.push({ field: "admission_no", message: "duplicate", value: row["admission_no"] ?? null });
      if (errors.length === 0) usedNo.add(no);
      errorsOf.set(k, errors);
    }
    // group usable rows by match key; a null key is its own group; the survivor is the earliest row
    const survivorOf = new Map<string, string>();
    const firstByKey = new Map<string, string>();
    for (const row of rows) {
      const k = row.source_key;
      if (errorsOf.get(k)!.length) continue;
      const mk = ctx.matchKey.get(k) ?? null;
      if (mk == null) { survivorOf.set(k, k); continue; }
      if (!firstByKey.has(mk)) firstByKey.set(mk, k);
      survivorOf.set(k, firstByKey.get(mk)!);
    }
    const personId = (k: string) => ctx.id(targetName(SOURCE_SYSTEM, TABLE, k, "app.person"));
    const byKey = new Map(rows.map((r) => [r.source_key, r]));
    const out = new Map<string, Record<string, Result>>();
    for (const row of rows) {
      const k = row.source_key;
      const errors = errorsOf.get(k)!;
      if (errors.length) {
        out.set(k, { person: { disposition: "REJECTED", errors }, admission: { disposition: "REJECTED", errors } });
        continue;
      }
      const survivor = survivorOf.get(k)!;
      const s = ctx.identity.get(survivor) as StoredIdentity;
      const person: Result = survivor === k
        ? { disposition: "IMPORTED", target: { table: "app.person", id: personId(k), row: {
            id: personId(k), given_name: s.givenName, family_name: s.familyName, gender: s.gender,
            date_of_birth: s.dateOfBirth, mobile: s.mobile, email: s.email, created_on: byKey.get(k)!["admitted_on"]!.trim() } } }
        : { disposition: "MERGED", survivorKey: survivor, table: "app.person" };
      const id = ctx.id(targetName(SOURCE_SYSTEM, TABLE, k, "app.admission"));
      const on = row["admitted_on"]!.trim();
      out.set(k, { person, admission: { disposition: "IMPORTED", target: { table: "app.admission", id, row: {
        id, person_id: personId(survivor), centre_id: centreOf.get(k), academic_year: row["academic_year"]!.trim(),
        admission_no: row["admission_no"]!.trim(), admitted_on: on, created_on: on } } } });
    }
    return out;
  },
} satisfies Rule;
