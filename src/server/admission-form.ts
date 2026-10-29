// The admission form's server logic (docs/designs/admission-screens/admission-screens.md, "The Admit Action").
// A plain function, so vitest covers it without a running server: the "use server" action in app/students/new
// only wraps it in pageRead() and redirects. Imports nothing from next/* or page-read.ts.
import { Forbidden } from "./action";
import { hasOrigin } from "./auth/http";
import { isConnectionLost, withScope } from "./db";
import { DETAIL_KEYS, REQUIRED_DETAILS, type Details } from "./details";
import { SeriesMissing } from "./numbering";
import { admit, AdmissionExists, PersonError, PossibleDuplicate, updateDetails, type AdmissionRow, type AdmitInput, type Candidate } from "./people";

/** The list page's search state (DD-13): the term travels only in the POST body. */
export type SearchState = { q: string; centreId: string; rows?: AdmissionRow[]; rateLimited?: boolean };

export type AdmitFormState = {
  values: Record<string, string>; // the known input names only (not $ACTION_* or extra fields)
  admissionId: string; // echoed from the posted form data; new only when the page reloads
  fieldErrors: Record<string, string>; // by input name, e.g. "course.2.courseCode"
  formError?: string;
  candidates?: Candidate[]; // from PossibleDuplicate
  savedPersonId?: string; // AdmissionExists, when the learner is in the caller's student.view scope
  enquiryId?: string; // the enquiry being enrolled (enquiry design DD-9), carried like admissionId
};

const ROWS = [1, 2, 3] as const; // DD-7
const COURSE_FIELDS = ["courseCode", "joinDate", "endDate"] as const;
/** The detail inputs shared by the admit and edit forms (learner-details Z4): the 20 keys and "same as current". */
export const DETAIL_NAMES: readonly string[] = [...DETAIL_KEYS, "permanentSame"];
export const FORM_NAMES = ["centreId", "academicYear", "admittedOn", "givenName", "familyName", "gender", "dateOfBirth", "mobile",
  "email", ...ROWS.flatMap((n) => COURSE_FIELDS.map((f) => `course.${n}.${f}`)), ...DETAIL_NAMES];

/**
 * The posted details: a key only when its input was posted (a posted "" clears, an absent input keeps the stored value;
 * design D3). "Same as current" copies the three posted current fields to the permanent ones (C16).
 */
export function detailsFrom(fd: FormData): Partial<Details> {
  const out: Partial<Details> = {};
  for (const k of DETAIL_KEYS) if (fd.has(k)) { const v = fd.get(k); out[k] = typeof v === "string" ? v : null; }
  if (fd.has("permanentSame")) {
    out.permanentAddress = out.currentAddress ?? null;
    out.permanentPlace = out.currentPlace ?? null;
    out.permanentPincode = out.currentPincode ?? null;
  }
  return out;
}
/** Required details by posted text: an absent required input counts as empty (design R12). */
const requiredDetails = (fd: FormData, errors: Record<string, string>) => {
  for (const k of REQUIRED_DETAILS) { const v = fd.get(k); if (typeof v !== "string" || !v.trim()) errors[k] = "required"; }
};

export const ADMIT_MESSAGES = {
  reload: "Reload the form and try again.",
  stale: "That person can no longer be linked; choose again.",
  series: "Numbering is not set up for this; contact the head office.",
  saved: "This form was already saved; nothing new was admitted.",
  thisYear: "Already admitted at this centre this year.",
  dropped: "The connection dropped. Submit again; this form cannot admit twice.",
  enquiryNotFound: "This enquiry is no longer available.",
  enquiryOtherCentre: "This enquiry belongs to another centre.",
  enquiryEnrolled: "This enquiry is already enrolled.",
  enquiryClosed: "This enquiry is closed (lost or junk).",
} as const;
const ENQUIRY_RULES: Record<string, string> = {
  "not found": ADMIT_MESSAGES.enquiryNotFound, "other centre": ADMIT_MESSAGES.enquiryOtherCentre,
  "already enrolled": ADMIT_MESSAGES.enquiryEnrolled, closed: ADMIT_MESSAGES.enquiryClosed,
};

/** Maps the posted form to admit() and its outcome to a redirect or the form state (G1–G3, DD-10…DD-16). */
export async function submitAdmission(session: string, h: Headers, fd: FormData): Promise<AdmitFormState | { redirect: string }> {
  if (!hasOrigin(h)) throw new Forbidden("missing Origin"); // Next refuses a foreign Origin, not a missing one
  const text = (name: string) => { const v = fd.get(name); return typeof v === "string" ? v : ""; };
  const values = Object.fromEntries(FORM_NAMES.map((n) => [n, text(n)]).filter(([, v]) => v !== ""));
  const state: AdmitFormState = { values, admissionId: text("admissionId"), fieldErrors: {},
    ...(text("enquiryId") ? { enquiryId: text("enquiryId") } : {}) };
  const fail = (patch: Partial<AdmitFormState>) => ({ ...state, ...patch });

  // ---------- map the form (an empty string means absent) ----------
  const existingId = text("existingId") || undefined;
  const confirmNew = text("confirmNew") ? text("confirmNew").split(",").filter(Boolean) : undefined;
  const opt = (name: string) => text(name).trim() || null;
  if (!text("centreId")) state.fieldErrors["centreId"] = "required";
  if (!existingId) for (const name of ["dateOfBirth", "mobile"]) if (!text(name)) state.fieldErrors[name] = "required"; // DD-14
  if (!existingId) requiredDetails(fd, state.fieldErrors); // learner-details DD-6
  const rowOf: number[] = []; // courses[i] came from form row rowOf[i]
  const courses: AdmitInput["courses"] = [];
  for (const n of ROWS) {
    const [courseCode, joinDate, endDate] = COURSE_FIELDS.map((f) => text(`course.${n}.${f}`));
    if (!courseCode && !joinDate && !endDate) continue; // an empty row is dropped
    rowOf.push(n);
    courses.push({ courseCode: courseCode!, joinDate: joinDate!, ...(endDate ? { endDate } : {}) });
  }
  if (courses.length === 0) state.fieldErrors["course.1.courseCode"] = "required";
  if (Object.keys(state.fieldErrors).length > 0) return state;

  const input: AdmitInput = {
    person: existingId ? { existingId } : {
      givenName: text("givenName"), familyName: opt("familyName"), gender: (opt("gender") as "MALE" | "FEMALE" | "OTHER" | null),
      dateOfBirth: opt("dateOfBirth"), mobile: opt("mobile"), email: opt("email"),
    },
    centreId: Number(text("centreId")), academicYear: text("academicYear"), admittedOn: text("admittedOn"), courses,
    admissionId: state.admissionId, ...(confirmNew ? { confirmNew } : {}), details: detailsFrom(fd),
    ...(state.enquiryId ? { enquiryId: state.enquiryId } : {}),
  };

  // ---------- admit and map the outcome ----------
  try {
    const r = await admit(session, input);
    return { redirect: `/students/${r.personId}` };
  } catch (e) {
    if (e instanceof PossibleDuplicate) return fail({ candidates: e.candidates });
    if (e instanceof AdmissionExists) {
      // the only place the student.view scope of this lookup lives (DD-11): outside it, name no one
      const [hit] = await withScope(session, (tx) => tx.$queryRaw<{ personId: string }[]>`
        select person_id::text as "personId" from app.admission
        where id = ${state.admissionId}::uuid and centre_id = any (app.scoped_centre_ids('student.view'))`);
      return fail({ formError: ADMIT_MESSAGES.saved, ...(hit ? { savedPersonId: hit.personId } : {}) });
    }
    if (e instanceof SeriesMissing) return fail({ formError: ADMIT_MESSAGES.series });
    if (e instanceof PersonError) {
      if (e.reason === "notfound") return fail({ formError: ADMIT_MESSAGES.stale }); // only from a stale existingId
      if (e.field === "admissionId") return fail({ formError: ADMIT_MESSAGES.reload });
      if (e.field === "admission") return fail({ formError: ADMIT_MESSAGES.thisYear });
      if (e.field === "details") return fail({ formError: e.rule! }); // learner-details I7
      if (e.field === "enquiry") return fail({ formError: Object.hasOwn(ENQUIRY_RULES, e.rule!) ? ENQUIRY_RULES[e.rule!] : e.message });
      const row = /^courses\[(\d+)\]\.(\w+)$/.exec(e.field ?? "");
      const name = row ? `course.${rowOf[Number(row[1])]}.${row[2]}` : e.field;
      if (name && FORM_NAMES.includes(name)) return fail({ fieldErrors: { [name]: e.rule! } });
      return fail({ formError: e.message });
    }
    // only a loss during COMMIT reaches here (withScope retries earlier ones); a resubmit is safe (DD-14)
    if (isConnectionLost(e)) return fail({ formError: ADMIT_MESSAGES.dropped });
    throw e;
  }
}

// ---------- The learner-details edit form (docs/designs/learner-details, "Edit Path") ----------

export type DetailsFormState = { values: Record<string, string>; personId: string; centreId: string; version: string;
  fieldErrors: Record<string, string>; formError?: string };

/** Maps the posted edit form to updateDetails(). Forbidden and not-found are not caught: pageRead() answers 404. */
export async function submitDetails(session: string, h: Headers, fd: FormData): Promise<DetailsFormState | { redirect: string }> {
  if (!hasOrigin(h)) throw new Forbidden("missing Origin");
  const text = (name: string) => { const v = fd.get(name); return typeof v === "string" ? v : ""; };
  const state: DetailsFormState = {
    values: Object.fromEntries(DETAIL_NAMES.map((n) => [n, text(n)]).filter(([, v]) => v !== "")),
    personId: text("personId"), centreId: text("centreId"), version: text("version"), fieldErrors: {},
  };
  requiredDetails(fd, state.fieldErrors); // required on every edit (DD-11)
  if (Object.keys(state.fieldErrors).length > 0) return state;
  try {
    await updateDetails(session, state.personId, state.centreId, state.version, detailsFrom(fd));
    return { redirect: `/students/${state.personId}` };
  } catch (e) {
    if (e instanceof PersonError && e.reason === "invalid") {
      if (e.field === "details") return { ...state, formError: e.rule! }; // stale or nothing to change: reload says it
      if (e.field && DETAIL_NAMES.includes(e.field)) return { ...state, fieldErrors: { [e.field]: e.rule! } };
      return { ...state, formError: e.message };
    }
    throw e;
  }
}
