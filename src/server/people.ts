// Person, admission and registration core, Stage 2 (docs/designs/person-core/person-core.md, Approved 2026-10-28).
// A network-wide person is visible to a centre only through an admission it holds (RLS, 0011). Admitting is one
// scopedAction(): authorise, write person/admission/registrations with their numbers, audit person.admit.
import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { authorize, Forbidden, scopedAction } from "./action";
import { withScope, type Tx } from "./db";
import { allocateGlobal } from "./numbering";
import { limitSearch } from "./rate-limit";
import { ACADEMIC_YEAR_RULE, academicYearOk, ADMITTED_THIS_YEAR, identityField, IDENTITY_KEYS, invalid, isoDate, normCode,
  istToday, optText, PersonError, type Gender, type Identity, type StoredIdentity } from "./person-rules";
export * from "./person-rules";
import { DETAIL_COLUMN, DETAIL_KEYS, detailField, type DetailKey, type Details } from "./details";
import type { OfferCentre, OfferCourse } from "./course-offer";

// Course availability (course-master DD-2): recorded now, enforced only when this switch is on. Committed false;
// tests that switch it reset it in afterEach.
export const CATALOGUE_GATES = { enforceAvailability: false };

// PMC (NP-2, NP-5, NP-7, NP-8): format pieces are parameters until the numbering owners sign.
export const PERSON_POLICY = {
  admissionPrefix: (academicYear: string) => `GTEC${academicYear.slice(2, 4)}${academicYear.slice(5, 7)}`, // 2026-27 -> GTEC2627
  admissionPad: 0,
  registerPad: 0,
} as const;

export type Course = { courseCode: string; joinDate: string; endDate?: string };

/** The form's admissionId was already used (admission-screens DD-10): nothing new was admitted. */
export class AdmissionExists extends Error {
  override name = "AdmissionExists";
}
export type Candidate = { id: string; givenName: string; familyName: string | null; dateOfBirth: string | null };
export class PossibleDuplicate extends Error {
  override name = "PossibleDuplicate";
  constructor(readonly candidates: Candidate[]) { super(`${candidates.length} possible duplicate(s)`); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


function identity(p: Identity): StoredIdentity {
  return Object.fromEntries(IDENTITY_KEYS.map((k) => [k, identityField(k, p[k])])) as StoredIdentity;
}

export const CODE_RULE = /^[!-~]+( [!-~]+)*$/; // the <table>_code_check of migration 0012, mirrored for field errors

export const previousYear = (y: string) => `${Number(y.slice(0, 4)) - 1}-${y.slice(2, 4)}`; // 2026-27 -> 2025-26

function courses(list: unknown): Course[] {
  if (!Array.isArray(list) || list.length === 0) throw invalid("courses", "at least one");
  return list.map((c: Partial<Course>, i) => {
    if (!optText(c?.courseCode)) throw invalid(`courses[${i}].courseCode`, "required");
    const courseCode = normCode(c.courseCode); // a non-ASCII code is kept and fails as "no such course"
    const joinDate = isoDate(`courses[${i}].joinDate`, c.joinDate);
    const endDate = c.endDate == null ? undefined : isoDate(`courses[${i}].endDate`, c.endDate);
    if (endDate && endDate < joinDate) throw invalid(`courses[${i}].endDate`, "not before joinDate");
    return { courseCode, joinDate, ...(endDate ? { endDate } : {}) };
  });
}

// ---------- Database errors (in the style of ticketDb) ----------
type PgCause = { originalCode?: string; originalMessage?: string };
async function personDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const cause = (e as { meta?: { driverAdapterError?: { cause?: PgCause } } }).meta?.driverAdapterError?.cause;
    const code = cause?.originalCode;
    const constraint = /constraint "([^"]+)"/.exec(cause?.originalMessage ?? "")?.[1];
    if (code === "23514" && constraint === "admission_academic_year_check") throw invalid("academicYear", ACADEMIC_YEAR_RULE);
    // a detail check the app's own validation should have caught: a field error, never the failing row (learner-details D8)
    const detailCheck = code === "23514" ? /^person_detail_(\w+)_check$/.exec(constraint ?? "")?.[1] : undefined;
    const detailKey = detailCheck && DETAIL_KEYS.find((k) => DETAIL_COLUMN[k] === detailCheck);
    if (detailKey) throw invalid(detailKey, "invalid");
    if (code === "23505" && (constraint === "admission_admission_no_key" || constraint === "registration_register_no_key"))
      throw new PersonError("invalid", "number already issued");
    // an admissionId used where this caller's RLS cannot see it, or a concurrent submit of one form (DD-10)
    if (code === "23505" && constraint === "admission_pkey") throw new AdmissionExists();
    if (code === "23505" && constraint === "admission_person_centre_year_key") throw invalid("admission", ADMITTED_THIS_YEAR); // DD-16
    if (code === "23503") throw new PersonError("invalid", "inconsistent reference");
    if (code === "22P02") throw new PersonError("invalid", "malformed value");
    if (code === "42501") throw new Forbidden(cause?.originalMessage ?? "forbidden"); // audited as DENIED by scopedAction
    throw e;
  }
}


// ---------- Details (docs/designs/learner-details) ----------
// Static SQL over all 20 columns: no caller-supplied name reaches SQL (design D11, R17).
const readDetails = async (tx: Tx, personId: string) => (await tx.$queryRaw<(Details & { version: number })[]>`
  select current_address as "currentAddress",
         current_place as "currentPlace",
         current_pincode as "currentPincode",
         permanent_address as "permanentAddress",
         permanent_place as "permanentPlace",
         permanent_pincode as "permanentPincode",
         nationality as "nationality",
         blood_group as "bloodGroup",
         employment_status as "employmentStatus",
         qualification as "qualification",
         father_name as "fatherName",
         father_occupation as "fatherOccupation",
         father_phone as "fatherPhone",
         mother_name as "motherName",
         mother_occupation as "motherOccupation",
         mother_phone as "motherPhone",
         guardian_name as "guardianName",
         guardian_relation as "guardianRelation",
         guardian_phone as "guardianPhone",
         guardian_occupation as "guardianOccupation",
         version
  from app.person_detail where person_id = ${personId}::uuid`)[0];
const insertDetails = (tx: Tx, personId: string, d: Partial<Details>) => tx.$executeRaw`
  insert into app.person_detail (person_id, current_address, current_place, current_pincode, permanent_address, permanent_place, permanent_pincode, nationality, blood_group, employment_status, qualification, father_name, father_occupation, father_phone, mother_name, mother_occupation, mother_phone, guardian_name, guardian_relation, guardian_phone, guardian_occupation)
  values (${personId}::uuid, ${d.currentAddress ?? null}, ${d.currentPlace ?? null}, ${d.currentPincode ?? null}, ${d.permanentAddress ?? null}, ${d.permanentPlace ?? null}, ${d.permanentPincode ?? null}, ${d.nationality ?? null}, ${d.bloodGroup ?? null}, ${d.employmentStatus ?? null}, ${d.qualification ?? null}, ${d.fatherName ?? null}, ${d.fatherOccupation ?? null}, ${d.fatherPhone ?? null}, ${d.motherName ?? null}, ${d.motherOccupation ?? null}, ${d.motherPhone ?? null}, ${d.guardianName ?? null}, ${d.guardianRelation ?? null}, ${d.guardianPhone ?? null}, ${d.guardianOccupation ?? null})`;

/** Every given key through detailField; null clears; unknown keys are not read. */
function validDetails(d: Partial<Details> | undefined): Partial<Details> {
  if (d == null) return {};
  if (typeof d !== "object") throw invalid("details", "invalid");
  return Object.fromEntries(DETAIL_KEYS.filter((k) => k in d).map((k) => [k, detailField(k, d[k])])) as Partial<Details>;
}
const anyDetail = (d: Partial<Details>) => DETAIL_KEYS.some((k) => d[k] != null);

// ---------- Reads ----------

/** Persons with an admission at a centre where the caller holds `permission`, whose match key equals the candidate's (DD-1). */
export async function findMatches(tx: Tx, p: StoredIdentity, permission: string): Promise<Candidate[]> {
  return tx.$queryRaw<Candidate[]>`
    select p.id::text, p.given_name as "givenName", p.family_name as "familyName", p.date_of_birth::text as "dateOfBirth"
    from app.person p
    where p.match_key = app.person_match_key(${p.givenName}, ${p.familyName}, ${p.dateOfBirth}::date, ${p.mobile})
      and exists (select 1 from app.admission a where a.person_id = p.id
                  and a.centre_id = any (app.scoped_centre_ids(${permission})))
    order by p.created_at`;
}

export type ApproverMatch = { personId: string; admissionNo: string; centreCode: string; named: boolean;
  givenName: string; familyName: string | null; dateOfBirth: string | null };
/**
 * Likely duplicates of a corrected identity for a correction ticket's approver (correction-tickets DD-17): one row per
 * admission of another person with the same match key, at a centre where the caller holds ticket.approve; `named`
 * says whether the caller also holds student.view there (only then are name and date of birth shown).
 */
export async function approverMatches(tx: Tx, key: string, personId: string): Promise<ApproverMatch[]> {
  return tx.$queryRaw<ApproverMatch[]>`
    select p.id::text as "personId", a.admission_no as "admissionNo", c.code as "centreCode",
           app.has_permission('student.view', a.centre_id) as named,
           p.given_name as "givenName", p.family_name as "familyName", p.date_of_birth::text as "dateOfBirth"
    from app.person p join app.admission a on a.person_id = p.id join app.centre c on c.id = a.centre_id
    where p.match_key = ${key} and p.id <> ${personId}::uuid
      and a.centre_id = any (app.scoped_centre_ids('ticket.approve'))
    order by a.admission_no`;
}

/** The centre binding of every identity change (critic D2): the person must have an admission at `centreId`. */
export async function assertAdmittedAt(tx: Tx, centreId: number, personId: string): Promise<void> {
  if (!UUID.test(personId) || !Number.isSafeInteger(centreId)) throw new PersonError("notfound");
  const [hit] = await tx.$queryRaw<{ ok: number }[]>`
    select 1 as ok from app.admission where person_id = ${personId}::uuid and centre_id = ${centreId}`;
  if (!hit) throw new PersonError("notfound");
}

export type PersonView = {
  person: { id: string; givenName: string; familyName: string | null; gender: Gender | null; dateOfBirth: string | null; mobile: string | null; email: string | null };
  admissions: { id: string; centreId: number; centreCode: string; academicYear: string; admissionNo: string; admittedOn: string;
    registrations: { id: string; courseCode: string; courseName: string; registerNo: string; status: string; joinDate: string; endDate: string | null }[] }[];
  details: Details | null; // null without a row (learner-details C2)
  detailsVersion: number; // 0 without a row
  editCentreId: number | null; // the earliest admission at a centre where the caller holds student.admit (Z1, C10)
};

export async function getPerson(session: string | undefined, id: string): Promise<PersonView> {
  if (!UUID.test(id)) throw new PersonError("notfound");
  return withScope(session, async (tx) => {
    const admissions = await tx.$queryRaw<(PersonView["admissions"][number] & { registrations: PersonView["admissions"][number]["registrations"] | null })[]>`
      select a.id::text, a.centre_id as "centreId", c.code as "centreCode", a.academic_year as "academicYear",
             a.admission_no as "admissionNo", a.admitted_on::text as "admittedOn",
             (select json_agg(json_build_object('id', r.id, 'courseCode', r.course_code, 'courseName', co.name,
                'registerNo', r.register_no, 'status', r.status, 'joinDate', r.join_date::text, 'endDate', r.end_date::text)
                order by r.created_at, length(r.register_no), r.register_no)
              from app.registration r join app.course co on co.code = r.course_code where r.admission_id = a.id) as registrations
      from app.admission a join app.centre c on c.id = a.centre_id
      where a.person_id = ${id}::uuid and a.centre_id = any (app.scoped_centre_ids('student.view'))
      order by a.created_at`;
    if (admissions.length === 0) throw new PersonError("notfound");
    const [person] = await tx.$queryRaw<PersonView["person"][]>`
      select id::text, given_name as "givenName", family_name as "familyName", gender::text as gender,
             date_of_birth::text as "dateOfBirth", mobile, email
      from app.person where id = ${id}::uuid`;
    if (!person) throw new PersonError("notfound");
    const row = await readDetails(tx, id);
    const [edit] = await tx.$queryRaw<{ centreId: number }[]>`
      select centre_id as "centreId" from app.admission
      where person_id = ${id}::uuid and centre_id = any (app.scoped_centre_ids('student.admit')) order by created_at, id limit 1`;
    const details = row ? (Object.fromEntries(DETAIL_KEYS.map((k) => [k, row[k]])) as Details) : null;
    return { person, admissions: admissions.map((a) => ({ ...a, registrations: a.registrations ?? [] })),
      details, detailsVersion: row?.version ?? 0, editCentreId: edit?.centreId ?? null };
  });
}

/** What the admission form offers (admission-screens design). No centre with student.admit: Forbidden (the page 404s). */
export async function admitOptions(session: string | undefined) {
  return withScope(session, async (tx) => {
    const centres = await tx.$queryRaw<OfferCentre[]>`
      select c.id, c.code, c.name, k.code as "classCode" from app.centre c left join app.centre_class k on k.id = c.centre_class_id
      where c.id = any (app.scoped_centre_ids('student.admit')) and c.status = 'ACTIVE' order by c.code`;
    if (centres.length === 0) throw new Forbidden("student.admit denied");
    const years = await tx.$queryRaw<{ code: string }[]>`select code from app.academic_year where open order by code`;
    // the same rule as admit() (DD-15, DD-16; certifications DD-3): classCodes, the active classes a course may be sold
    // at; centreIds, its named centres within the caller's student.admit scope ([] = none here), or null for the class
    // rule. Correlated subqueries, so no join fans out (D4); an empty named list stays [] and never becomes null (D3).
    const courses = await tx.$queryRaw<OfferCourse[]>`
      select co.code, co.name,
        array(select k.code from app.course_centre_class cc join app.centre_class k on k.id = cc.centre_class_id and k.active
              where cc.course_id = co.id order by k.code) as "classCodes",
        case when exists (select 1 from app.course_centre x where x.course_id = co.id)
          then array(select x.centre_id from app.course_centre x where x.course_id = co.id
                     and x.centre_id = any (app.scoped_centre_ids('student.admit')) order by x.centre_id)
          else null end as "centreIds"
      from app.course co where co.active and co.visible order by co.code`;
    return { centres, years, courses, today: istToday(), enforced: CATALOGUE_GATES.enforceAvailability };
  });
}

export type AdmissionRow = { admissionId: string; personId: string; givenName: string; familyName: string | null;
  centreId: number; centreCode: string; academicYear: string; admissionNo: string; admittedOn: string };

/**
 * Admissions at centres in the caller's student.view scope, newest first, at most 100 (DD-6). q matches the
 * Admission No or a Register No exactly (any case), the start of either name, or a 10-digit mobile.
 * q comes only from a POST body (DD-13); no mobile in the result.
 */
export async function listAdmissions(session: string | undefined, f: { q?: string; centreId?: number } = {}): Promise<AdmissionRow[]> {
  const q = (f.q ?? "").trim();
  return withScope(session, async (tx) => {
    const [scope] = await tx.$queryRaw<{ n: number }[]>`select cardinality(app.scoped_centre_ids('student.view'))::int as n`;
    if (!scope?.n) throw new Forbidden("student.view denied");
    if (f.centreId !== undefined && !Number.isSafeInteger(f.centreId)) return [];
    let mobile: string | null = null;
    if (q) {
      await limitSearch(tx);
      try { mobile = identityField("mobile", q); } catch { /* not a mobile number */ }
    }
    const like = q.replace(/[\\%_]/g, "\\$&") + "%";
    // ponytail: scans the caller's admissions; add lower(name) text_pattern_ops and mobile indexes when a search exceeds 1 s
    return tx.$queryRaw<AdmissionRow[]>`
      select a.id::text as "admissionId", p.id::text as "personId", p.given_name as "givenName", p.family_name as "familyName",
             a.centre_id as "centreId", c.code as "centreCode", a.academic_year as "academicYear", a.admission_no as "admissionNo", a.admitted_on::text as "admittedOn"
      from app.admission a join app.person p on p.id = a.person_id join app.centre c on c.id = a.centre_id
      where a.centre_id = any (app.scoped_centre_ids('student.view'))
        ${f.centreId !== undefined ? Prisma.sql`and a.centre_id = ${f.centreId}` : Prisma.empty}
        ${q ? Prisma.sql`and (lower(a.admission_no) = lower(${q})
          or exists (select 1 from app.registration r where r.admission_id = a.id and lower(r.register_no) = lower(${q}))
          or p.given_name ilike ${like} or p.family_name ilike ${like}
          ${mobile ? Prisma.sql`or p.mobile = ${mobile}` : Prisma.empty})` : Prisma.empty}
      order by a.created_at desc, a.id desc limit 100`;
  });
}

// ---------- Writes ----------

export type AdmitInput = {
  person: { existingId: string } | Identity;
  centreId: number; academicYear: string; admittedOn: string; courses: Course[];
  /** the ids of the likely duplicates the user saw and dismissed (admission-screens I4) */
  confirmNew?: string[];
  /** the form's id, used as the admission's primary key so a resubmitted form never admits twice (DD-10) */
  admissionId?: string;
  /** contact and family details (learner-details); for an existing person saved only when none exist (DD-13) */
  details?: Partial<Details>;
  /** the enquiry this admission enrols (enquiry design DD-9); linked in the same transaction */
  enquiryId?: string;
};
export type Admitted = { personId: string; admissionId: string; admissionNo: string; registrations: { id: string; courseCode: string; registerNo: string }[] };

/** Is the course sold at the centre? A course with named centres is sold only there (certifications DD-3, amending
 * DD-7); otherwise by the centre's active class, so a centre without a class sells only the courses that name it (DD-15).
 * Shared by admit() and fee plans (fee-structure R7). */
export const offeredAtCentre = (courseId: Prisma.Sql, centreId: Prisma.Sql) => Prisma.sql`case
  when exists (select 1 from app.course_centre x where x.course_id = ${courseId})
    then exists (select 1 from app.course_centre x where x.course_id = ${courseId} and x.centre_id = ${centreId})
  else exists (select 1 from app.course_centre_class cc join app.centre_class k on k.id = cc.centre_class_id and k.active
               join app.centre ce on ce.centre_class_id = k.id where cc.course_id = ${courseId} and ce.id = ${centreId}) end`;
/** Is the course sold through the class? Only when it names no centres, and the class is active and offers it. */
export const offeredInClass = (courseId: Prisma.Sql, classId: Prisma.Sql) => Prisma.sql`(
  not exists (select 1 from app.course_centre x where x.course_id = ${courseId})
  and exists (select 1 from app.course_centre_class cc join app.centre_class k on k.id = cc.centre_class_id and k.active
              where cc.course_id = ${courseId} and cc.centre_class_id = ${classId}))`;

export async function admit(session: string | undefined, input: AdmitInput): Promise<Admitted> {
  // validation before the action: nothing to audit for a malformed request
  if (!Number.isSafeInteger(input.centreId)) throw invalid("centreId", "required");
  if (typeof input.academicYear !== "string" || !academicYearOk(input.academicYear)) throw invalid("academicYear", ACADEMIC_YEAR_RULE);
  const admittedOn = isoDate("admittedOn", input.admittedOn); // not checked against the year's dates (catalogue DD-6)
  const list = courses(input.courses);
  const existingId = "existingId" in input.person ? input.person.existingId : undefined;
  if (existingId !== undefined && (typeof existingId !== "string" || !UUID.test(existingId))) throw new PersonError("notfound");
  const fresh = existingId === undefined ? identity(input.person as Identity) : undefined;
  const confirmNew = input.confirmNew ?? [];
  if (!Array.isArray(confirmNew) || confirmNew.some((c) => typeof c !== "string")) throw invalid("confirmNew", "invalid");
  if (input.admissionId !== undefined && (typeof input.admissionId !== "string" || !UUID.test(input.admissionId))) {
    throw invalid("admissionId", "invalid");
  }
  const enquiryId = input.enquiryId;
  if (enquiryId !== undefined && (typeof enquiryId !== "string" || !/^\d{1,18}$/.test(enquiryId))) throw invalid("enquiry", "not found");
  const personId = existingId ?? randomUUID();
  // the FAILED audit rows below carry this person id even when, for a fresh identity, it was never created
  const admissionId = input.admissionId?.toLowerCase() ?? randomUUID();
  const registrationIds = list.map(() => randomUUID());
  const details = validDetails(input.details);
  let dismissed: string[] = [];
  let written: DetailKey[] = []; // detail keys saved with this admission, for the audit (D18, I10)

  return scopedAction(session, { action: "person.admit", permission: "student.admit", centreId: input.centreId,
    targetType: "person", targetId: personId }, (tx) => personDb(async () => {
    dismissed = []; // withScope may retry this callback
    written = [];
    let saveDetails = anyDetail(details);
    // the form lock and existence check first (DD-10): two submits of one form queue here, so the second sees the first
    // ponytail: shares the one-argument key space with the match-key lock; a collision only makes two admits wait
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`admit-form:${admissionId}`}))`;
    const [used] = await tx.$queryRaw<{ ok: number }[]>`select 1 as ok from app.admission where id = ${admissionId}::uuid`;
    if (used) throw new AdmissionExists();
    const [st] = await tx.$queryRaw<{ s: string }[]>`select status::text as s from app.centre where id = ${input.centreId}`;
    if (st?.s !== "ACTIVE") throw invalid("centreId", "centre is not active"); // an inactive centre cannot trade (centre onboarding DD-3)
    if (enquiryId !== undefined) {
      // enrol from an enquiry (enquiry design C8): after the resubmit check, so a resubmit still reports "saved"
      await authorize(tx, "enquiry.manage", input.centreId); // the DENIED row names enquiry.manage (I7)
      const [e] = await tx.$queryRaw<{ centreId: number; admissionId: string | null; kind: string }[]>`
        select e.centre_id as "centreId", e.admission_id::text as "admissionId", s.kind from app.enquiry e
          join app.enquiry_status s on s.id = e.status_id
        where e.id = ${enquiryId}::bigint for no key update of e`;
      if (!e) throw invalid("enquiry", "not found");
      if (e.centreId !== input.centreId) throw invalid("enquiry", "other centre");
      if (e.admissionId) throw invalid("enquiry", "already enrolled");
      if (e.kind === "LOST" || e.kind === "JUNK") throw invalid("enquiry", "closed");
    }
    // the catalogue: the year must be open and every course active and visible (course-master DD-12); plain reads,
    // no lock (catalogue DD-13)
    const [year] = await tx.$queryRaw<{ open: boolean }[]>`select open from app.academic_year where code = ${input.academicYear}`;
    if (!year?.open) throw invalid("academicYear", "not open");
    const live = new Set((await tx.$queryRaw<{ code: string }[]>`
      select code from app.course where code = any (${list.map((c) => c.courseCode)}::text[]) and active and visible`).map((r) => r.code));
    const missing = list.findIndex((c) => !live.has(c.courseCode));
    if (missing >= 0) throw invalid(`courses[${missing}].courseCode`, "no such course");
    if (CATALOGUE_GATES.enforceAvailability) {
      // a course with named centres is sold only there (certifications DD-3, amending DD-7); otherwise by this
      // centre's active class, so a centre without a class sells only the courses that name it (DD-15)
      const offered = new Set((await tx.$queryRaw<{ code: string }[]>`
        select co.code from app.course co
        where co.code = any (${list.map((c) => c.courseCode)}::text[]) and ${offeredAtCentre(Prisma.sql`co.id`, Prisma.sql`${input.centreId}`)}`)
        .map((r) => r.code));
      const refused = list.findIndex((c) => !offered.has(c.courseCode));
      if (refused >= 0) throw invalid(`courses[${refused}].courseCode`, "not offered at this centre");
    }
    if (fresh) {
      const [{ key } = { key: null }] = await tx.$queryRaw<{ key: string | null }[]>`
        select app.person_match_key(${fresh.givenName}, ${fresh.familyName}, ${fresh.dateOfBirth}::date, ${fresh.mobile}) as key`;
      if (key) {
        // same-key admits run one after the other, so the second sees the first (critic D5)
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${key}))`;
        const matches = await findMatches(tx, fresh, "student.admit");
        if (matches.some((m) => !confirmNew.includes(m.id))) throw new PossibleDuplicate(matches); // only shown ones are dismissed
        dismissed = matches.map((m) => m.id);
      }
      // no returning: reading the row back would need the select policy before the admission exists
      await tx.$executeRaw`insert into app.person (id, given_name, family_name, gender, date_of_birth, mobile, email)
        values (${personId}::uuid, ${fresh.givenName}, ${fresh.familyName}, ${fresh.gender}::app."Gender",
                ${fresh.dateOfBirth}::date, ${fresh.mobile}, ${fresh.email})`;
    } else {
      // linking needs student.admit where the person is already admitted, the set findMatches searches (DD-4)
      const [hit] = await tx.$queryRaw<{ ok: number }[]>`
        select 1 as ok from app.admission
        where person_id = ${personId}::uuid and centre_id = any (app.scoped_centre_ids('student.admit')) limit 1`;
      if (!hit) throw new PersonError("notfound");
      if (saveDetails) {
        // the lock updateDetails takes, so a concurrent first edit queues (I5); existing details are never overwritten (DD-13)
        await tx.$executeRaw`select 1 from app.person where id = ${personId}::uuid for no key update`;
        saveDetails = !(await readDetails(tx, personId));
      }
    }
    const seq = await allocateGlobal(tx, "ADMISSION", input.academicYear, { previous: previousYear(input.academicYear) });
    const admissionNo = `${PERSON_POLICY.admissionPrefix(input.academicYear)}${String(seq).padStart(PERSON_POLICY.admissionPad, "0")}`;
    await tx.$executeRaw`insert into app.admission (id, person_id, centre_id, academic_year, admission_no, admitted_on)
      values (${admissionId}::uuid, ${personId}::uuid, ${input.centreId}, ${input.academicYear}, ${admissionNo}, ${admittedOn}::date)`;
    if (enquiryId !== undefined) {
      // the guard allows exactly this: admission and the ENROLLED status together, once (enquiry DD-6, DD-15)
      await tx.$executeRaw`update app.enquiry set admission_id = ${admissionId}::uuid,
        status_id = (select id from app.enquiry_status where kind = 'ENROLLED') where id = ${enquiryId}::bigint`;
    }
    if (saveDetails) {
      // after the admission, so the insert policy (student.admit where the person is admitted) passes
      await insertDetails(tx, personId, details);
      written = DETAIL_KEYS.filter((k) => details[k] != null);
    }
    const registrations = [];
    for (const [i, c] of list.entries()) {
      const registerNo = String(await allocateGlobal(tx, "REGISTER", "ALL", { mustExist: true })).padStart(PERSON_POLICY.registerPad, "0");
      await tx.$executeRaw`insert into app.registration (id, admission_id, centre_id, course_code, register_no, join_date, end_date)
        values (${registrationIds[i]}::uuid, ${admissionId}::uuid, ${input.centreId}, ${c.courseCode}, ${registerNo},
                ${c.joinDate}::date, ${c.endDate ?? null}::date)`;
      registrations.push({ id: registrationIds[i]!, courseCode: c.courseCode, registerNo });
    }
    return { personId, admissionId, admissionNo, registrations };
  }), (r) => ({
    admissionId: r.admissionId, admissionNo: r.admissionNo,
    registrations: r.registrations.map(({ id, registerNo }) => ({ id, registerNo })),
    ...(dismissed.length > 0 ? { dismissedCandidates: dismissed } : {}),
    ...(written.length > 0 ? { detailFields: written } : {}),
    ...(enquiryId !== undefined ? { enquiryId } : {}),
  }), (e) => { // DD-15: the refusals that show or probe another record; no names or dates in the row
    if (e instanceof PossibleDuplicate) return { action: "person.admit", extra: { reason: "duplicate", candidates: e.candidates.map((c) => c.id) } };
    if (e instanceof AdmissionExists) return { action: "person.admit", extra: { reason: "already_submitted", admissionId } };
    return null;
  });
}

export type IdentityChanges = Partial<Omit<Identity, "givenName"> & { givenName: string }>;

/**
 * The one place identity fields change (G5), inside the caller's transaction: in Stage 2 only a correction
 * handler's apply(), in the approver's transaction; the ticket engine audits the returned before/after.
 * Any other caller must audit the change itself.
 */
export async function changeIdentity(tx: Tx, centreId: number, personId: string, changes: IdentityChanges)
  : Promise<{ before: Partial<StoredIdentity>; after: Partial<StoredIdentity> }> {
  const keys = IDENTITY_KEYS.filter((k) => k in changes);
  if (keys.length === 0) throw invalid("changes", "at least one identity field");
  const after = Object.fromEntries(keys.map((k) => [k, identityField(k, changes[k])])) as Partial<StoredIdentity>;
  await assertAdmittedAt(tx, centreId, personId);
  return personDb(async () => {
    const [row] = await tx.$queryRaw<StoredIdentity[]>`
      select given_name as "givenName", family_name as "familyName", gender::text as gender,
             date_of_birth::text as "dateOfBirth", mobile, email
      from app.person where id = ${personId}::uuid for update`;
    if (!row) throw new PersonError("notfound");
    const set = (k: keyof StoredIdentity) => keys.includes(k);
    await tx.$executeRaw`update app.person set
      given_name = case when ${set("givenName")} then ${after.givenName ?? null} else given_name end,
      family_name = case when ${set("familyName")} then ${after.familyName ?? null} else family_name end,
      gender = case when ${set("gender")} then ${after.gender ?? null}::app."Gender" else gender end,
      date_of_birth = case when ${set("dateOfBirth")} then ${after.dateOfBirth ?? null}::date else date_of_birth end,
      mobile = case when ${set("mobile")} then ${after.mobile ?? null} else mobile end,
      email = case when ${set("email")} then ${after.email ?? null} else email end
      where id = ${personId}::uuid`;
    return { before: Object.fromEntries(keys.map((k) => [k, row[k]])) as Partial<StoredIdentity>, after };
  });
}

const DIGITS = /^\d+$/;

/**
 * Edit a learner's contact and family details (learner-details DD-3, DD-10): student.admit at centreId, where the person
 * is admitted; an optimistic version (DD-8); keys absent from changes stay as they are, null clears. Audited by the
 * names of the changed fields only (DD-14). Identity is never touched here.
 */
export async function updateDetails(session: string | undefined, personId: string, centreId: string | number, version: string | number,
  changes: Partial<Details>): Promise<{ version: number; changed: DetailKey[] }> {
  const centre = String(centreId), ver = String(version);
  if (!UUID.test(personId) || !DIGITS.test(centre) || !DIGITS.test(ver)) throw new PersonError("notfound");
  const [c, v] = [Number(centre), Number(ver)];
  if (!Number.isSafeInteger(c) || !Number.isSafeInteger(v)) throw new PersonError("notfound");
  const d = validDetails(changes);
  return scopedAction(session, { action: "person.details.update", permission: "student.admit", centreId: c, targetType: "person", targetId: personId },
    (tx) => personDb(async () => {
      await assertAdmittedAt(tx, c, personId);
      await tx.$executeRaw`select 1 from app.person where id = ${personId}::uuid for no key update`; // first edits queue (Z5, D10)
      const row = await readDetails(tx, personId);
      if ((row?.version ?? 0) !== v) throw invalid("details", "changed since you opened them; reload the page");
      const changed = DETAIL_KEYS.filter((k) => k in d && (d[k] ?? null) !== (row ? row[k] : null));
      if (changed.length === 0) throw invalid("details", "nothing to change");
      const set = (k: DetailKey) => changed.includes(k);
      if (!row) {
        await insertDetails(tx, personId, Object.fromEntries(changed.map((k) => [k, d[k]])) as Partial<Details>);
        return { version: 1, changed };
      }
      const n = await tx.$executeRaw`update app.person_detail set
      current_address = case when ${set("currentAddress")} then ${d.currentAddress ?? null} else current_address end,
      current_place = case when ${set("currentPlace")} then ${d.currentPlace ?? null} else current_place end,
      current_pincode = case when ${set("currentPincode")} then ${d.currentPincode ?? null} else current_pincode end,
      permanent_address = case when ${set("permanentAddress")} then ${d.permanentAddress ?? null} else permanent_address end,
      permanent_place = case when ${set("permanentPlace")} then ${d.permanentPlace ?? null} else permanent_place end,
      permanent_pincode = case when ${set("permanentPincode")} then ${d.permanentPincode ?? null} else permanent_pincode end,
      nationality = case when ${set("nationality")} then ${d.nationality ?? null} else nationality end,
      blood_group = case when ${set("bloodGroup")} then ${d.bloodGroup ?? null} else blood_group end,
      employment_status = case when ${set("employmentStatus")} then ${d.employmentStatus ?? null} else employment_status end,
      qualification = case when ${set("qualification")} then ${d.qualification ?? null} else qualification end,
      father_name = case when ${set("fatherName")} then ${d.fatherName ?? null} else father_name end,
      father_occupation = case when ${set("fatherOccupation")} then ${d.fatherOccupation ?? null} else father_occupation end,
      father_phone = case when ${set("fatherPhone")} then ${d.fatherPhone ?? null} else father_phone end,
      mother_name = case when ${set("motherName")} then ${d.motherName ?? null} else mother_name end,
      mother_occupation = case when ${set("motherOccupation")} then ${d.motherOccupation ?? null} else mother_occupation end,
      mother_phone = case when ${set("motherPhone")} then ${d.motherPhone ?? null} else mother_phone end,
      guardian_name = case when ${set("guardianName")} then ${d.guardianName ?? null} else guardian_name end,
      guardian_relation = case when ${set("guardianRelation")} then ${d.guardianRelation ?? null} else guardian_relation end,
      guardian_phone = case when ${set("guardianPhone")} then ${d.guardianPhone ?? null} else guardian_phone end,
      guardian_occupation = case when ${set("guardianOccupation")} then ${d.guardianOccupation ?? null} else guardian_occupation end,
      version = version + 1
      where person_id = ${personId}::uuid and version = ${v}`;
      if (n !== 1) throw invalid("details", "changed since you opened them; reload the page");
      return { version: v + 1, changed };
    }), (r) => ({ fields: r.changed }));
}
