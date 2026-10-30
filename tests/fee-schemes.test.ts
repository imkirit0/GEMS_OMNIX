// Fee schemes and concessions: T-SC-001…004 (audit 09; docs/designs/fee-schemes/fee-schemes.md). The schemes page and the
// concession register are real-server smoke checks.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as schemeRoute } from "../app/students/[personId]/scheme/route";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import { Forbidden } from "../src/server/action";
import { PersonError } from "../src/server/person-rules";
import { StepUpRequired } from "../src/server/rbac";
import { admit, type AdmitInput } from "../src/server/people";
import { createDues, duesForPerson } from "../src/server/dues";
import * as fee from "../src/server/fees";
import { collectFee, FEE_GATES } from "../src/server/receipts";
import * as sch from "../src/server/schemes";
import { assignScheme, concessionCentres, concessionRegister, schemesFor } from "../src/server/concessions";
import { asAdmin, C, FD, reset, rows, SC, setStepUp, ST_TOKEN, T } from "./fixtures";
import { DCA, FEE_S, seedFeePlan, TALLY } from "./fee-seed";

const M = "tok-schM", A = "tok-schA", K = "tok-feeK", D = "tok-feeD", COL = "tok-feeC", V = ST_TOKEN.sa;
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
let n = 0;
const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({
  person: { givenName: `Scheme${++n}`, mobile: `98700${String(n).padStart(5, "0")}` }, centreId: C.A, academicYear: "2026-27",
  admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });
async function learner(centreId: number = C.A, tok: string = V) {
  const a = await admit(tok, input({ centreId }));
  const dca = a.registrations[0]!.id;
  await createDues(D, a.personId, dca);
  // reg I1 500.00, course I1 12000.50, reg I2 0.10, course I2 8000.00 (fee-seed)
  const dues = (await sql(`select d.id::text from app.fee_due d where d.registration_id = $1 and d.source = 'PLAN' order by d.due_on, d.id`, [dca])).map((r) => r.id as string);
  return { personId: a.personId, dca, dues };
}
let seq = 0;
type Rule = { feeTypeId: number; kind: string; value: string };
/** A scheme made by the maker and, unless draft, approved by the checker. */
async function scheme(rules: Rule[], o: { courses?: number[]; centres?: number[]; validFrom?: string; validTo?: string; draft?: boolean } = {}) {
  const { id } = await sch.createScheme(M, { code: `SCH${++seq}`, name: `Scheme ${seq}`, validFrom: o.validFrom ?? "2026-01-01", validTo: o.validTo ?? "2027-12-31" });
  for (const r of rules) await sch.setSchemeRule(M, id, r);
  await sch.setSchemeCourses(M, id, o.courses ?? [DCA]);
  if (o.centres) await sch.setSchemeCentres(M, id, o.centres);
  if (!o.draft) await sch.approveScheme(A, id);
  return id;
}
const concessions = async (dues: string[]) => (await sql(`select d.id::text, coalesce(c.amount::text, '') as a from unnest($1::bigint[]) with ordinality u(id, o)
  join app.fee_due d on d.id = u.id left join app.fee_concession c on c.due_id = d.id order by u.o`, [dues])).map((r) => r.a);

let app: pg.Client;
let seed: Awaited<ReturnType<typeof seedFeePlan>>;
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(async () => {
  await reset(); await setStepUp(FEE_S, 0); await setStepUp(M, 0); await setStepUp(A, 0); seed = await seedFeePlan();
  FEE_GATES.collectionLive = true;
  const [{ p }] = await sql(`select app.financial_year((now() at time zone 'Asia/Kolkata')::date) as p`);
  await sql(`insert into app.number_series (centre_id, doc_type, period, gap_rule) select c, 'FEEREC', $1, 'GAPLESS' from unnest(array[1, 2, 3]) c
    on conflict do nothing`, [p]);
});
afterEach(() => { FEE_GATES.collectionLive = false; });

describe("T-SC fee schemes and concessions", () => {
  test("T-SC-001 lifecycle: draft, rules and targets, approval by another, LIVE frozen, retire; refusals; audit", async () => {
    const { id } = await sch.createScheme(M, { code: "early bird", name: " Early bird ", validFrom: "2026-06-01", validTo: "2027-05-31" });
    expect((await sch.getScheme(M, id)).scheme).toMatchObject({ code: "EARLY BIRD", name: "Early bird", status: "DRAFT", createdBy: "Scheme maker" });
    // drafts are hidden from users without a scheme permission (Z8-7)
    expect((await sch.listSchemes(V)).rows).toEqual([]);
    expect(await thrown(sch.getScheme(V, id))).toMatchObject({ reason: "notfound" });
    await sch.setSchemeRule(M, id, { feeTypeId: seed.reg, kind: "PERCENT", value: "25" });
    await sch.setSchemeRule(M, id, { feeTypeId: seed.course, kind: "AMOUNT", value: "1000" });
    await sch.setSchemeRule(M, id, { feeTypeId: seed.course, value: null });
    await sch.updateScheme(M, id, { name: "Early bird 2026" });
    expect(await thrown(sch.approveScheme(A, id))).toMatchObject({ key: "fee.scheme.incomplete" }); // no course yet
    await sch.setSchemeCourses(M, id, [DCA, TALLY]);
    await sch.setSchemeCentres(M, id, [C.A]);
    await sch.setSchemeCentres(M, id, []);
    // the maker may not approve; without a fresh step-up the approver is sent to step up
    expect(await thrown(sch.approveScheme(M, id))).toBeInstanceOf(Forbidden);
    await setStepUp(A, 1000);
    expect(await thrown(sch.approveScheme(A, id))).toBeInstanceOf(StepUpRequired);
    await setStepUp(A, 0);
    await sch.approveScheme(A, id);
    const live = await sch.getScheme(V, id);
    expect(live.scheme).toMatchObject({ status: "LIVE", approvedBy: SC.checker, updatedBy: SC.maker }); // names only with rbac.view or for oneself
    expect(live.rules).toEqual([{ feeTypeId: seed.reg, feeTypeCode: "REG", feeTypeName: "Registration", kind: "PERCENT", value: "25" }]);
    expect(live.courses.map((c) => c.code)).toEqual(["DCA", "TALLY"]);
    expect((await sch.listSchemes(V)).rows.map((r) => [r.code, r.status, r.rules, r.courses, r.centres])).toEqual([["EARLY BIRD", "LIVE", 1, 2, 0]]);
    // LIVE never changes
    expect(await thrown(sch.updateScheme(M, id, { name: "Other" }))).toMatchObject({ key: "fee.scheme.locked" });
    expect(await thrown(sch.setSchemeRule(M, id, { feeTypeId: seed.course, kind: "PERCENT", value: "10" }))).toMatchObject({ key: "fee.scheme.locked" });
    expect(await thrown(sch.setSchemeCourses(M, id, [DCA]))).toMatchObject({ key: "fee.scheme.locked" });
    expect(await thrown(sch.setSchemeCentres(M, id, [C.B]))).toMatchObject({ key: "fee.scheme.locked" });
    expect(await thrown(sch.deleteScheme(M, id))).toMatchObject({ key: "fee.scheme.locked" });
    expect(await thrown(sch.approveScheme(A, id))).toMatchObject({ key: "fee.scheme.locked" });
    // retire with a reason; then final
    expect(await msg(sch.retireScheme(A, id, " "))).toBe("reason: required");
    expect(await msg(sch.retireScheme(A, id, "x".repeat(501)))).toBe("reason: 1-500 characters");
    await sch.retireScheme(A, id, " season over ");
    expect((await sch.getScheme(V, id)).scheme).toMatchObject({ status: "RETIRED", retiredBy: SC.checker, retiredReason: "season over" });
    expect(await thrown(sch.retireScheme(A, id, "again"))).toMatchObject({ key: "fee.scheme.notlive" });
    // self-approval: the checker who also makes schemes cannot approve one it made, nor one it edited last (D4)
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind) values ($1, 34, 'ALL')`, [SC.checker]);
    const made = (await sch.createScheme(A, { code: "MINE", name: "Mine", validFrom: "2026-01-01", validTo: "2027-12-31" })).id;
    await sch.setSchemeRule(A, made, { feeTypeId: seed.reg, kind: "PERCENT", value: "5" });
    await sch.setSchemeCourses(M, made, [DCA]); // the maker edits last; the checker still made it
    expect(await thrown(sch.approveScheme(A, made))).toMatchObject({ key: "fee.scheme.self" });
    const edited = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "5" }], { draft: true });
    await sch.updateScheme(A, edited, { name: "Edited by the checker" });
    expect(await thrown(sch.approveScheme(A, edited))).toMatchObject({ key: "fee.scheme.self" });
    // expired; validation; duplicate code; delete a draft
    const old = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "5" }], { validFrom: "2025-01-01", validTo: "2025-12-31", draft: true });
    expect(await thrown(sch.approveScheme(A, old))).toMatchObject({ key: "fee.scheme.expired" });
    expect(await thrown(sch.approveScheme(A, await scheme([], { draft: true })))).toMatchObject({ key: "fee.scheme.incomplete" }); // a course but no rule
    expect(await msg(sch.setSchemeRule(M, old, { feeTypeId: 9999, kind: "PERCENT", value: "5" }))).toBe("feeTypeId: inactive or unknown");
    expect(await msg(sch.createScheme(M, { code: "X", name: "X", validFrom: "2026-02-01", validTo: "2026-01-31" }))).toBe("validTo: not before validFrom");
    expect(await thrown(sch.createScheme(M, { code: "MINE", name: "Again", validFrom: "2026-01-01", validTo: "2026-12-31" }))).toMatchObject({ key: "fee.duplicate" });
    expect(await msg(sch.setSchemeRule(M, old, { feeTypeId: seed.reg, kind: "PERCENT", value: "150" }))).toBe("value: a percentage from 0.01 to 100");
    expect(await msg(sch.setSchemeRule(M, old, { feeTypeId: seed.reg, kind: "AMOUNT", value: "0" }))).toBe("value: an amount above 0, up to 2 decimals");
    expect(await msg(sch.setSchemeRule(M, old, { feeTypeId: seed.reg, kind: "FREE", value: "1" }))).toBe("kind: percent or amount");
    expect(await msg(sch.setSchemeCourses(M, old, [999]))).toBe("courseIds: inactive or unknown");
    await sch.deleteScheme(M, old);
    expect(await sql(`select 1 from app.fee_scheme where id = $1`, [old])).toEqual([]);
    expect(await thrown(sch.deleteScheme(M, old))).toMatchObject({ reason: "notfound" });
    // audit: every action, with its target
    for (const a of ["fee.scheme.create", "fee.scheme.update", "fee.scheme.rule", "fee.scheme.courses", "fee.scheme.centres", "fee.scheme.delete", "fee.scheme.approve", "fee.scheme.retire"])
      expect((await rows(a)).some((r) => r.outcome === "OK" && r.target_type === "fee_scheme"), a).toBe(true);
    expect((await rows("fee.scheme.retire")).find((r) => r.outcome === "OK")).toMatchObject({ target_id: String(id), reason: "season over" });
    expect((await rows("fee.scheme.approve")).filter((r) => r.outcome === "DENIED")).toHaveLength(1); // the maker's attempt
  });

  test("T-SC-002 assignment: PERCENT and AMOUNT, owed counts concessions, collection posts less; refusals", async () => {
    const S = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "25" }, { feeTypeId: seed.course, kind: "AMOUNT", value: "9000" }]);
    const L = await learner();
    const [before] = await duesForPerson(K, L.personId);
    expect(before).toMatchObject({ scheme: null, canConcede: true });
    expect((await duesForPerson(V, L.personId))[0]!.canConcede).toBe(false); // a viewer may not
    expect(await schemesFor(K, L.dca)).toEqual([{ id: S, code: `SCH${seq}`, name: `Scheme ${seq}` }]);
    expect(await assignScheme(K, L.personId, L.dca, S)).toEqual({ concessions: 4, total: "9125.03" });
    // 25% of 500.00 and of 0.10 (0.025 rounds half up); AMOUNT 9000 over the course fee, latest first: 8000.00 then 1000.00
    expect(await concessions(L.dues)).toEqual(["125.00", "1000.00", "0.03", "8000.00"]);
    const [after] = await duesForPerson(K, L.personId);
    expect(after).toMatchObject({ scheme: { code: `SCH${seq}`, name: `Scheme ${seq}` }, canConcede: false, total: "20500.60", outstanding: "11375.57", collectable: "11375.57" });
    expect(after!.dues.map((d) => [d.concession, d.outstanding])).toEqual([["125.00", "375.00"], ["1000.00", "11000.50"], ["0.03", "0.07"], ["8000.00", "0.00"]]);
    // the identity for every plan due
    expect(await sql(`select count(*)::int as n from app.fee_due d join app.fee_due_balance b on b.due_id = d.id
      where d.source = 'PLAN' and d.gross <> b.paid + b.concession + b.outstanding`)).toEqual([{ n: 0 }]);
    const audit = (await rows("fee.concession.assign")).find((r) => r.outcome === "OK");
    expect(audit).toMatchObject({ target_type: "fee_scheme_assignment", target_centre_id: C.A,
      after: { registrationId: L.dca, schemeId: S, schemeCode: `SCH${seq}`, concessions: 4, total: "9125.03" } });
    expect(audit.target_id).toBe((await sql(`select id::text from app.fee_scheme_assignment where registration_id = $1`, [L.dca]))[0].id);
    // collection takes only what is owed; the fully conceded due gets no line
    const r = await collectFee(COL, L.personId, { registrationId: L.dca, amount: "11375.57", mode: "CASH", idempotencyKey: crypto.randomUUID() });
    expect(r.total).toBe("11375.57");
    expect((await sql(`select due_id::text as d from app.receipt_allocation where receipt_id = $1 order by id`, [r.receiptId])).map((x) => x.d)).toEqual(L.dues.slice(0, 3));
    expect(await thrown(collectFee(COL, L.personId, { registrationId: L.dca, amount: "1", mode: "CASH", idempotencyKey: crypto.randomUUID() }))).toMatchObject({ key: "fee.receipt.nothing" });
    // PERCENT of the course fee: 25% of 12000.50 = 3000.13 (half up); an AMOUNT above the fee type's total is capped at gross
    const P = await scheme([{ feeTypeId: seed.course, kind: "PERCENT", value: "25" }]);
    const L2 = await learner();
    expect(await assignScheme(K, L2.personId, L2.dca, P)).toEqual({ concessions: 2, total: "5000.13" });
    expect(await concessions(L2.dues)).toEqual(["", "3000.13", "", "2000.00"]);
    const Q = await scheme([{ feeTypeId: seed.reg, kind: "AMOUNT", value: "1000" }]);
    const L3 = await learner();
    expect(await assignScheme(K, L3.personId, L3.dca, Q)).toEqual({ concessions: 2, total: "500.10" });
    expect(await concessions(L3.dues)).toEqual(["500.00", "", "0.10", ""]);
    // refusals
    expect(await thrown(assignScheme(K, L3.personId, L3.dca, P))).toMatchObject({ key: "fee.scheme.exists" }); // L is paid: its guard speaks first
    const paid = await learner();
    await collectFee(COL, paid.personId, { registrationId: paid.dca, amount: "100", mode: "CASH", idempotencyKey: crypto.randomUUID() });
    expect((await duesForPerson(K, paid.personId))[0]!.canConcede).toBe(false);
    expect(await thrown(assignScheme(K, paid.personId, paid.dca, S))).toMatchObject({ key: "fee.scheme.paid" });
    const later = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "5" }], { validFrom: "2027-01-01" });
    const tally = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "5" }], { courses: [TALLY] });
    const elsewhere = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "5" }], { centres: [C.A2] });
    const draft = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "5" }], { draft: true });
    const retired = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "5" }]);
    await sch.retireScheme(A, retired, "ended");
    const L4 = await learner();
    for (const x of [later, tally, elsewhere, draft, retired, 999999]) expect(await thrown(assignScheme(K, L4.personId, L4.dca, x)), String(x)).toMatchObject({ key: "fee.scheme.notfor" });
    expect((await schemesFor(K, L4.dca)).map((o) => o.id)).toEqual([S, P, Q]);
    const { id: EXAM } = await fee.createFeeType(FEE_S, { code: "exam", name: "Exam Fee", categoryId: seed.catId, sortOrder: 20, hsnSac: "999293", gstRate: "18" });
    const none = await scheme([{ feeTypeId: EXAM, kind: "PERCENT", value: "50" }]);
    expect(await thrown(assignScheme(K, L4.personId, L4.dca, none))).toMatchObject({ key: "fee.scheme.nothing" });
    expect(await thrown(assignScheme(V, L4.personId, L4.dca, S))).toBeInstanceOf(Forbidden);
    expect((await rows("fee.concession.assign")).filter((x) => x.outcome === "DENIED")[0]).toMatchObject({ detail: { permission: "fee.concession" } });
    expect(await thrown(assignScheme(T.uA, L4.personId, L4.dca, S))).toBeInstanceOf(PersonError);
    expect(await thrown(assignScheme(K, L.personId, L4.dca, S))).toBeInstanceOf(PersonError); // another learner's registration
    expect(await msg(assignScheme(K, L4.personId, L4.dca, 0))).toBe("schemeId: inactive or unknown");
    expect(await sql(`select count(*)::int as n from app.fee_scheme_assignment where registration_id = $1`, [L4.dca])).toEqual([{ n: 0 }]);
    const ended = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "5" }]);
    await asAdmin(async (db) => { await db.query("set session_replication_role = replica"); await db.query(`update app.fee_scheme set valid_to = '2026-10-27' where id = $1`, [ended]); });
    expect(await thrown(assignScheme(K, L4.personId, L4.dca, ended))).toMatchObject({ key: "fee.scheme.notfor" }); // ended the day before admission
    await sql(`update app.registration set status = 'DROP' where id = $1`, [L4.dca]);
    expect(await thrown(assignScheme(K, L4.personId, L4.dca, S))).toMatchObject({ key: "fee.scheme.mismatch" });
    // an inactive centre (the session stays valid through the user's active centre A)
    await sql(`update app.centre set centre_class_id = 1 where id = $1`, [C.A2]);
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 36, 'CENTRE', $2), ($3, 29, 'CENTRE', $2)`, [SC.concede, C.A2, FD.a]);
    const atA2 = await learner(C.A2, ST_TOKEN.sr);
    await sql(`update app.centre set status = 'INACTIVE' where id = $1`, [C.A2]);
    expect(await msg(assignScheme(K, atA2.personId, atA2.dca, S))).toBe("centreId: centre is not active");
  });

  test("T-SC-003 the database proves it: transitions by name, parts, concessions, stamped amounts, immutability, RLS", async () => {
    const as = async (tok: string, steps: (c: pg.Client) => Promise<unknown>) => {
      await app.query("begin");
      try {
        await app.query("select set_config('app.session_id', $1, true)", [tok]);
        return { v: await steps(app), err: null };
      } catch (e) { return { v: null, err: e as { code: string; message: string } }; }
      finally { await app.query("rollback"); }
    };
    const q = (text: string, p: unknown[] = []) => (c: pg.Client) => c.query(text, p).then((r) => r.rows[0] ?? null);
    const d = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "10" }], { draft: true });
    // permissions by transition: an approver may not edit or create; a maker may not approve; a draft edit stamps the editor
    expect((await as(A, q(`update app.fee_scheme set name = 'x' where id = $1`, [d]))).err).toMatchObject({ code: "42501" });
    expect((await as(A, q(`insert into app.fee_scheme (code, name, valid_from, valid_to) values ('RAW', 'Raw', '2026-01-01', '2026-12-31')`))).err).toMatchObject({ code: "42501" });
    expect((await as(M, q(`update app.fee_scheme set status = 'LIVE' where id = $1`, [d]))).err).toMatchObject({ code: "42501" });
    expect((await as(A, q(`insert into app.fee_scheme_rule (scheme_id, fee_type_id, kind, value) values ($1, $2, 'PERCENT', 5)`, [d, seed.course]))).err).toMatchObject({ code: "42501" });
    expect((await as(M, q(`update app.fee_scheme set status = 'DRAFT', code = 'NEWCODE' where id = $1`, [d]))).err).toMatchObject({ code: "42501" }); // code is not granted
    expect((await as(M, q(`update app.fee_scheme set retired_reason = 'x' where id = $1`, [d]))).err?.message).toContain("fee_scheme_guard");
    // approval changes nothing else; needs a fresh step-up; not by the maker or last editor
    expect((await as(A, q(`update app.fee_scheme set status = 'LIVE', name = 'Other' where id = $1`, [d]))).err?.message).toContain("fee_scheme_guard");
    await setStepUp(A, 1000);
    expect((await as(A, q(`update app.fee_scheme set status = 'LIVE' where id = $1`, [d]))).err?.message).toContain("fee_scheme_stepup_guard");
    await setStepUp(A, 0);
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind) values ($1, 34, 'ALL')`, [SC.checker]);
    // a part edit stamps its editor through fee_scheme_guard (Z8-1), who then cannot approve
    expect((await as(A, async (c) => { await c.query(`insert into app.fee_scheme_course (scheme_id, course_id) values ($1, $2)`, [d, TALLY]);
      return [(await c.query(`select updated_by::text as by from app.fee_scheme where id = $1`, [d])).rows[0].by, await q(`update app.fee_scheme set status = 'LIVE' where id = $1`, [d])(c).catch((e: Error) => e.message)]; })).v)
      .toEqual([SC.checker, expect.stringContaining("fee_scheme_self_guard")]);
    expect((await as(A, q(`update app.fee_scheme set status = 'LIVE' where id = $1 returning approved_by::text as by`, [d]))).v).toEqual({ by: SC.checker });
    await sql(`delete from app.role_assignment where user_id = $1 and role_id = 34`, [SC.checker]);
    // a live scheme and its parts are frozen; retirement changes nothing else
    const { id: EXAM } = await fee.createFeeType(FEE_S, { code: "exam", name: "Exam Fee", categoryId: seed.catId, sortOrder: 20, hsnSac: "999293", gstRate: "18",
      accountId: (await sql(`select id from app.account where code = '3923'`))[0].id });
    const S = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "10" }, { feeTypeId: seed.course, kind: "AMOUNT", value: "100" }, { feeTypeId: EXAM, kind: "PERCENT", value: "10" }]);
    expect((await as(M, q(`update app.fee_scheme set status = 'RETIRED', retired_reason = 'r' where id = $1`, [S]))).err).toMatchObject({ code: "42501" });
    await setStepUp(A, 1000);
    expect((await as(A, q(`update app.fee_scheme set status = 'RETIRED', retired_reason = 'r' where id = $1`, [S]))).err?.message).toContain("fee_scheme_stepup_guard");
    await setStepUp(A, 0);
    expect((await as(M, q(`insert into app.fee_scheme_rule (scheme_id, fee_type_id, kind, value) values ($1, $2, 'PERCENT', 5)`, [S, seed.course]))).err?.message)
      .toContain("fee_scheme_part_guard");
    expect((await as(M, q(`delete from app.fee_scheme_course where scheme_id = $1`, [S]))).err?.message).toContain("fee_scheme_part_guard");
    expect((await as(M, q(`delete from app.fee_scheme where id = $1`, [S]))).err?.message).toContain("fee_scheme_guard");
    expect((await as(A, q(`update app.fee_scheme set status = 'DRAFT' where id = $1`, [S]))).err?.message).toContain("fee_scheme_guard");
    expect((await as(A, q(`update app.fee_scheme set status = 'RETIRED', retired_reason = 'r', name = 'x' where id = $1`, [S]))).err?.message).toContain("fee_scheme_guard");
    // concessions: only in the assignment's transaction, on a plan due of its registration, amount stamped
    const L = await learner(), L2 = await learner();
    await assignScheme(K, L.personId, L.dca, S);
    const [{ id: asg }] = await sql(`select id::text from app.fee_scheme_assignment where registration_id = $1`, [L.dca]);
    expect((await as(K, q(`insert into app.fee_concession (assignment_id, due_id, centre_id) values ($1, $2, 1)`, [asg, L.dues[1]]))).err?.message).toContain("fee_concession_guard");
    const fresh = (due: string) => as(K, async (c) => {
      const [{ id }] = (await c.query(`insert into app.fee_scheme_assignment (id, registration_id, centre_id, scheme_id)
        values (nextval('app.fee_scheme_assignment_id_seq'), $1, 1, $2) returning id::text`, [L2.dca, S])).rows;
      return (await c.query(`insert into app.fee_concession (assignment_id, due_id, centre_id) values ($1, $2, 1) returning amount::text`, [id, due])).rows[0];
    });
    expect((await fresh(L2.dues[0]!)).v).toEqual({ amount: "50.00" });
    expect((await fresh(L.dues[0]!)).err?.message).toContain("fee_concession_guard"); // another registration's due
    await collectFee(COL, L2.personId, { registrationId: L2.dca, amount: "0", mode: "CASH", idempotencyKey: crypto.randomUUID(),
      extras: [{ feeTypeId: EXAM, amount: "10" }] });
    const [adhoc] = await sql(`select id::text from app.fee_due where registration_id = $1 and source = 'ADHOC'`, [L2.dca]);
    expect((await fresh(adhoc.id)).err?.message).toContain("fee_concession_guard"); // not a plan due, though its type has a rule (an ad-hoc payment does not block)
    expect((await as(V, q(`insert into app.fee_scheme_assignment (id, registration_id, centre_id, scheme_id) values (nextval('app.fee_scheme_assignment_id_seq'), $1, 1, $2)`,
      [L2.dca, S]))).err).toMatchObject({ code: "42501" }); // a viewer
    expect((await as(K, q(`insert into app.fee_concession (assignment_id, due_id, centre_id, amount) values ($1, $2, 1, 1)`, [asg, L.dues[0]]))).err).toMatchObject({ code: "42501" });
    const owner = (steps: (c: pg.Client) => Promise<unknown>) => asAdmin(async (db) => {
      await db.query("begin");
      try { await db.query("select set_config('app.session_id', $1, true)", [K]); return await steps(db); }
      catch (e) { return (e as Error).message; } finally { await db.query("rollback"); }
    });
    expect(await owner(async (c) => {
      const [{ id }] = (await c.query(`insert into app.fee_scheme_assignment (id, registration_id, centre_id, scheme_id, created_by)
        values (nextval('app.fee_scheme_assignment_id_seq'), $1, 1, $2, '00000000-0000-0000-0000-00000000000a') returning id, created_by::text as by`, [L2.dca, S])).rows;
      const [x] = (await c.query(`insert into app.fee_concession (assignment_id, due_id, centre_id, amount) values ($1, $2, 1, 1) returning amount::text`, [id, L2.dues[3]])).rows;
      const [y] = (await c.query(`insert into app.fee_concession (assignment_id, due_id, centre_id, amount) values ($1, $2, 1, 1) returning amount::text`, [id, L2.dues[0]])).rows;
      return [(await c.query(`select created_by::text as by from app.fee_scheme_assignment where id = $1`, [id])).rows[0].by, x.amount, y.amount];
    })).toEqual([SC.concede, "100.00", "50.00"]); // who is the database's; the amount is stamped whatever is supplied
    const asMaker = (q2: string, p: unknown[]) => asAdmin(async (db) => {
      await db.query("begin");
      try { await db.query("select set_config('app.session_id', $1, true)", [M]); return (await db.query(q2, p)).rows[0]; } finally { await db.query("rollback"); }
    });
    expect(await asMaker(`insert into app.fee_scheme (code, name, valid_from, valid_to, created_by, updated_by) values ('OWN', 'Own', '2026-01-01', '2026-12-31', $1, $1)
      returning created_by::text as c, updated_by::text as u`, [SC.checker])).toEqual({ c: SC.maker, u: SC.maker });
    // an assignment that gives nothing is refused at commit
    await app.query("begin");
    await app.query("select set_config('app.session_id', $1, true)", [K]);
    await app.query(`insert into app.fee_scheme_assignment (id, registration_id, centre_id, scheme_id) values (nextval('app.fee_scheme_assignment_id_seq'), $1, 1, $2)`, [L2.dca, S]);
    expect(await app.query("commit").then(() => "", (e: Error) => e.message)).toContain("fee_scheme_given_guard");
    // kept for good, even by the owner; out of scope sees nothing
    for (const t of ["fee_concession", "fee_scheme_assignment"]) {
      for (const stmt of [`update app.${t} set centre_id = centre_id`, `delete from app.${t}`, `truncate app.${t} cascade`]) {
        const e = await asAdmin(async (db) => { await db.query("begin"); try { await db.query(stmt); return null; } catch (x) { return (x as Error).message; } finally { await db.query("rollback"); } });
        expect(e, stmt).toContain("is append-only");
      }
    }
    expect((await as(T.uA, q(`select (select count(*) from app.fee_concession)::int as c, (select count(*) from app.fee_scheme_assignment)::int as a`))).v).toEqual({ c: 0, a: 0 });
    expect((await as(K, q(`select count(*)::int as c from app.fee_concession`))).v).toEqual({ c: 3 });
  });

  test("T-SC-004 the concession register; the route", async () => {
    const S = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "25" }, { feeTypeId: seed.course, kind: "AMOUNT", value: "9000" }]);
    const other = await scheme([{ feeTypeId: seed.reg, kind: "PERCENT", value: "10" }]);
    const L = await learner(), L2 = await learner();
    await assignScheme(K, L.personId, L.dca, S);
    await assignScheme(K, L2.personId, L2.dca, other);
    expect(await concessionCentres(K)).toEqual([{ id: C.A, code: "KL2-25", name: "Centre A" }]);
    expect(await concessionCentres(V)).toEqual([]);
    const today = (await sql(`select (now() at time zone 'Asia/Kolkata')::date::text as d`))[0].d as string;
    const all = await concessionRegister(K, C.A, today, today);
    expect(all.total).toBe("9175.04");
    expect(all.rows.map((r) => [r.givenOn, r.personId, r.courseCode, r.schemeCode, r.feeTypeName, r.captionName, r.gross, r.amount])).toEqual([
      [today, L.personId, "DCA", `SCH${seq - 1}`, "Registration", "INSTALLMENT 1", "500.00", "125.00"],
      [today, L.personId, "DCA", `SCH${seq - 1}`, "Course Fee", "INSTALLMENT 1", "12000.50", "1000.00"],
      [today, L.personId, "DCA", `SCH${seq - 1}`, "Registration", "INSTALLMENT 2", "0.10", "0.03"],
      [today, L.personId, "DCA", `SCH${seq - 1}`, "Course Fee", "INSTALLMENT 2", "8000.00", "8000.00"],
      [today, L2.personId, "DCA", `SCH${seq}`, "Registration", "INSTALLMENT 1", "500.00", "50.00"],
      [today, L2.personId, "DCA", `SCH${seq}`, "Registration", "INSTALLMENT 2", "0.10", "0.01"]]);
    const filtered = await concessionRegister(K, C.A, today, today, other);
    expect([filtered.total, filtered.rows.map((r) => r.amount)]).toEqual(["50.01", ["50.00", "0.01"]]);
    expect(await concessionRegister(K, C.A, "2026-01-01", "2026-01-31")).toEqual({ rows: [], total: "0.00" });
    expect(await msg(concessionRegister(K, C.A, "2026-01-01", "2026-04-03"))).toBe("to: within 92 days of from");
    expect(await msg(concessionRegister(K, C.A, today, "x"))).toBe("to: a date");
    expect(await thrown(concessionRegister(K, C.B, today, today))).toBeInstanceOf(Forbidden);
    // the route
    const ORIGIN = "https://gems.test";
    const M2 = await learner();
    const post = (personId: string, body: Record<string, string>, origin = ORIGIN) => schemeRoute(new Request(`${ORIGIN}/students/${personId}/scheme`, {
      method: "POST", body: new URLSearchParams(body), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${K}`, origin } }),
      { params: Promise.resolve({ personId }) });
    const where = (x: Response) => { const u = new URL(x.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const P = `/students/${M2.personId}`;
    expect((await post(M2.personId, { registrationId: M2.dca, schemeId: String(S) }, "https://evil.example")).status).toBe(403);
    expect(where(await post(M2.personId, { registrationId: M2.dca, schemeId: String(S) }))).toBe(`${P}?saved=1`);
    expect(where(await post(M2.personId, { registrationId: M2.dca, schemeId: String(S) }))).toBe(`${P}?error=fee.scheme.exists`);
    expect((await post(M2.personId, { registrationId: L.dca, schemeId: String(S) })).status).toBe(404);
    expect((await post("x", { registrationId: M2.dca, schemeId: String(S) })).status).toBe(404);
  });
});
