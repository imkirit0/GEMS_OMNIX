// Registration mapping rule (design: "Entities in P8"): legacy course rows under their imported admission.
import { isoDate, normCode, PersonError } from "../../src/server/people";
import { targetName } from "../ids";
import { SOURCE_SYSTEM, type Ctx, type RawRow, type Result, type RuleError, type Rule } from "../types";

const TABLE = "legacy_course_row";
// XL-5: legacy status values, trimmed and case-insensitive. Changing the map changes the code hash.
export const STATUS_MAP: Record<string, string> = { active: "ACTIVE", drop: "DROP", leave: "LEAVE", transfer: "TRANSFER" };

const admissionParent = (row: RawRow) => {
  const k = (row["admission_key"] ?? "").trim();
  return k ? { entity: "admission", sourceKey: k } : null;
};

export const registration = {
  id: "registration", version: 2, owner: "Certification", sourceTable: TABLE, entities: ["registration"],
  description: "Legacy course rows to registrations under their imported admission; status by STATUS_MAP",
  dispositions: { registration: ["IMPORTED", "REJECTED"] },
  parent: { registration: admissionParent },
  map(rows: RawRow[], ctx: Ctx) {
    const out = new Map<string, Record<string, Result>>();
    const usedNo = new Set<string>();
    for (const row of rows) {
      const errors: RuleError[] = [];
      const v = (c: string) => row[c] ?? null;
      const parent = admissionParent(row);
      const adm = parent ? ctx.result("admission", parent.sourceKey) : undefined;
      if (adm?.disposition !== "IMPORTED" || !("target" in adm)) errors.push({ field: "admission_key", message: "admission not imported", value: v("admission_key") });
      const code = normCode((v("course_code") ?? "").trim());
      if (!code) errors.push({ field: "course_code", message: "required", value: v("course_code") });
      else if (!ctx.courses.has(code)) errors.push({ field: "course_code", message: "no such course", value: v("course_code") }); // existence only (DD-11)
      const join = (v("join_date") ?? "").trim();
      try { isoDate("joinDate", join); } catch (e) {
        if (!(e instanceof PersonError)) throw e;
        errors.push({ field: "join_date", message: e.message.slice(e.message.indexOf(":") + 2), value: v("join_date") });
      }
      const status = STATUS_MAP[(v("status") ?? "").trim().toLowerCase()];
      if (!status) errors.push({ field: "status", message: "not in the status map", value: v("status") });
      const no = (v("register_no") ?? "").trim();
      if (!/^\d+$/.test(no)) errors.push({ field: "register_no", message: "digits only", value: v("register_no") });
      else if (usedNo.has(no)) errors.push({ field: "register_no", message: "duplicate", value: v("register_no") });
      if (errors.length) { out.set(row.source_key, { registration: { disposition: "REJECTED", errors } }); continue; }
      usedNo.add(no);
      const a = (adm as { target: { id: string; row: Record<string, unknown> } }).target;
      const id = ctx.id(targetName(SOURCE_SYSTEM, TABLE, row.source_key, "app.registration"));
      out.set(row.source_key, { registration: { disposition: "IMPORTED", target: { table: "app.registration", id, row: {
        id, admission_id: a.id, centre_id: a.row["centre_id"], course_code: code, register_no: no, status,
        join_date: join, created_on: join } } } });
    }
    return out;
  },
} satisfies Rule;
