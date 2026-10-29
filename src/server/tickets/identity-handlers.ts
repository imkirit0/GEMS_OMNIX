// Identity correction handlers (docs/designs/correction-tickets, DD-1): one per identity field, built by one factory.
// A centre names the learner by Admission No and the new value; the old value is read from the record at raise and
// re-checked under the person lock at the final approval; the approval applies it through changeIdentity().
// Imports errors.ts, never handlers.ts at runtime (no cycle with the registry).
import type { Tx } from "../db";
import { approverMatches, changeIdentity, identityField, IDENTITY_KEYS, PersonError, type IdentityChanges } from "../people";
import { TicketError } from "./errors";
import type { TicketField, TicketHandler, TicketRow } from "./handlers";

type IdentityKey = (typeof IDENTITY_KEYS)[number];
type Raw = { admissionNo: string; newValue: string | null };
export type IdentityPayload = { admissionNo: string; personId: string; field: IdentityKey; oldValue: string | null; newValue: string | null };
type IdentityRow = Record<IdentityKey, string | null>;

const LABEL: Record<IdentityKey, string> = {
  givenName: "Given name", familyName: "Family name", dateOfBirth: "Date of birth", gender: "Gender", mobile: "Mobile", email: "Email",
};
const GENDERS: [string, string][] = [["MALE", "Male"], ["FEMALE", "Female"], ["OTHER", "Other"]];
const CLEARABLE = new Set<IdentityKey>(["familyName", "mobile", "email"]);
const KEYED = new Set<IdentityKey>(["givenName", "familyName", "dateOfBirth", "mobile"]); // fields in the match key

const invalid = (key: string) => new TicketError("invalid", key);

/** The six identity columns as text, camelCase; locked for the final approval (design Z1). */
async function readIdentity(tx: Tx, personId: string, lock: boolean): Promise<IdentityRow | undefined> {
  const rows = lock
    ? await tx.$queryRaw<IdentityRow[]>`select given_name as "givenName", family_name as "familyName", gender::text as gender,
        date_of_birth::text as "dateOfBirth", mobile, email from app.person where id = ${personId}::uuid for update`
    : await tx.$queryRaw<IdentityRow[]>`select given_name as "givenName", family_name as "familyName", gender::text as gender,
        date_of_birth::text as "dateOfBirth", mobile, email from app.person where id = ${personId}::uuid`;
  return rows[0];
}

/** The match key of the identity with the corrected value put in; null when date of birth or mobile is missing. */
async function correctedKey(tx: Tx, row: IdentityRow, field: IdentityKey, newValue: string | null): Promise<string | null> {
  const c = { ...row, [field]: newValue };
  const [r] = await tx.$queryRaw<{ key: string | null }[]>`
    select app.person_match_key(${c.givenName}, ${c.familyName}, ${c.dateOfBirth}::date, ${c.mobile}) as key`;
  return r?.key ?? null;
}

const shown = (field: IdentityKey, v: string | null) =>
  v == null ? "(empty)" : field === "gender" ? GENDERS.find(([k]) => k === v)?.[1] ?? v : v;

function identityHandler(field: IdentityKey): TicketHandler<IdentityPayload, Raw> {
  const valueField: TicketField = field === "gender"
    ? { name: "newValue", label: "New gender", kind: "select", options: GENDERS }
    : { name: "newValue", label: `New ${LABEL[field].toLowerCase()}`, kind: field === "dateOfBirth" ? "date" : "text" };
  return {
    key: `identity.${field}`,
    fields: [{ name: "admissionNo", label: "Admission No", kind: "text" }, valueField],
    valuesPermission: "student.view",
    parse(p) {
      const admissionNo = (p["admissionNo"] ?? "").trim();
      if (!admissionNo) throw invalid("admissionNo.required");
      if (admissionNo.length > 40) throw invalid("admission.unknown");
      const raw = (p["newValue"] ?? "").trim();
      if (!raw) {
        if (!CLEARABLE.has(field)) throw invalid("newValue.required");
        return { admissionNo, newValue: null };
      }
      try { return { admissionNo, newValue: identityField(field, raw) }; } catch (e) {
        if (e instanceof PersonError) throw invalid("newValue.format");
        throw e;
      }
    },
    async prepare(tx, { centreId, payload, source }) {
      // admission and person RLS admit any role at the centre: this check is what limits raising to student.view (DD-13)
      const [may] = await tx.$queryRaw<{ ok: boolean }[]>`select app.has_permission('student.view', ${centreId}::int) as ok`;
      if (!may?.ok) throw invalid("admission.unknown");
      const [a] = await tx.$queryRaw<{ personId: string }[]>`
        select person_id::text as "personId" from app.admission where admission_no = ${payload.admissionNo} and centre_id = ${centreId}`;
      if (!a) throw invalid("admission.unknown");
      if (source !== undefined) { // a re-raise is for the same learner (DD-15); a payload of another shape is not
        const s = source as Partial<IdentityPayload> | null;
        if (typeof s?.personId !== "string" || s.personId !== a.personId) throw invalid("reraise.person");
      }
      const row = await readIdentity(tx, a.personId, false);
      if (!row) throw invalid("admission.unknown");
      if (row[field] === payload.newValue) throw invalid("newValue.same");
      return { admissionNo: payload.admissionNo, personId: a.personId, field, oldValue: row[field], newValue: payload.newValue };
    },
    async validate() {}, // prepare did the checks
    async revalidate(tx, t: TicketRow<IdentityPayload>) {
      const row = await readIdentity(tx, t.payload.personId, true); // two approvals on one learner queue here (Z1)
      if (!row || row[field] !== t.payload.oldValue) throw new TicketError("stale", "changed");
      if (t.payload.newValue != null) {
        try { identityField(field, t.payload.newValue); } catch { throw new TicketError("stale", "format"); } // D8
      }
    },
    async apply(tx, t) {
      const row = await readIdentity(tx, t.payload.personId, true);
      if (row && KEYED.has(field)) {
        const key = await correctedKey(tx, row, field, t.payload.newValue);
        // the lock admit() takes for this key, so a concurrent admission sees the corrected identity (D7)
        if (key) await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${key}))`;
      }
      await changeIdentity(tx, t.centreId, t.payload.personId, { [field]: t.payload.newValue } as IdentityChanges);
      return { before: { fields: [field] }, after: { fields: [field] } }; // no values in the audit row (DD-7)
    },
    ...(KEYED.has(field) ? {
      async review(tx: Tx, { payload }: { centreId: number; payload: IdentityPayload }) {
        const row = await readIdentity(tx, payload.personId, false);
        const key = row ? await correctedKey(tx, row, field, payload.newValue) : null;
        if (!key) return { lines: ["Duplicate check not possible: date of birth or mobile missing"], matches: [] };
        const found = await approverMatches(tx, key, payload.personId);
        if (found.length === 0) return { lines: ["No likely duplicates at centres you approve for"], matches: [] };
        return {
          lines: found.map((m) => `Possible duplicate: ${m.admissionNo} at ${m.centreCode}`
            + (m.named ? `, ${m.givenName} ${m.familyName ?? ""}`.trimEnd() + `, born ${m.dateOfBirth ?? "unknown"}` : "")),
          matches: [...new Set(found.map((m) => m.personId))],
        };
      },
    } : {}),
    describe(p) {
      return [["Admission No", p.admissionNo], ["Field", LABEL[field]], ["Old value", shown(field, p.oldValue)], ["New value", shown(field, p.newValue)]];
    },
    invalidMessages: {
      "admissionNo.required": "Enter the Admission No.",
      "admission.unknown": "No admission with that number at this centre.",
      "newValue.required": "Enter the new value.",
      "newValue.format": "The new value is not in the right format.",
      "newValue.same": "That is already the learner's value.",
      "reraise.person": "A re-raise must be for the same learner; raise a new ticket instead.",
    },
    staleMessages: {
      changed: "The learner's record changed after this ticket was raised. Reject it, so the centre can re-raise it with the current value.",
      format: "The new value no longer meets the rules. Reject it, so the centre can re-raise it.",
    },
  };
}

export const IDENTITY_HANDLERS = IDENTITY_KEYS.map(identityHandler);
