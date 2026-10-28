// Person, admission and registration core, Stage 2 (docs/designs/person-core/person-core.md, Approved 2026-10-28).
// A network-wide person is visible to a centre only through an admission it holds (RLS, 0011). Admitting is one
// scopedAction(): authorise, write person/admission/registrations with their numbers, audit person.admit.
import { randomUUID } from "node:crypto";
import { Forbidden, scopedAction } from "./action";
import { withScope, type Tx } from "./db";
import { allocateGlobal } from "./numbering";

// PMC (NP-2, NP-5, NP-7, NP-8): format pieces are parameters until the numbering owners sign.
export const PERSON_POLICY = {
  admissionPrefix: (academicYear: string) => `GTEC${academicYear.slice(2, 4)}${academicYear.slice(5, 7)}`, // 2026-27 -> GTEC2627
  admissionPad: 0,
  registerPad: 0,
} as const;

export type Gender = "MALE" | "FEMALE" | "OTHER";
export type Identity = {
  givenName: string; familyName?: string | null; gender?: Gender | null;
  dateOfBirth?: string | null; mobile?: string | null; email?: string | null; // dates are 'YYYY-MM-DD'
};
export type Course = { courseCode: string; joinDate: string; endDate?: string };

export class PersonError extends Error {
  override name = "PersonError";
  constructor(readonly reason: "invalid" | "notfound", message: string = reason) { super(message); }
}
export type Candidate = { id: string; givenName: string; familyName: string | null; dateOfBirth: string | null };
export class PossibleDuplicate extends Error {
  override name = "PossibleDuplicate";
  constructor(readonly candidates: Candidate[]) { super(`${candidates.length} possible duplicate(s)`); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (field: string, rule: string) => new PersonError("invalid", `${field}: ${rule}`);

// ---------- Validation (design item 7) ----------

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10); // Asia/Kolkata, no DST

export function isoDate(field: string, v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw invalid(field, "YYYY-MM-DD");
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw invalid(field, "not a date");
  return v;
}

const optText = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

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

function identity(p: Identity): StoredIdentity {
  return Object.fromEntries(IDENTITY_KEYS.map((k) => [k, identityField(k, p[k])])) as StoredIdentity;
}

export const ACADEMIC_YEAR_RULE = "YYYY-YY, consecutive years";
export function academicYearOk(y: string): boolean {
  return /^\d{4}-\d{2}$/.test(y) && Number(y.slice(5)) === (Number(y.slice(0, 4)) + 1) % 100;
}
export const previousYear = (y: string) => `${Number(y.slice(0, 4)) - 1}-${y.slice(2, 4)}`; // 2026-27 -> 2025-26

function courses(list: unknown): Course[] {
  if (!Array.isArray(list) || list.length === 0) throw invalid("courses", "at least one");
  return list.map((c: Partial<Course>, i) => {
    const courseCode = optText(c?.courseCode);
    if (!courseCode) throw invalid(`courses[${i}].courseCode`, "required");
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
    if (code === "23505" && (constraint === "admission_admission_no_key" || constraint === "registration_register_no_key"))
      throw new PersonError("invalid", "number already issued");
    if (code === "23503") throw new PersonError("invalid", "inconsistent reference");
    if (code === "22P02") throw new PersonError("invalid", "malformed value");
    if (code === "42501") throw new Forbidden(cause?.originalMessage ?? "forbidden"); // audited as DENIED by scopedAction
    throw e;
  }
}

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

/** The centre binding of every identity change (critic D2): the person must have an admission at `centreId`. */
export async function assertAdmittedAt(tx: Tx, centreId: number, personId: string): Promise<void> {
  if (!UUID.test(personId) || !Number.isSafeInteger(centreId)) throw new PersonError("notfound");
  const [hit] = await tx.$queryRaw<{ ok: number }[]>`
    select 1 as ok from app.admission where person_id = ${personId}::uuid and centre_id = ${centreId}`;
  if (!hit) throw new PersonError("notfound");
}

export type PersonView = {
  person: { id: string; givenName: string; familyName: string | null; gender: Gender | null; dateOfBirth: string | null; mobile: string | null; email: string | null };
  admissions: { id: string; centreId: number; academicYear: string; admissionNo: string; admittedOn: string;
    registrations: { id: string; courseCode: string; registerNo: string; status: string; joinDate: string; endDate: string | null }[] }[];
};

export async function getPerson(session: string | undefined, id: string): Promise<PersonView> {
  if (!UUID.test(id)) throw new PersonError("notfound");
  return withScope(session, async (tx) => {
    const admissions = await tx.$queryRaw<(PersonView["admissions"][number] & { registrations: PersonView["admissions"][number]["registrations"] | null })[]>`
      select a.id::text, a.centre_id as "centreId", a.academic_year as "academicYear", a.admission_no as "admissionNo",
             a.admitted_on::text as "admittedOn",
             (select json_agg(json_build_object('id', r.id, 'courseCode', r.course_code, 'registerNo', r.register_no,
                'status', r.status, 'joinDate', r.join_date::text, 'endDate', r.end_date::text) order by r.created_at)
              from app.registration r where r.admission_id = a.id) as registrations
      from app.admission a
      where a.person_id = ${id}::uuid and a.centre_id = any (app.scoped_centre_ids('student.view'))
      order by a.created_at`;
    if (admissions.length === 0) throw new PersonError("notfound");
    const [person] = await tx.$queryRaw<PersonView["person"][]>`
      select id::text, given_name as "givenName", family_name as "familyName", gender::text as gender,
             date_of_birth::text as "dateOfBirth", mobile, email
      from app.person where id = ${id}::uuid`;
    if (!person) throw new PersonError("notfound");
    return { person, admissions: admissions.map((a) => ({ ...a, registrations: a.registrations ?? [] })) };
  });
}

// ---------- Writes ----------

export type AdmitInput = {
  person: { existingId: string } | Identity;
  centreId: number; academicYear: string; admittedOn: string; courses: Course[]; confirmNew?: boolean;
};
export type Admitted = { personId: string; admissionId: string; admissionNo: string; registrations: { id: string; courseCode: string; registerNo: string }[] };

export async function admit(session: string | undefined, input: AdmitInput): Promise<Admitted> {
  // validation before the action: nothing to audit for a malformed request
  if (!Number.isSafeInteger(input.centreId)) throw invalid("centreId", "required");
  if (typeof input.academicYear !== "string" || !academicYearOk(input.academicYear)) throw invalid("academicYear", ACADEMIC_YEAR_RULE);
  const admittedOn = isoDate("admittedOn", input.admittedOn); // independent of academicYear until R-028 (design)
  const list = courses(input.courses);
  const existingId = "existingId" in input.person ? input.person.existingId : undefined;
  if (existingId !== undefined && (typeof existingId !== "string" || !UUID.test(existingId))) throw new PersonError("notfound");
  const fresh = existingId === undefined ? identity(input.person as Identity) : undefined;
  const personId = existingId ?? randomUUID();
  const admissionId = randomUUID();
  const registrationIds = list.map(() => randomUUID());
  let dismissed: string[] = [];

  return scopedAction(session, { action: "person.admit", permission: "student.admit", centreId: input.centreId,
    targetType: "person", targetId: personId }, (tx) => personDb(async () => {
    dismissed = []; // withScope may retry this callback
    if (fresh) {
      const [{ key } = { key: null }] = await tx.$queryRaw<{ key: string | null }[]>`
        select app.person_match_key(${fresh.givenName}, ${fresh.familyName}, ${fresh.dateOfBirth}::date, ${fresh.mobile}) as key`;
      if (key) {
        // same-key admits run one after the other, so the second sees the first (critic D5)
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${key}))`;
        const matches = await findMatches(tx, fresh, "student.admit");
        if (matches.length > 0 && input.confirmNew !== true) throw new PossibleDuplicate(matches);
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
    }
    const seq = await allocateGlobal(tx, "ADMISSION", input.academicYear, { previous: previousYear(input.academicYear) });
    const admissionNo = `${PERSON_POLICY.admissionPrefix(input.academicYear)}${String(seq).padStart(PERSON_POLICY.admissionPad, "0")}`;
    await tx.$executeRaw`insert into app.admission (id, person_id, centre_id, academic_year, admission_no, admitted_on)
      values (${admissionId}::uuid, ${personId}::uuid, ${input.centreId}, ${input.academicYear}, ${admissionNo}, ${admittedOn}::date)`;
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
  }));
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
