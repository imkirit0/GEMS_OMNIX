// Enquiry to admission acceptance tests: T-ENQ-001…006 (audit 09; docs/designs/enquiry/enquiry.md).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { Forbidden } from "../src/server/action";
import { auth } from "../src/server/auth/http";
import * as cat from "../src/server/catalogue";
import * as enq from "../src/server/enquiry";
import { RateLimited } from "../src/server/exports";
import { admit, CATALOGUE_GATES, type AdmitInput } from "../src/server/people";
import { asAdmin, C, EQ, EQ_TOKEN, reset, rows, setStepUp, ST_TOKEN, T } from "./fixtures";

const S = { NEW: 1, CONTACTED: 2, AFFORDABILITY: 3, ENROLLED: 4, LOST: 5, JUNK: 6 } as const; // 0018 seed ids
const WA = EQ_TOKEN.wa, WB = EQ_TOKEN.wb, VA = EQ_TOKEN.va, MA = EQ_TOKEN.ma, SETUP = EQ_TOKEN.setup;
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const sqlErr = (q: string, p: unknown[] = []) => asAdmin(async (db) => {
  await db.query("begin");
  try { await db.query(q, p); return null; } catch (e) { return e as { code: string; constraint?: string; message: string }; } finally { await db.query("rollback"); }
});
let n = 0;
const mobile = () => `91${String(++n).padStart(8, "0")}`;
const base = (o: Partial<enq.EnquiryInput> = {}): enq.EnquiryInput => ({ centreId: C.A, givenName: `Asha${n}`, dateOfBirth: "2005-01-01",
  gender: "FEMALE", mobile: mobile(), pathId: 1, typeId: 1, courseCodes: ["DCA"], ...o });
const create = (o: Partial<enq.EnquiryInput> = {}, tok: string = WA) => enq.createEnquiry(tok, base(o)).then((r) => r.id);
const admitInput = (o: Partial<AdmitInput> = {}): AdmitInput => ({ person: { givenName: `Learner${++n}`, mobile: mobile() }, centreId: C.A,
  academicYear: "2026-27", admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });
const enquiry = async (id: string) => (await sql(`select e.*, s.kind from app.enquiry e join app.enquiry_status s on s.id = e.status_id where e.id = $1`, [id]))[0];
const audit = async (action: string, outcome = "OK") => (await rows(action)).filter((r) => r.outcome === outcome);

let app: pg.Client; // gems_app with a session, as withScope connects
const as = async (tok: string, q: string, p: unknown[] = []) => {
  await app.query("begin");
  await app.query("select set_config('app.session_id', $1, true)", [tok]);
  try { return await app.query(q, p); } finally { await app.query("rollback"); }
};
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(async () => { await reset(); await setStepUp(SETUP, 0); await setStepUp("tok-catA", 0); });
afterEach(() => { CATALOGUE_GATES.enforceAvailability = false; });

describe("T-ENQ enquiry to admission", () => {
  test("T-ENQ-001 recording: every field, messages, app and database agree, same-mobile warnings, rate limit, scope", async () => {
    const id = await enq.createEnquiry(WA, base({ familyName: " Nair ", email: "asha@example.com", currentAddress: "House 1\nStreet",
      currentPincode: "682001", qualification: "PLUS_TWO", guardianName: "Ravi", guardianPhone: "+91 98470 00001", whatsapp: "9847000002",
      landline: "0484-2300000".replace("-", "").slice(1).padEnd(10, "0"), instagram: "@asha", lastSchool: "GHSS", remark: "Wants\tevening batch",
      courseCodes: ["dca", "TALLY", "python"], enquiredOn: "2026-10-01" })).then((r) => r.id);
    const e = await enquiry(id);
    expect(e).toMatchObject({ centre_id: 1, family_name: "Nair", guardian_phone: "9847000001", course_code_1: "DCA", course_code_2: "TALLY",
      course_code_3: "PYTHON", status_id: S.NEW, version: 1, created_by: EQ.wa, admission_id: null, kind: "OPEN" });
    const [ok] = await audit("enquiry.create");
    expect(ok).toMatchObject({ target_type: "enquiry", target_id: id, target_centre_id: 1 });
    expect(ok.detail.fields).toContain("guardianPhone");
    expect(JSON.stringify(ok)).not.toContain("9847000001"); // field names, never values (DD-14)

    const bad: [Partial<enq.EnquiryInput>, string][] = [
      [{ mobile: "123" }, "mobile: 10 digits"], [{ mobile: "" }, "mobile: required"], [{ dateOfBirth: "" }, "dateOfBirth: required"],
      [{ gender: "" }, "gender: required"], [{ givenName: " " }, "givenName: 1-100 characters"], [{ whatsapp: "12" }, "whatsapp: 10 digits"],
      [{ instagram: "a\u0001" }, "instagram: invalid characters"], [{ remark: "x".repeat(1001) }, "remark: 1-1000 characters"],
      [{ lastSchool: "x".repeat(101) }, "lastSchool: 1-100 characters"], [{ currentPincode: "012345" }, "currentPincode: 6 digits, not starting with 0"],
      [{ qualification: "PHD" }, "qualification: one of the listed values"], [{ pathId: 99 }, "pathId: inactive or unknown"],
      [{ typeId: 0 }, "typeId: inactive or unknown"], [{ courseCodes: [] }, "courseCodes: 1-3"], [{ courseCodes: ["DCA", "dca"] }, "courseCodes: distinct"],
      [{ courseCodes: ["NOPE"] }, "courseCodes[0]: no such course"], [{ enquiredOn: "2099-01-01" }, "enquiredOn: not in the future"],
      [{ statusId: S.LOST }, "statusId: open statuses only"], [{ statusId: S.ENROLLED }, "statusId: open statuses only"],
      [{ email: "a@b@c" }, "email: one @"],
    ];
    for (const [o, m] of bad) expect(await msg(enq.createEnquiry(WA, base(o))), JSON.stringify(o)).toBe(m);
    // the database refuses the same values (named checks)
    const ins = (col: string, v: string) => sqlErr(`insert into app.enquiry (centre_id, given_name, date_of_birth, gender, mobile, path_id, type_id,
      status_id, course_code_1, enquired_on, created_by, ${col}) values (1, 'X', '2005-01-01', 'FEMALE', '9100000000', 1, 1, 1, 'DCA', '2026-10-01', $1, $2)`, [EQ.wa, v]);
    for (const [col, v] of [["whatsapp", "12"], ["current_pincode", "012345"], ["qualification", "PHD"], ["remark", " x"], ["instagram", "a\u0001"], ["email", "a@b@c"]]) {
      expect(await ins(col!, v!), col).toMatchObject({ code: "23514", constraint: `enquiry_${col}_check` });
    }
    expect(await ins("course_code_2", "DCA")).toMatchObject({ code: "23514", constraint: "enquiry_courses_check" });

    // same mobile (DD-10): an open enquiry at the centre warns; the refusal is audited FAILED with ids only (D3)
    const m = "9123456780";
    const first = await create({ mobile: m });
    const w = await thrown(enq.createEnquiry(WA, base({ mobile: m, givenName: "Second" })));
    expect(w).toBeInstanceOf(enq.SameMobile);
    expect((w as enq.SameMobile).warnings).toEqual([{ kind: "enquiry", id: first, givenName: expect.any(String), familyName: null }]);
    const [failed] = await audit("enquiry.create", "FAILED");
    expect(failed).toMatchObject({ reason: "duplicate", detail: { enquiries: [first], persons: [] } });
    const second = (await enq.createEnquiry(WA, base({ mobile: m, givenName: "Second" }), [first])).id;
    // a match not shown warns again
    expect(await thrown(enq.createEnquiry(WA, base({ mobile: m, givenName: "Third" }), [first]))).toBeInstanceOf(enq.SameMobile);
    expect(second).not.toBe(first);
    // a learner with the mobile warns only callers who may view the learner (student.view)
    const lm = "9123456781";
    const learner = await admit(ST_TOKEN.sa, admitInput({ person: { givenName: "Lea", mobile: lm } }));
    expect(((await thrown(enq.createEnquiry(WA, base({ mobile: lm })))) as enq.SameMobile).warnings)
      .toEqual([{ kind: "learner", personId: learner.personId, givenName: "Lea", familyName: null }]);
    await create({ mobile: lm }, MA); // EQ.ma: no student.view, so no learner is named

    // scope: another centre, and view only
    expect(await thrown(enq.createEnquiry(WA, base({ centreId: C.B })))).toBeInstanceOf(Forbidden);
    expect(await thrown(enq.createEnquiry(VA, base()))).toBeInstanceOf(Forbidden);
    // every create counts against the search limit (I1)
    let limited: unknown = null;
    for (let i = 0; i < 31 && !limited; i++) limited = await enq.createEnquiry(WB, base({ centreId: C.B })).then(() => null, (e) => e);
    expect(limited).toBeInstanceOf(RateLimited);
  });

  test("T-ENQ-002 working: version, references kept, statuses, counsellor, follow-ups, immutable log, enrolled frozen", async () => {
    const id = await create({ pathId: 2 });
    expect(await msg(enq.updateEnquiry(WA, C.A, id, 2, { remark: "x" }))).toBe("enquiry: changed since you opened it; reload the page");
    expect(await msg(enq.updateEnquiry(WA, C.A, id, 1, { pathId: 2 }))).toBe("enquiry: nothing to change");
    expect(await enq.updateEnquiry(WA, C.A, id, 1, { remark: "Call after 5", courseCodes: ["DCA", "TALLY"] }))
      .toEqual({ version: 2, changed: ["remark", "courseCodes"] });
    expect((await audit("enquiry.update"))[0].detail).toEqual({ fields: ["remark", "courseCodes"] });
    // an unchanged inactive reference is kept; a new one must be active (I9)
    await sql(`update app.enquiry_path set active = false where id = 2`);
    await sql(`update app.course set active = false where code = 'TALLY'`);
    await enq.updateEnquiry(WA, C.A, id, 2, { remark: "kept", pathId: 2, courseCodes: ["TALLY", "DCA"] });
    expect(await enq.updateEnquiry(WA, C.A, id, 3, { courseCodes: ["DCA", "CCNA", "DTP"], pathId: 3 })).toEqual({ version: 4, changed: ["pathId", "courseCodes"] });
    const id2 = await create();
    expect(await msg(enq.updateEnquiry(WA, C.A, id2, 1, { pathId: 2 }))).toBe("pathId: inactive or unknown");
    expect(await msg(enq.updateEnquiry(WA, C.A, id2, 1, { courseCodes: ["TALLY"] }))).toBe("courseCodes[0]: no such course");

    // statuses (DD-6, DD-15)
    expect(await msg(enq.setEnquiryStatus(WA, C.A, [id2], S.ENROLLED, null))).toBe("statusId: not by hand");
    expect(await msg(enq.setEnquiryStatus(WA, C.A, [id2], S.LOST, null))).toBe("note: required");
    await enq.addFollowUp(WA, C.A, id2, { kind: "CALL_OUT", note: "No answer", nextOn: "2099-01-01" });
    expect(await enquiry(id2)).toMatchObject({ next_follow_up_on: expect.any(Date), last_contact_at: expect.any(Date) });
    await enq.setEnquiryStatus(WA, C.A, [id2], S.LOST, "Joined elsewhere");
    expect(await enquiry(id2)).toMatchObject({ kind: "LOST", next_follow_up_on: null });
    expect(await msg(enq.setEnquiryStatus(WA, C.A, [id2], S.NEW, null))).toBe("note: required"); // reopening needs a note
    await enq.setEnquiryStatus(WA, C.A, [id2], S.NEW, "Called back");
    expect((await sql(`select kind, note from app.enquiry_followup where enquiry_id = $1 order by id`, [id2])).map((r) => r.kind)).toEqual(["CALL_OUT", "NOTE", "NOTE"]);
    await enq.updateEnquiry(WA, C.A, id2, 1, { remark: "lost and junk stay editable" });

    // counsellor: must be able to receive enquiries at the centre
    expect(await msg(enq.setCounsellor(WA, C.A, [id], EQ.va))).toBe("userId: cannot receive enquiries here");
    expect(await msg(enq.setCounsellor(WA, C.A, [id], EQ.wb))).toBe("userId: cannot receive enquiries here");
    await enq.setCounsellor(WA, C.A, [id], EQ.ma);
    expect((await enquiry(id)).counsellor_id).toBe(EQ.ma);
    expect((await audit("enquiry.counsellor"))[0]).toMatchObject({ target_id: id, detail: { ids: [id], fields: ["counsellorId"] } });

    // follow-ups: a NOTE keeps the next date and is no contact; null clears; the past is refused
    await enq.addFollowUp(WA, C.A, id, { kind: "VISIT", note: "Came with parent", durationMin: 20, nextOn: "2099-02-01" });
    const before = await enquiry(id);
    await enq.addFollowUp(WA, C.A, id, { kind: "NOTE", note: "Prefers mornings" });
    expect(await enquiry(id)).toMatchObject({ next_follow_up_on: before.next_follow_up_on, last_contact_at: before.last_contact_at });
    await enq.addFollowUp(WA, C.A, id, { kind: "MESSAGE", note: "Sent brochure", nextOn: null });
    expect((await enquiry(id)).next_follow_up_on).toBeNull();
    expect(await msg(enq.addFollowUp(WA, C.A, id, { kind: "NOTE", note: "x", nextOn: "2000-01-01" }))).toBe("nextOn: not in the past");
    expect(await msg(enq.addFollowUp(WA, C.A, id, { kind: "FAX", note: "x" }))).toBe("kind: one of the listed values");
    expect(await msg(enq.addFollowUp(WA, C.A, id, { kind: "NOTE", note: " " }))).toBe("note: 1-2000 characters");
    expect((await audit("enquiry.followup")).find((r) => r.target_id === id).detail.fields).toEqual(["kind", "note", "durationMin", "nextOn"]);
    expect(JSON.stringify(await audit("enquiry.followup"))).not.toContain("Came with parent");
    // the log is append-only, even for the owner
    expect((await sqlErr(`update app.enquiry_followup set note = 'x'`))?.message).toContain("append-only");
    expect((await sqlErr(`delete from app.enquiry_followup`))?.message).toContain("append-only");
    expect((await sqlErr(`truncate app.enquiry_followup`))?.message).toContain("append-only");

    // enrolled is frozen for every write (DD-15)
    await admit(WA, admitInput({ enquiryId: id }));
    expect(await msg(enq.updateEnquiry(WA, C.A, id, (await enquiry(id)).version, { remark: "x" }))).toBe("enquiry: enrolled");
    expect(await msg(enq.setEnquiryStatus(WA, C.A, [id], S.NEW, "x"))).toBe("enquiry: enrolled");
    expect(await msg(enq.setCounsellor(WA, C.A, [id], null))).toBe("enquiry: enrolled");
    expect(await msg(enq.addFollowUp(WA, C.A, id, { kind: "NOTE", note: "x" }))).toBe("enquiry: enrolled");
  });

  test("T-ENQ-003 bulk: all or nothing, one centre, the cap, one audit row, no deadlock", async () => {
    const ids = [await create(), await create(), await create()];
    const atB = await create({ centreId: C.B }, WB);
    expect(await enq.setEnquiryStatus(WA, C.A, [...ids, ids[0]!], S.CONTACTED, null)).toEqual({ count: 3 }); // deduplicated
    const [row] = await audit("enquiry.status");
    expect(row.detail).toEqual({ ids, fields: ["statusId"] });
    expect(row.target_id).toBeNull();
    expect(await msg(enq.setEnquiryStatus(WA, C.A, [...ids, atB], S.NEW, null))).toBe("ids: one centre");
    expect(await msg(enq.setEnquiryStatus(WA, C.A, [...ids, "999999"], S.NEW, null))).toBe("ids: one centre");
    expect((await sql(`select distinct status_id from app.enquiry where id = any ($1)`, [ids])).map((r) => r.status_id)).toEqual([S.CONTACTED]);
    expect(await msg(enq.setEnquiryStatus(WA, C.A, Array.from({ length: 101 }, (_, i) => String(i + 1)), S.NEW, null))).toBe("ids: 1-100");
    // an enrolled one in the set refuses the whole set
    await admit(WA, admitInput({ enquiryId: ids[2] }));
    expect(await msg(enq.setCounsellor(WA, C.A, ids, EQ.ma))).toBe("enquiry: enrolled");
    expect((await sql(`select count(*)::int n from app.enquiry where counsellor_id is not null`))[0].n).toBe(0);
    // overlapping bulk calls in opposite orders finish (ordered locks)
    const a = [ids[0]!, ids[1]!], b = [ids[1]!, ids[0]!];
    const results = await Promise.all([enq.setCounsellor(WA, C.A, a, EQ.ma), enq.setCounsellor(WA, C.A, b, EQ.wa),
      enq.setCounsellor(WA, C.A, a, null), enq.setCounsellor(WA, C.A, b, EQ.ma)]);
    expect(results.map((r) => r.count)).toEqual([2, 2, 2, 2]);
  });

  test("T-ENQ-004 enroll: link and status in one transaction, once; refusals; the database guards", async () => {
    const id = await create();
    const r = await admit(WA, admitInput({ enquiryId: id }));
    expect(await enquiry(id)).toMatchObject({ admission_id: r.admissionId, status_id: S.ENROLLED, version: 1 });
    expect((await audit("person.admit")).at(-1).detail).toMatchObject({ enquiryId: id });
    expect(await msg(admit(WA, admitInput({ enquiryId: id })))).toBe("enquiry: already enrolled");
    // closed, malformed, unknown
    const lost = await create();
    await enq.setEnquiryStatus(WA, C.A, [lost], S.JUNK, "spam");
    expect(await msg(admit(WA, admitInput({ enquiryId: lost })))).toBe("enquiry: closed");
    expect(await msg(admit(WA, admitInput({ enquiryId: "abc" })))).toBe("enquiry: not found");
    expect(await msg(admit(WA, admitInput({ enquiryId: "999999" })))).toBe("enquiry: not found");
    // another centre: "other centre" only with enquiry.manage at both; otherwise "not found" (R16)
    const atB = await create({ centreId: C.B }, WB);
    expect(await msg(admit(WA, admitInput({ enquiryId: atB })))).toBe("enquiry: not found");
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 22, 'CENTRE', 3)`, [EQ.wa]);
    expect(await msg(admit(WA, admitInput({ enquiryId: atB })))).toBe("enquiry: other centre");
    // without enquiry.manage: Forbidden, and the DENIED row names it (I7)
    const open = await create();
    expect(await thrown(admit(ST_TOKEN.sa, admitInput({ enquiryId: open })))).toBeInstanceOf(Forbidden);
    expect((await audit("person.admit", "DENIED")).at(-1).detail).toEqual({ permission: "enquiry.manage" });
    // a failed admit leaves the enquiry open
    expect(await msg(admit(WA, admitInput({ enquiryId: open, courses: [{ courseCode: "NOPE", joinDate: "2026-11-01" }] })))).toBe("courses[0].courseCode: no such course");
    expect(await enquiry(open)).toMatchObject({ admission_id: null, kind: "OPEN" });
    // two enrols of one enquiry at once: exactly one admission
    const both = await Promise.allSettled([admit(WA, admitInput({ enquiryId: open })), admit(WA, admitInput({ enquiryId: open }))]);
    expect(both.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    // the guards refuse every forbidden insert and change, also for the owner
    const ins = (extra: string, vals: string) => sqlErr(`insert into app.enquiry (centre_id, given_name, date_of_birth, gender, mobile, path_id,
      type_id, course_code_1, enquired_on, created_by, status_id${extra}) values (1, 'X', '2005-01-01', 'FEMALE', '9100000000', 1, 1, 'DCA',
      '2026-10-01', '${EQ.wa}', ${vals})`);
    expect((await ins("", String(S.LOST)))?.message).toContain("inserted open");
    expect((await ins(", admission_id", `${S.ENROLLED}, '${r.admissionId}'`))?.message).toContain("inserted open");
    expect((await ins(", version", `${S.NEW}, 2`))?.message).toContain("inserted open");
    expect((await sqlErr(`update app.enquiry set remark = 'x' where id = $1`, [id]))?.message).toContain("is enrolled");
    const other = await create();
    expect((await sqlErr(`update app.enquiry set status_id = ${S.ENROLLED} where id = $1`, [other]))?.message).toContain("exactly when");
    expect((await sqlErr(`update app.enquiry set admission_id = $2 where id = $1`, [other, r.admissionId]))?.message).toContain("exactly when");
    expect((await sqlErr(`update app.enquiry set centre_id = 2 where id = $1`, [other]))?.message).toContain("centre cannot change");
    expect((await sqlErr(`insert into app.enquiry_followup (enquiry_id, centre_id, kind, note, by_user) values ($1, 1, 'NOTE', 'x', $2)`, [id, EQ.wa]))?.message)
      .toContain("open, visible enquiry");
    expect((await sqlErr(`insert into app.enquiry_followup (enquiry_id, centre_id, kind, note, by_user) values ($1, 2, 'NOTE', 'x', $2)`, [other, EQ.wa]))?.code)
      .toBe("P0001"); // a follow-up cannot name another centre
    // created_by is the session user whatever is supplied
    expect((await enquiry(other)).created_by).toBe(EQ.wa);
  });

  test("T-ENQ-005 scope and reads: RLS by SQL, no delete, manage implies view, definer functions, list, search, calendar", async () => {
    const a1 = await create({ givenName: "Meera", mobile: "9555500001" });
    const a2 = await create({ givenName: "Arun" });
    const b1 = await create({ centreId: C.B, givenName: "Bina" }, WB);
    // RLS by direct SQL
    expect((await as(T.uA, `select id from app.enquiry`)).rowCount).toBe(0);
    expect((await as(WB, `select id::text from app.enquiry`)).rows.map((r) => r.id)).toEqual([b1]);
    expect((await as(WB, `update app.enquiry set remark = 'x' where id = $1`, [a1])).rowCount).toBe(0);
    expect(await thrown(as(VA, `insert into app.enquiry (centre_id, given_name, date_of_birth, gender, mobile, path_id, type_id, status_id,
      course_code_1, enquired_on) values (1, 'X', '2005-01-01', 'FEMALE', '9100000000', 1, 1, 1, 'DCA', '2026-10-01')`))).toMatchObject({ code: "42501" });
    expect(await thrown(as(WA, `delete from app.enquiry where id = $1`, [a1]))).toMatchObject({ code: "42501" });
    expect(await thrown(as(WA, `update app.enquiry set centre_id = 1`))).toMatchObject({ code: "42501" });
    // every role that manages enquiries can view them (non-vacuous)
    expect((await sql(`select count(*)::int n from app.role_permission where permission_key = 'enquiry.manage'`))[0].n).toBeGreaterThan(0);
    expect(await sql(`select role_id from app.role_permission where permission_key = 'enquiry.manage'
      except select role_id from app.role_permission where permission_key = 'enquiry.view'`)).toEqual([]);
    // definer functions answer only callers who may view the centre
    expect((await as(T.uA, `select app.enquiry_may_receive(1, $1) ok`, [EQ.ma])).rows[0].ok).toBe(false);
    expect((await as(T.uA, `select * from app.enquiry_counsellors(1)`)).rowCount).toBe(0);
    expect((await as(VA, `select app.enquiry_may_receive(1, $1) ok`, [EQ.ma])).rows[0].ok).toBe(true);
    expect((await enq.enquiryCounsellors(VA, C.A)).map((u) => u.id).sort()).toEqual([EQ.ma, EQ.wa].sort());
    await enq.setCounsellor(WB, C.B, [b1], EQ.wb);
    expect((await as(WA, `select * from app.enquiry_people($1)`, [[b1]])).rowCount).toBe(0);
    expect((await as(WB, `select display_name from app.enquiry_people($1)`, [[b1]])).rows).toEqual([{ display_name: "Enquiry wb" }]);
    // list: scope, filters, POST-only q (id, mobile, name), no mobile in the rows
    expect(await thrown(enq.listEnquiries(T.uA))).toBeInstanceOf(Forbidden);
    const all = await enq.listEnquiries(WA);
    expect(all.map((r) => r.id)).toEqual([a2, a1]);
    expect(Object.keys(all[0]!)).not.toContain("mobile");
    expect((await enq.listEnquiries(WA, { q: a1 })).map((r) => r.id)).toEqual([a1]);
    expect((await enq.listEnquiries(WA, { q: "9555500001" })).map((r) => r.id)).toEqual([a1]);
    expect((await enq.listEnquiries(WA, { q: "+91 95555 00001" })).map((r) => r.id)).toEqual([a1]);
    expect((await enq.listEnquiries(WA, { q: "mee" })).map((r) => r.id)).toEqual([a1]);
    expect((await enq.listEnquiries(WA, { q: "%" }))).toEqual([]);
    await enq.setEnquiryStatus(WA, C.A, [a2], S.JUNK, "spam");
    expect((await enq.listEnquiries(WA, { kind: "JUNK" })).map((r) => r.id)).toEqual([a2]);
    expect((await enq.listEnquiries(WA, { statusId: String(S.NEW) })).map((r) => r.id)).toEqual([a1]);
    expect(await enq.listEnquiries(WA, { kind: "nope" })).toEqual([]);
    expect(await enq.listEnquiries(WA, { from: "2026-13-01" })).toEqual([]);
    expect(await enq.listEnquiries(WA, { from: "2099-01-01" })).toEqual([]);
    await enq.addFollowUp(WA, C.A, a1, { kind: "CALL_OUT", note: "Call again", nextOn: "2099-03-15" });
    expect((await enq.listEnquiries(WA, { due: "2099-03-15" })).map((r) => r.id)).toEqual([a1]);
    expect(await enq.listEnquiries(WA, { due: "2099-03-14" })).toEqual([]);
    // calendar
    expect(await enq.followUpCalendar(WA, "2099-03")).toEqual([{ day: "2099-03-15", rows: [expect.objectContaining({ id: a1, givenName: "Meera" })] }]);
    expect(await enq.followUpCalendar(WB, "2099-03")).toEqual([]);
    expect(await thrown(enq.followUpCalendar(WA, "2099-3"))).toMatchObject({ reason: "notfound" });
    // the record: 404 parity, permissions
    const g = await enq.getEnquiry(WA, a1);
    expect(g).toMatchObject({ canManage: true, canEnrol: true, enquiry: { id: a1, givenName: "Meera", courseCodes: ["DCA"] } });
    expect((await enq.getEnquiry(MA, a1)).canEnrol).toBe(false);
    expect((await enq.getEnquiry(VA, a1)).canManage).toBe(false);
    expect(await thrown(enq.getEnquiry(WA, b1))).toMatchObject({ reason: "notfound" });
    expect(await thrown(enq.getEnquiry(WA, "999999"))).toMatchObject({ reason: "notfound" });
    expect(await thrown(enq.getEnquiry(WA, "abc"))).toMatchObject({ reason: "notfound" });
    expect([await enq.canViewEnquiries(WA), await enq.canViewEnquiries(T.uA)]).toEqual([true, false]);
  });

  test("T-ENQ-006 setup: paths and types via the shared masters; statuses keep kind, the enrolled one and the last of a kind", async () => {
    // paths and types: enquiry.setup, not catalogue.manage
    const p = await cat.createMaster(SETUP, "enquiry_path", { code: "radio", name: "Radio" });
    expect(p.code).toBe("RADIO");
    expect(await thrown(cat.createMaster("tok-catA", "enquiry_type", { code: "X", name: "X" }))).toBeInstanceOf(Forbidden);
    expect((await cat.listMasters(SETUP, "enquiry_path")).canManage).toBe(true);
    expect((await cat.listMasters("tok-catA", "enquiry_path")).canManage).toBe(false);
    expect((await cat.listMasters("tok-catA", "course_category")).canManage).toBe(true);
    await cat.setMasterActive(SETUP, "enquiry_path", p.id, false, "unused");
    expect((await audit("catalogue.deactivate"))[0]).toMatchObject({ target_type: "enquiry_path" });
    // statuses
    expect(await msg(enq.createEnquiryStatus(SETUP, { code: "won", name: "Won", kind: "ENROLLED", colour: "#000000", sortOrder: 1 }))).toBe("kind: one of OPEN, LOST, JUNK");
    expect(await msg(enq.createEnquiryStatus(SETUP, { code: "hot", name: "Hot", kind: "OPEN", colour: "red", sortOrder: 1 }))).toBe("colour: #rrggbb");
    expect(await msg(enq.createEnquiryStatus(SETUP, { code: "hot", name: "Hot", kind: "OPEN", colour: "#FF0000", sortOrder: 1001 }))).toBe("sortOrder: 0-1000");
    const hot = await enq.createEnquiryStatus(SETUP, { code: "hot", name: "Hot lead", kind: "OPEN", colour: "#FF0000", sortOrder: 5 });
    expect((await enq.listEnquiryStatuses(SETUP)).rows.find((s) => s.id === hot.id)).toMatchObject({ code: "HOT", colour: "#ff0000", kind: "OPEN" });
    expect(await thrown(enq.createEnquiryStatus(SETUP, { code: "HOT", name: "x", kind: "OPEN", colour: "#000000", sortOrder: 1 }))).toMatchObject({ key: "catalogue.duplicate" });
    await enq.updateEnquiryStatus(SETUP, S.ENROLLED, { name: "Admitted", colour: "#00aa00" }); // renaming the enrolled status is fine (DD-6)
    expect(await msg(enq.updateEnquiryStatus(SETUP, S.ENROLLED, { name: "Admitted" }))).toBe("nothing to change");
    expect(await thrown(enq.setEnquiryStatusActive(SETUP, S.ENROLLED, false, "r"))).toMatchObject({ key: "enquiry.setup.keep" });
    expect(await thrown(enq.setEnquiryStatusActive(SETUP, S.JUNK, false, "r"))).toMatchObject({ key: "enquiry.setup.keep" });
    expect(await msg(enq.setEnquiryStatusActive(SETUP, S.NEW, false, " "))).toBe("reason: required");
    await enq.setEnquiryStatusActive(SETUP, S.NEW, false, "use Hot");
    expect((await audit("enquiry.setup.status.deactivate"))[0]).toMatchObject({ target_id: String(S.NEW), reason: "use Hot" });
    await enq.setEnquiryStatusActive(SETUP, S.NEW, true, "back");
    expect(await audit("enquiry.setup.status.activate")).toHaveLength(1);
    expect(await audit("enquiry.setup.status.update")).toHaveLength(1);
    expect(await audit("enquiry.setup.status.create")).toHaveLength(1);
    // two managers switching off the last two LOST statuses at once: one is kept (R4)
    const lost2 = await enq.createEnquiryStatus(SETUP, { code: "lost2", name: "Lost (price)", kind: "LOST", colour: "#777777", sortOrder: 960 });
    const race = await Promise.allSettled([enq.setEnquiryStatusActive(SETUP, S.LOST, false, "a"), enq.setEnquiryStatusActive(SETUP, lost2.id, false, "b")]);
    expect(race.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await sql(`select count(*)::int n from app.enquiry_status where kind = 'LOST' and active`))[0].n).toBe(1);
    // non-holders; the database keeps one ENROLLED row, its kind and code fixed
    expect(await thrown(enq.createEnquiryStatus(WA, { code: "x", name: "x", kind: "OPEN", colour: "#000000", sortOrder: 1 }))).toBeInstanceOf(Forbidden);
    expect(await sqlErr(`insert into app.enquiry_status (code, name, kind, colour, sort_order) values ('E2', 'E2', 'ENROLLED', '#000000', 1)`))
      .toMatchObject({ code: "23514", constraint: "enquiry_status_enrolled_check" });
    expect(await sqlErr(`update app.enquiry_status set active = false where code = 'ENROLLED'`)).toMatchObject({ constraint: "enquiry_status_enrolled_check" });
    expect(await thrown(as(SETUP, `update app.enquiry_status set kind = 'LOST' where id = 1`))).toMatchObject({ code: "42501" });
    expect(await thrown(as(SETUP, `update app.enquiry_status set code = 'X' where id = 1`))).toMatchObject({ code: "42501" });
    expect((await sql(`select sensitive from app.permission where key = 'enquiry.setup'`))[0].sensitive).toBe(true);
    // readers: enquiry.view holders read the list without managing it; others are refused
    expect((await enq.listEnquiryStatuses(VA)).canManage).toBe(false);
    expect(await thrown(enq.listEnquiryStatuses(T.uA))).toBeInstanceOf(Forbidden);
  });
});
