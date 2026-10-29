// Learner contact and family details: the fixed lists, the keys and their validation (docs/designs/learner-details).
// Imports only person-rules.ts, so client components may import it (no database code in the browser bundle).
// The lists are PMC parameters (DD-2); migration 0015's checks mirror them, tests/learner-details.test.ts compares.
import { invalid } from "./person-rules";

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const EMPLOYMENT_STATUSES: Record<string, string> = {
  STUDENT: "Student", EMPLOYED: "Employed", SELF_EMPLOYED: "Self-employed", UNEMPLOYED: "Unemployed", NOT_KNOWN: "Not known",
};
export const QUALIFICATIONS: Record<string, string> = {
  BELOW_SSLC: "Below SSLC", SSLC: "SSLC", PLUS_TWO: "Plus Two", DIPLOMA: "Diploma", DEGREE: "Degree",
  POSTGRADUATE: "Postgraduate", OTHER: "Other", NOT_KNOWN: "Not known",
};
/** The 249 officially assigned ISO 3166-1 alpha-2 codes (DD-12); names come from Intl on the server. */
export const COUNTRY_CODES = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV "
  + "BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR "
  + "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG "
  + "KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX "
  + "MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG "
  + "SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG "
  + "VI VN VU WF WS YE YT ZA ZM ZW").split(" ");
export const DEFAULT_NATIONALITY = "IN";
/** Shown in the admit form's duplicate list (DD-13): typed details for an existing learner may be ignored. */
export const DETAILS_NOTE = "Details you typed are saved only if this learner has none yet; otherwise edit them on the learner's page.";

export const DETAIL_KEYS = ["currentAddress", "currentPlace", "currentPincode", "permanentAddress", "permanentPlace",
  "permanentPincode", "nationality", "bloodGroup", "employmentStatus", "qualification", "fatherName", "fatherOccupation",
  "fatherPhone", "motherName", "motherOccupation", "motherPhone", "guardianName", "guardianRelation", "guardianPhone",
  "guardianOccupation"] as const;
export type DetailKey = (typeof DETAIL_KEYS)[number];
export type Details = Record<DetailKey, string | null>;
/** Required on the forms (DD-6, DD-11); the database keeps them optional. */
export const REQUIRED_DETAILS: readonly DetailKey[] = ["currentPincode", "employmentStatus", "qualification"];
/** key -> column; the only source of column names in the detail SQL */
export const DETAIL_COLUMN = Object.fromEntries(DETAIL_KEYS.map((k) => [k, k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)])) as Record<DetailKey, string>;

const ADDRESS = new Set<DetailKey>(["currentAddress", "permanentAddress"]);
const MAX: Partial<Record<DetailKey, number>> = { currentAddress: 500, permanentAddress: 500, guardianRelation: 50 };
const PHONE = new Set<DetailKey>(["fatherPhone", "motherPhone", "guardianPhone"]);
const PINCODE = new Set<DetailKey>(["currentPincode", "permanentPincode"]);
const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_IN_ADDRESS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/; // tab, newline, carriage return allowed
const LONE_SURROGATE = /\p{Cs}/u;

/** One detail: null or "" clears; returns the stored form or throws invalid(key, rule); the key is also the input name. */
export function detailField(k: DetailKey, v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") throw invalid(k, "invalid");
  if (LONE_SURROGATE.test(v) || (ADDRESS.has(k) ? CONTROL_IN_ADDRESS : CONTROL).test(v)) throw invalid(k, "invalid characters");
  const s = v.trim();
  if (s === "") return null;
  if (PINCODE.has(k)) {
    if (!/^[1-9][0-9]{5}$/.test(s)) throw invalid(k, "6 digits, not starting with 0");
    return s;
  }
  if (PHONE.has(k)) {
    const digits = s.replace(/[\s-]/g, "").replace(/^(\+91|0)/, "");
    if (!/^\d{10}$/.test(digits)) throw invalid(k, "10 digits");
    return digits;
  }
  if (k === "nationality") {
    // ASCII first, so "ß" can never upper-case into a valid "SS"
    if (!/^[a-z]{2}$/i.test(s) || !COUNTRY_CODES.includes(s.toUpperCase())) throw invalid(k, "a country code");
    return s.toUpperCase();
  }
  if (k === "bloodGroup") {
    if (!(BLOOD_GROUPS as readonly string[]).includes(s)) throw invalid(k, "one of the listed values");
    return s;
  }
  if (k === "employmentStatus" || k === "qualification") {
    if (!Object.hasOwn(k === "qualification" ? QUALIFICATIONS : EMPLOYMENT_STATUSES, s)) throw invalid(k, "one of the listed values");
    return s;
  }
  const max = MAX[k] ?? 100;
  if ([...s].length > max) throw invalid(k, `1-${max} characters`); // code points, as char_length counts
  return s;
}

/** [code, English name] sorted by name; computed on the server and passed to client components (design R7). */
export function countryOptions(): [string, string][] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return COUNTRY_CODES.map((c) => [c, names.of(c) ?? c] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
}
