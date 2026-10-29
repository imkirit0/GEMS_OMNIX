// The enquiry pages' server logic (docs/designs/enquiry/enquiry.md, R5). Plain functions, so vitest covers them without
// a running server: the "use server" actions in app/enquiries only wrap them in pageRead() and redirect. Imports nothing
// from next/* or page-read.ts. Forbidden and not-found are not caught: pageRead() answers 404 (parity).
import { Forbidden } from "./action";
import { hasOrigin } from "./auth/http";
import { withScope } from "./db";
import { addFollowUp, createEnquiry, getEnquiry, listEnquiries, SameMobile, setCounsellor, setEnquiryStatus, updateEnquiry,
  type EnquiryChanges, type EnquiryFilter, type EnquiryInput, type EnquiryRow, type Warning } from "./enquiry";
import { RateLimited } from "./exports";
import { PersonError } from "./person-rules";
import { DEFAULT_NATIONALITY } from "./details";

export const ENQUIRY_MESSAGES = {
  rateLimited: "Too many searches or new enquiries in a minute. Wait a minute and try again.",
  sameMobile: "This mobile number is already known. Check the matches below, then save anyway if this is a different enquiry.",
  enrolled: "This enquiry is enrolled and can no longer change.",
  stale: "This enquiry changed since you opened it. Reload the page.",
  nothing: "Nothing to change.",
  centreInactive: "This centre is not active yet.",
} as const;

/** The enquiry form's inputs (create and edit); course rows are course1..course3. */
export const ENQUIRY_NAMES = ["centreId", "givenName", "familyName", "dateOfBirth", "gender", "mobile", "email", "currentAddress",
  "currentPincode", "qualification", "guardianName", "guardianPhone", "whatsapp", "landline", "instagram", "lastSchool", "remark",
  "pathId", "typeId", "statusId", "enquiredOn", "course1", "course2", "course3"] as const;
const TEXT_FIELDS = ["givenName", "familyName", "dateOfBirth", "gender", "mobile", "email", "currentAddress", "currentPincode",
  "qualification", "guardianName", "guardianPhone", "whatsapp", "landline", "instagram", "lastSchool", "remark"] as const;

export type EnquiryFormState = { values: Record<string, string>; fieldErrors: Record<string, string>; formError?: string;
  warnings?: Warning[]; confirm?: string; rateLimited?: boolean; id?: string; version?: string };
export type RecordFormState = { formError?: string; fieldErrors: Record<string, string> };
export type EnquirySearchState = { q: string; rows?: EnquiryRow[]; rateLimited?: boolean };

const reader = (fd: FormData) => (name: string) => { const v = fd.get(name); return typeof v === "string" ? v : ""; };
const num = (s: string) => (/^\d{1,9}$/.test(s) ? Number(s) : NaN);
/** A field error to its input: courseCodes[i] -> course{i+1}; others by name; the rest is a form error. */
function routeError(e: PersonError, names: readonly string[]): { fieldErrors?: Record<string, string>; formError?: string } {
  const course = /^courseCodes(?:\[(\d)\])?$/.exec(e.field ?? "");
  const name = course ? `course${Number(course[1] ?? 0) + 1}` : e.field;
  if (e.field === "centreId" && e.rule === "centre is not active") return { formError: ENQUIRY_MESSAGES.centreInactive };
  if (e.field === "enquiry") {
    const known: Record<string, string> = { enrolled: ENQUIRY_MESSAGES.enrolled, nothing: ENQUIRY_MESSAGES.nothing };
    const key = e.rule?.startsWith("changed") ? "stale" : e.rule === "nothing to change" ? "nothing" : e.rule === "enrolled" ? "enrolled" : "";
    return { formError: key === "stale" ? ENQUIRY_MESSAGES.stale : known[key] ?? e.message };
  }
  if (name && names.includes(name)) return { fieldErrors: { [name]: e.rule! } };
  return { formError: e.message };
}
const courseList = (t: (n: string) => string) => ["course1", "course2", "course3"].map(t).map((c) => c.trim()).filter(Boolean);

/** Create: same-mobile warnings first; "Save anyway" posts the shown ids as confirm (DD-10). */
export async function submitEnquiry(session: string, h: Headers, fd: FormData): Promise<EnquiryFormState | { redirect: string }> {
  if (!hasOrigin(h)) throw new Forbidden("missing Origin");
  const t = reader(fd);
  const values = Object.fromEntries(ENQUIRY_NAMES.map((n) => [n, t(n)]).filter(([, v]) => v !== ""));
  const state: EnquiryFormState = { values, fieldErrors: {} };
  for (const n of ["centreId", "pathId", "typeId"]) if (!t(n)) state.fieldErrors[n] = "required";
  if (Object.keys(state.fieldErrors).length > 0) return state;
  const input = {
    centreId: num(t("centreId")), pathId: num(t("pathId")), typeId: num(t("typeId")),
    ...(t("statusId") ? { statusId: num(t("statusId")) } : {}), ...(t("enquiredOn") ? { enquiredOn: t("enquiredOn") } : {}),
    courseCodes: courseList(t),
    ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, t(k)])),
  } as unknown as EnquiryInput;
  const confirm = t("confirm") ? t("confirm").split(",").filter(Boolean) : [];
  try {
    const r = await createEnquiry(session, input, confirm);
    return { redirect: `/enquiries/${r.id}?saved=1` };
  } catch (e) {
    if (e instanceof SameMobile) {
      return { ...state, warnings: e.warnings, confirm: e.warnings.map((w) => (w.kind === "enquiry" ? w.id : w.personId)).join(","),
        formError: ENQUIRY_MESSAGES.sameMobile };
    }
    if (e instanceof RateLimited) return { ...state, rateLimited: true, formError: ENQUIRY_MESSAGES.rateLimited };
    if (e instanceof PersonError && e.reason === "invalid") return { ...state, ...routeError(e, ENQUIRY_NAMES) };
    throw e;
  }
}

/** Edit the record: every posted field; an empty optional input clears it. */
export async function submitEnquiryEdit(session: string, h: Headers, fd: FormData): Promise<EnquiryFormState | { redirect: string }> {
  if (!hasOrigin(h)) throw new Forbidden("missing Origin");
  const t = reader(fd);
  const values = Object.fromEntries(ENQUIRY_NAMES.map((n) => [n, t(n)]).filter(([, v]) => v !== ""));
  const state: EnquiryFormState = { values, fieldErrors: {}, id: t("id"), version: t("version") };
  const changes = {
    pathId: num(t("pathId")), typeId: num(t("typeId")), courseCodes: courseList(t),
    ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, t(k) === "" ? null : t(k)])),
  } as unknown as EnquiryChanges;
  try {
    await updateEnquiry(session, num(t("centreId")), t("id"), num(t("version")), changes);
    return { redirect: `/enquiries/${t("id")}?saved=1` };
  } catch (e) {
    if (e instanceof PersonError && e.reason === "invalid") return { ...state, ...routeError(e, ENQUIRY_NAMES) };
    throw e;
  }
}

const recordError = (e: unknown, names: readonly string[]): RecordFormState => {
  if (e instanceof PersonError && e.reason === "invalid") return { fieldErrors: {}, ...routeError(e, names) };
  throw e;
};

/** Status change on the record page (one id). */
export async function submitEnquiryStatus(session: string, h: Headers, fd: FormData): Promise<RecordFormState | { redirect: string }> {
  if (!hasOrigin(h)) throw new Forbidden("missing Origin");
  const t = reader(fd);
  try {
    await setEnquiryStatus(session, num(t("centreId")), [t("id")], num(t("statusId")), t("note").trim() || null);
    return { redirect: `/enquiries/${t("id")}?saved=1` };
  } catch (e) { return recordError(e, ["statusId", "note"]); }
}

/** Counsellor on the record page; "" clears. */
export async function submitCounsellor(session: string, h: Headers, fd: FormData): Promise<RecordFormState | { redirect: string }> {
  if (!hasOrigin(h)) throw new Forbidden("missing Origin");
  const t = reader(fd);
  try {
    await setCounsellor(session, num(t("centreId")), [t("id")], t("userId") || null);
    return { redirect: `/enquiries/${t("id")}?saved=1` };
  } catch (e) { return recordError(e, ["userId"]); }
}

/** A follow-up; an empty date keeps the next follow-up date, "clear" clears it (D11). */
export async function submitFollowUp(session: string, h: Headers, fd: FormData): Promise<RecordFormState | { redirect: string }> {
  if (!hasOrigin(h)) throw new Forbidden("missing Origin");
  const t = reader(fd);
  const duration = t("durationMin").trim();
  const f = { kind: t("kind"), note: t("note"), durationMin: duration === "" ? null : (/^\d{1,4}$/.test(duration) ? Number(duration) : -1),
    ...(t("clearNext") === "1" ? { nextOn: null } : t("nextOn") ? { nextOn: t("nextOn") } : {}) };
  try {
    await addFollowUp(session, num(t("centreId")), t("id"), f);
    return { redirect: `/enquiries/${t("id")}?saved=1` };
  } catch (e) { return recordError(e, ["kind", "note", "durationMin", "nextOn"]); }
}

/** Bulk status or counsellor from the list (DD-12): the ids of one centre, all or nothing. */
export async function submitBulk(session: string, h: Headers, fd: FormData): Promise<RecordFormState | { redirect: string }> {
  if (!hasOrigin(h)) throw new Forbidden("missing Origin");
  const t = reader(fd);
  const ids = fd.getAll("id").map(String);
  const centreId = num(t("centreId"));
  try {
    if (!Number.isSafeInteger(centreId)) return { fieldErrors: { centreId: "choose a centre filter first" } };
    const r = t("op") === "counsellor"
      ? await setCounsellor(session, centreId, ids, t("userId") || null)
      : await setEnquiryStatus(session, centreId, ids, num(t("statusId")), t("note").trim() || null);
    return { redirect: `/enquiries?centre=${centreId}&done=${r.count}` };
  } catch (e) { return recordError(e, ["ids", "statusId", "note", "userId"]); }
}

/** The list's search: q travels only in this POST body (Z5). */
export async function searchEnquiries(session: string, fd: FormData, filter: EnquiryFilter): Promise<EnquirySearchState> {
  const q = reader(fd)("q").trim();
  try {
    return { q, rows: await listEnquiries(session, { ...filter, q }) };
  } catch (e) {
    if (e instanceof RateLimited) return { q, rateLimited: true };
    throw e;
  }
}

export type Prefill = { values: Record<string, string>; also: { code: string; name: string; offered: boolean }[] };
/** The admission form's pre-fill from an enquiry (DD-9, D17): only preference 1 fills a course row; 404 unless it may enrol. */
export async function enrolPrefill(session: string, id: string): Promise<Prefill> {
  const g = await getEnquiry(session, id);
  if (!g.canEnrol) throw new PersonError("notfound"); // not permitted, enrolled, lost or junk: the same 404
  const e = g.enquiry as Record<string, unknown>;
  const pick = ["givenName", "familyName", "dateOfBirth", "gender", "mobile", "email", "currentAddress", "currentPincode",
    "qualification", "guardianName", "guardianPhone"];
  const values: Record<string, string> = { nationality: DEFAULT_NATIONALITY, centreId: String(e["centreId"]) };
  for (const k of pick) if (typeof e[k] === "string" && e[k] !== "") values[k] = e[k] as string;
  const codes = g.enquiry.courseCodes;
  const courses = await withScope(session, (tx) => tx.$queryRaw<{ code: string; name: string; offered: boolean }[]>`
    select code, name, active and visible as offered from app.course where code = any (${codes}::text[])`);
  const byCode = new Map(courses.map((c) => [c.code, c]));
  const first = byCode.get(codes[0]!);
  if (first?.offered) values["course.1.courseCode"] = first.code;
  const also = codes.map((c) => byCode.get(c)).filter((c): c is NonNullable<typeof c> => !!c && (c.code !== first?.code || !c.offered));
  return { values, also };
}
