// Person, admission and registration core acceptance tests (audit 09 §T-PER; design item 8).
// Runs against the local Docker database. Fixture seeds: REGISTER 2064112, ADMISSION 2026-27 at 43887 (as at cutover).
import { beforeEach, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { Forbidden } from "../src/server/action";
import { withScope } from "../src/server/db";
import { SeriesMissing } from "../src/server/numbering";
import {
  admit, changeIdentity, getPerson, PersonError, PossibleDuplicate, type AdmitInput, type Identity,
} from "../src/server/people";
import { asAdmin, audits, C, reset, rows, ST, ST_TOKEN } from "./fixtures";

const { sa, sb, sr, sh } = ST_TOKEN;
const RAJ: Identity = { givenName: "Raj", familyName: "Kumar", dateOfBirth: "2001-01-11", mobile: "+91 98470 12345" };
const course = (code = "DCA") => ({ courseCode: code, joinDate: "2026-11-01" });
const input = (o: Partial<AdmitInput> = {}): AdmitInput =>
  ({ person: RAJ, centreId: C.A, academicYear: "2026-27", admittedOn: "2026-10-28", courses: [course()], ...o });
const count = (table: string) => asAdmin((db) => db.query(`select count(*)::int n from app.${table}`).then((r) => r.rows[0].n as number));
const current = (series: string, period: string) => asAdmin((db) => db.query(
  `select current::text c from app.global_number_series where series = $1 and period = $2`, [series, period]).then((r) => r.rows[0]?.c as string | undefined));
const statuses = (personId: string, centreId: number) => asAdmin((db) => db.query(
  `select r.status::text s from app.registration r join app.admission a on a.id = r.admission_id where a.person_id = $1 and a.centre_id = $2`,
  [personId, centreId]).then((r) => r.rows.map((x) => x.s)));
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };

beforeEach(() => reset());

describe("person core (T-PER)", () => {
  test("T-PER-001 one person, several admissions and registrations; moves by HO and regional users only", async () => {
    const first = await admit(sa, input({ courses: [course("DCA"), course("TALLY")] }));
    await admit(sa, input({ person: { existingId: first.personId }, courses: [course("PYTHON")] }));
    expect([await count("person"), await count("admission"), await count("registration")]).toEqual([1, 2, 3]);
    // before any move, centre B can neither see nor pass the person
    expect(await thrown(getPerson(sb, first.personId))).toBeInstanceOf(PersonError);
    expect(await thrown(admit(sb, input({ person: { existingId: first.personId }, centreId: C.B })))).toMatchObject({ reason: "notfound" });
    // an HO user links them at B: one person, and the A registrations stay ACTIVE (a recorded limit)
    await admit(sh, input({ person: { existingId: first.personId }, centreId: C.B }));
    expect(await count("person")).toBe(1);
    expect(await statuses(first.personId, C.A)).toEqual(["ACTIVE", "ACTIVE", "ACTIVE"]);
    // a regional user (region 1: A and A2) links them at A2
    await admit(sr, input({ person: { existingId: first.personId }, centreId: C.A2 }));
    expect([await count("person"), await count("admission")]).toEqual([1, 4]);
    expect((await rows("person.admit")).map((r) => r.target_id)).toEqual(Array(4).fill(first.personId));
  });

  test("T-PER-002 likely duplicates flagged in scope only; order-independent key; concurrency; bulk load", async () => {
    const p = await admit(sa, input());
    // swapped name order and another mobile spelling still match
    const dup = await thrown(admit(sa, input({ person: { ...RAJ, givenName: "kumar", familyName: "RAJ", mobile: "09847012345" } })));
    expect(dup).toBeInstanceOf(PossibleDuplicate);
    expect((dup as PossibleDuplicate).candidates.map((c) => c.id)).toEqual([p.personId]);
    expect([await count("person"), (await rows("person.admit")).length]).toEqual([1, 1]); // rolled back, no audit row
    // never across centres: B sees no match and gets a new person
    await admit(sb, input({ centreId: C.B }));
    expect(await count("person")).toBe(2);
    // confirmNew records what was dismissed
    const confirmed = await admit(sa, input({ confirmNew: true }));
    const audit = (await rows("person.admit")).find((r) => r.target_id === confirmed.personId)!;
    expect(audit.detail.dismissedCandidates).toEqual([p.personId]);
    expect(audit).toMatchObject({ outcome: "OK", target_type: "person", target_centre_id: C.A });
    // single-name learner and a Malayalam name match too
    const mono = { givenName: "Anjali", dateOfBirth: "2002-02-02", mobile: "9000000001" };
    await admit(sa, input({ person: mono }));
    expect(await thrown(admit(sa, input({ person: { ...mono, familyName: null } })))).toBeInstanceOf(PossibleDuplicate);
    const ml = { givenName: "അനുപമ", familyName: "കൃഷ്ണൻ", dateOfBirth: "2003-03-03", mobile: "9000000002" };
    await admit(sa, input({ person: ml }));
    expect(await thrown(admit(sa, input({ person: { ...ml, givenName: "കൃഷ്ണൻ", familyName: "അനുപമ" } })))).toBeInstanceOf(PossibleDuplicate);
    // no key on partial data: no match is claimed
    const partial = { givenName: "Meera", mobile: "9000000003" };
    await admit(sa, input({ person: partial }));
    await admit(sa, input({ person: partial }));
    expect(await asAdmin((db) => db.query(`select count(*)::int n from app.person where given_name = 'Meera' and match_key is null`)
      .then((r) => r.rows[0].n))).toBe(2);
    // two concurrent admits of the same new learner: one person
    const twin = { givenName: "Twin", familyName: "Test", dateOfBirth: "2004-04-04", mobile: "9000000004" };
    const both = await Promise.allSettled([0, 1].map(() => admit(sa, input({ person: twin }))));
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(both.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(PossibleDuplicate) });
    expect(await asAdmin((db) => db.query(`select count(*)::int n from app.person where given_name = 'Twin'`).then((r) => r.rows[0].n))).toBe(1);
    // a bulk load gets its match key from the database (G6)
    const key = await asAdmin(async (db) => {
      await db.query(`insert into app.person (id, given_name, family_name, date_of_birth, mobile)
        select gen_random_uuid(), 'Bulk', 'Load', date '2000-12-01', '9000000005'`);
      return (await db.query(`select match_key from app.person where given_name = 'Bulk'`)).rows[0].match_key;
    });
    expect(key).toBe("bulk load|20001201|9000000005");
  });

  test("T-PER-003 numbers: network-wide, chained years, fail loudly, released on rollback (with T-NUM-010)", async () => {
    // T-NUM-010: the first new number is the legacy current value + 1
    const a = await admit(sa, input());
    expect(a.admissionNo).toBe("GTEC262743888");
    expect(a.registrations.map((r) => r.registerNo)).toEqual(["2064113"]);
    // another centre, same year: the next number of the same series, never a clash
    const b = await admit(sb, input({ centreId: C.B, person: { givenName: "Other", mobile: "9000000010", dateOfBirth: "2000-01-01" } }));
    expect([b.admissionNo, b.registrations[0]!.registerNo]).toEqual(["GTEC262743889", "2064114"]);
    // years chain (DD-7): order matters
    const year = (academicYear: string) => admit(sa, input({ academicYear, confirmNew: true }));
    expect(await thrown(year("2028-29"))).toMatchObject({ series: "ADMISSION", period: "2028-29" });
    expect(await thrown(year("2025-26"))).toBeInstanceOf(SeriesMissing);
    expect((await year("2027-28")).admissionNo).toBe("GTEC27281");
    expect((await year("2028-29")).admissionNo).toBe("GTEC28291");
    // a missing REGISTER row fails loudly instead of starting at 1
    await asAdmin((db) => db.query(`delete from app.global_number_series where series = 'REGISTER'`));
    expect(await thrown(admit(sa, input({ confirmNew: true })))).toMatchObject({ series: "REGISTER", period: "ALL" });
    expect(await current("REGISTER", "ALL")).toBeUndefined();
  });

  test("T-PER-003 a failed admission releases its numbers and leaves no rows", async () => {
    // a registration already holds 2064114, so a two-course admit fails on the unique key after both allocations
    await asAdmin(async (db) => {
      await db.query(`insert into app.person (id, given_name) values ('00000000-0000-0000-0000-00000000f001', 'Legacy')`);
      await db.query(`insert into app.admission (id, person_id, centre_id, academic_year, admission_no, admitted_on)
        values ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000f001', 1, '2025-26', 'LEGACY1', '2025-06-01')`);
      await db.query(`insert into app.registration (id, admission_id, centre_id, course_code, register_no, join_date)
        values (gen_random_uuid(), '00000000-0000-0000-0000-00000000f002', 1, 'DCA', '2064114', '2025-06-01')`);
    });
    const e = await thrown(admit(sa, input({ courses: [course("DCA"), course("TALLY")] })));
    expect(e).toMatchObject({ reason: "invalid", message: "number already issued" });
    expect([await current("ADMISSION", "2026-27"), await current("REGISTER", "ALL")]).toEqual(["43887", "2064112"]);
    expect([await count("person"), await count("admission"), await count("registration")]).toEqual([1, 1, 1]);
    expect(await rows("person.admit")).toEqual([]);
  });

  test("T-PER-003 constraints: composite foreign key, academic-year check, validation, authorisation", async () => {
    const a = await admit(sa, input());
    // a registration whose centre differs from its admission's
    const fk = await thrown(asAdmin((db) => db.query(`insert into app.registration (id, admission_id, centre_id, course_code, register_no, join_date)
      values (gen_random_uuid(), $1, 3, 'X', 'R1', '2026-11-01')`, [a.admissionId])));
    expect(fk).toMatchObject({ code: "23503" });
    // academic year: refused by admit, and by the database check on a direct insert (never as a cast error)
    for (const y of ["2026-2027", "2026-28", "26-27"]) expect(await thrown(admit(sa, input({ academicYear: y })))).toMatchObject({ reason: "invalid" });
    for (const y of ["2026-28", "abcd-ef"]) {
      const err = await thrown(asAdmin((db) => db.query(`insert into app.admission (id, person_id, centre_id, academic_year, admission_no, admitted_on)
        values (gen_random_uuid(), $1, 1, $2, $3, '2026-10-28')`, [a.personId, y, `X-${y}`])));
      expect(err).toMatchObject({ code: "23514", constraint: "admission_academic_year_check" });
    }
    // validation
    expect(await thrown(admit(sa, input({ courses: [] })))).toMatchObject({ reason: "invalid", message: "courses: at least one" });
    expect(await thrown(admit(sa, input({ person: { givenName: " " } })))).toMatchObject({ reason: "invalid" });
    expect(await thrown(admit(sa, input({ person: { ...RAJ, mobile: "12345" } })))).toMatchObject({ message: "mobile: 10 digits" });
    // a centre outside the caller's student.admit scope: Forbidden, audited as DENIED
    expect(await thrown(admit(sa, input({ centreId: C.B, person: { givenName: "Z" } })))).toBeInstanceOf(Forbidden);
    expect((await audits("person.admit")).map((r) => r.outcome)).toEqual(["OK", "DENIED"]);
  });

  test("T-PER-004 scope: a centre sees its own admissions, a person only through one, others like missing", async () => {
    const p = await admit(sa, input());
    await admit(sh, input({ person: { existingId: p.personId }, centreId: C.B }));
    const viewA = await getPerson(sa, p.personId);
    expect(viewA.admissions.map((x) => x.centreId)).toEqual([C.A]);
    expect(viewA.person).toMatchObject({ givenName: "Raj", familyName: "Kumar", dateOfBirth: "2001-01-11", mobile: "9847012345" });
    expect(viewA.admissions[0]!.registrations[0]).toMatchObject({ courseCode: "DCA", registerNo: "2064113", status: "ACTIVE", joinDate: "2026-11-01", endDate: null });
    // another centre's person raises the same error as a missing one
    const other = await admit(sb, input({ centreId: C.B, person: { givenName: "Bee", mobile: "9000000020", dateOfBirth: "1999-09-09" } }));
    const hidden = await thrown(getPerson(sa, other.personId));
    const missing = await thrown(getPerson(sa, randomUUID()));
    expect([hidden, missing].map((e) => [(e as Error).name, (e as Error).message])).toEqual([["PersonError", "notfound"], ["PersonError", "notfound"]]);
    // raw access under centre B: no centre-A-only person, and an update changes nothing
    const onlyA = await admit(sa, input({ person: { givenName: "Ay", mobile: "9000000021", dateOfBirth: "1998-08-08" } }));
    const raw = await withScope(sb, async (tx) => ({
      ids: (await tx.$queryRaw<{ id: string }[]>`select id::text from app.person`).map((r) => r.id),
      updated: await tx.$executeRaw`update app.person set given_name = 'X' where id = ${onlyA.personId}::uuid`,
    }));
    expect(raw.ids.sort()).toEqual([p.personId, other.personId].sort());
    expect(raw.updated).toBe(0);
  });

  test("T-PER-005 identity changes: one function, before and after, bound to the ticket's centre", async () => {
    const p = await admit(sa, input());
    // the handler path: inside an approver's transaction (here an HO user's)
    const change = await withScope(sh, (tx) => changeIdentity(tx, C.A, p.personId, { givenName: "Rajesh", familyName: null }));
    expect(change).toEqual({ before: { givenName: "Raj", familyName: "Kumar" }, after: { givenName: "Rajesh", familyName: null } });
    const [row] = await asAdmin((db) => db.query(`select given_name, family_name, mobile, match_key from app.person where id = $1`, [p.personId]).then((r) => r.rows));
    expect(row).toEqual({ given_name: "Rajesh", family_name: null, mobile: "9847012345", match_key: "rajesh|20010111|9847012345" });
    // a centre where the person has no admission: refused like a missing person, even for an HO user
    expect(await thrown(withScope(sh, (tx) => changeIdentity(tx, C.B, p.personId, { givenName: "X" })))).toMatchObject({ reason: "notfound" });
    expect(await thrown(withScope(sa, (tx) => changeIdentity(tx, C.A, p.personId, { givenName: null as unknown as string }))))
      .toMatchObject({ reason: "invalid" });
  });
});
