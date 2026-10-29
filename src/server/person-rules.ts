// Person rules shared with the migration framework's mapping rules (learner-details design, Z3/I3): exactly what
// the rules import, hashed with every rule (etl/canonical.ts). No imports, so it can never reach the database or
// pull more code into the hash. people.ts re-exports all of it; app code keeps importing people.ts.
export type Gender = "MALE" | "FEMALE" | "OTHER";
export type Identity = {
  givenName: string; familyName?: string | null; gender?: Gender | null;
  dateOfBirth?: string | null; mobile?: string | null; email?: string | null; // dates are 'YYYY-MM-DD'
};

export class PersonError extends Error {
  override name = "PersonError";
  /** field and rule are set by invalid(): the admission form routes the error to its input by them */
  constructor(readonly reason: "invalid" | "notfound", message: string = reason, readonly field?: string, readonly rule?: string) {
    super(message);
  }
}

export const invalid = (field: string, rule: string) => new PersonError("invalid", `${field}: ${rule}`, field, rule);

// ---------- Validation (design item 7) ----------

export const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10); // Asia/Kolkata, no DST

export function isoDate(field: string, v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw invalid(field, "YYYY-MM-DD");
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw invalid(field, "not a date");
  return v;
}

export const optText = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

// One field of an identity; null clears it (except givenName). Returns the stored form.
export function identityField(k: keyof Identity, v: unknown): string | null {
  if (k === "givenName") {
    const s = typeof v === "string" ? v.trim() : "";
    if (s.length < 1 || s.length > 100) throw invalid("givenName", "1-100 characters");
    return s;
  }
  if (v == null) return null;
  switch (k) {
    case "familyName": {
      const s = optText(v);
      if (s && s.length > 100) throw invalid("familyName", "at most 100 characters");
      return s;
    }
    case "gender":
      if (v !== "MALE" && v !== "FEMALE" && v !== "OTHER") throw invalid("gender", "MALE, FEMALE or OTHER");
      return v;
    case "dateOfBirth": {
      const s = isoDate("dateOfBirth", v);
      if (s >= istToday()) throw invalid("dateOfBirth", "must be in the past");
      return s;
    }
    case "mobile": {
      const digits = typeof v === "string" ? v.replace(/[\s-]/g, "").replace(/^(\+91|0)/, "") : "";
      if (!/^\d{10}$/.test(digits)) throw invalid("mobile", "10 digits");
      return digits;
    }
    case "email": {
      const s = optText(v);
      if (s && s.split("@").length !== 2) throw invalid("email", "one @");
      return s;
    }
  }
}

export const IDENTITY_KEYS = ["givenName", "familyName", "gender", "dateOfBirth", "mobile", "email"] as const;
export type StoredIdentity = Record<(typeof IDENTITY_KEYS)[number], string | null>;

export const ACADEMIC_YEAR_RULE = "YYYY-YY, consecutive years";
export const ADMITTED_THIS_YEAR = "already admitted at this centre this year"; // admission-screens DD-16, shared with the ETL rule
export function academicYearOk(y: string): boolean {
  return /^\d{4}-\d{2}$/.test(y) && Number(y.slice(5)) === (Number(y.slice(0, 4)) + 1) % 100;
}
// Catalogue codes (docs/designs/catalogue-skeleton, DD-8). Every writer of a code and every ETL rule uses this one function.
const ASCII_SPACE = /[\t\n\v\f\r ]+/g;
/** ASCII input: trim ASCII whitespace, collapse inner runs to one space, upper-case. Non-ASCII input is returned
 *  unchanged, so it fails the code check instead of being folded (ß would become SS). Non-strings give "". */
export const normCode = (v: unknown): string => {
  if (typeof v !== "string") return "";
  if (/[^\x00-\x7f]/.test(v)) return v;
  return v.replace(ASCII_SPACE, " ").replace(/^ | $/g, "").toUpperCase();
};
