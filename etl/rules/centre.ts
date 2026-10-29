// Centre mapping rule (design: "Entities in P8"). Matches legacy centres to existing app.centre rows; writes none.
import { normCode } from "../../src/server/people";
import type { Result, Rule } from "../types";

export const TEST_CENTRES = ["GDEMO", "KL-01-TEST3", "KL-01-TEST6"]; // X14; approval pending (cutover approval of this rule)

export const centre: Rule = {
  id: "centre", version: 3, owner: "Operations", sourceTable: "legacy_centre", entities: ["centre"],
  description: "Legacy centres to existing GEMS centres by normalised code (normCode); X14 test centres excluded",
  dispositions: { centre: ["IMPORTED", "EXCLUDED", "REJECTED"] },
  map(rows, ctx) {
    const out = new Map<string, Record<string, Result>>();
    const seen = new Set<string>();
    for (const row of rows) {
      const code = normCode(row["code"] ?? null);
      let r: Result;
      if (seen.has(code)) r = { disposition: "REJECTED", errors: [{ field: "code", message: "duplicate centre code", value: row["code"] ?? null }] };
      else if (TEST_CENTRES.includes(code)) r = { disposition: "EXCLUDED", reason: "test centre" };
      else {
        const hit = ctx.centres.find((c) => c.code === code);
        r = hit ? { disposition: "IMPORTED", existing: { table: "app.centre", id: String(hit.id) } }
          : { disposition: "REJECTED", errors: [{ field: "code", message: "no such centre", value: row["code"] ?? null }] };
      }
      seen.add(code);
      out.set(row.source_key, { centre: r });
    }
    return out;
  },
};
