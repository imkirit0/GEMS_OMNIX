// Fee masters and fee structure: T-FS-001…003 (audit 09; docs/designs/fee-structure/fee-structure.md). Pages are a
// real-server smoke check.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as typeRoute } from "../app/admin/fees/types/save/route";
import { POST as planSaveRoute } from "../app/admin/fees/plans/[id]/save/route";
import { POST as planCreateRoute } from "../app/admin/fees/plans/create/route";
import { auth, SESSION_COOKIE } from "../src/server/auth/http";
import { Forbidden } from "../src/server/action";
import { withScope } from "../src/server/db";
import * as cat from "../src/server/catalogue";
import * as fee from "../src/server/fees";
import { asAdmin, C, reset, rows, setStepUp, T } from "./fixtures";
import { CCNA, DCA, masters, METRO, placeCentre, TALLY } from "./fee-seed";

const S = "tok-feeS";
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const sqlErr = (q: string, p: unknown[] = []) => asAdmin(async (db) => {
  await db.query("begin");
  try { await db.query(q, p); return null; } catch (e) { return e as { code: string; constraint?: string; message: string }; } finally { await db.query("rollback"); }
});
const audit = async (action: string) => (await rows(action)).filter((r) => r.outcome === "OK");

let app: pg.Client;
const as = async (tok: string, q: string, p: unknown[] = []) => {
  await app.query("begin");
  await app.query("select set_config('app.session_id', $1, true)", [tok]);
  try { return await app.query(q, p); } finally { await app.query("rollback"); }
};
const asErr = (tok: string, q: string, p: unknown[] = []) => as(tok, q, p).then(() => null, (e: { code: string }) => e.code);
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(async () => {
  await reset(); await setStepUp(S, 0);
  await placeCentre();
});

describe("T-FS fee masters and structure", () => {
  test("T-FS-001 fee masters: categories, types, instalments; messages, checks, audit, who may", async () => {
    const m = await masters();
    expect((await audit("catalogue.create"))[0]).toMatchObject({ target_type: "fee_category", after: { code: "COURSE FEE" } });
    expect((await audit("fee.type.create"))[0]).toMatchObject({ target_type: "fee_type", after: { code: "CF", gstRate: "18", hsnSac: "999293", sortOrder: 10 } });
    const types = await fee.listFeeTypes(T.uA);
    expect(types.rows.map((t) => [t.code, t.gstRate])).toEqual([["REG", "18"], ["CF", "18"]]); // by fee order
    expect(types.canManage).toBe(false);
    // messages in order
    const bad: [Record<string, unknown>, string][] = [
      [{ code: "", name: "" }, "code: required"], [{ code: "X", name: " ", categoryId: 0 }, "name: 1-200 characters"],
      [{ code: "X", name: "N", categoryId: 0 }, "categoryId: inactive or unknown"], [{ code: "X", name: "N", categoryId: m.catId, sortOrder: 10000 }, "sortOrder: 0-9999"],
      [{ code: "X", name: "N", categoryId: m.catId, sortOrder: 1, hsnSac: "12a" }, "hsnSac: 4-8 digits"],
      [{ code: "X", name: "N", categoryId: m.catId, sortOrder: 1, hsnSac: "9992", gstRate: "x" }, "gstRate: a percentage"],
      [{ code: "X", name: "N", categoryId: m.catId, sortOrder: 1, hsnSac: "9992", gstRate: "12" }, "gstRate: one of 0, 5, 18, 40"],
    ];
    for (const [t, want] of bad) expect(await msg(fee.createFeeType(S, t as never)), JSON.stringify(t)).toBe(want);
    expect(await thrown(fee.createFeeType(S, { code: "CF", name: "x", categoryId: m.catId, sortOrder: 1, hsnSac: "9992", gstRate: "5" }))).toMatchObject({ key: "fee.duplicate" });
    const { id: oldCat } = await cat.createMaster(S, "fee_category", { code: "OLD", name: "Old" });
    await cat.setMasterActive(S, "fee_category", oldCat, false, "unused");
    expect(await msg(fee.createFeeType(S, { code: "X", name: "N", categoryId: oldCat, sortOrder: 1, hsnSac: "9992", gstRate: "5" }))).toBe("categoryId: inactive or unknown");
    // update: changed fields audited; nothing to change; the rate normalised
    await fee.updateFeeType(S, m.course, { gstRate: "5.0", sortOrder: 11 });
    expect((await audit("fee.type.update"))[0]).toMatchObject({ before: { gstRate: "18", sortOrder: 10 }, after: { gstRate: "5", sortOrder: 11 } });
    expect(await msg(fee.updateFeeType(S, m.course, { gstRate: "5" }))).toBe("nothing to change");
    expect(await msg(fee.setFeeTypeActive(S, m.course, false, " "))).toBe("reason: required");
    await fee.setFeeTypeActive(S, m.course, false, "retired");
    expect(await msg(fee.setFeeTypeActive(S, m.course, false, "again"))).toBe("already inactive");
    await fee.setFeeTypeActive(S, m.course, true, "back");
    expect((await audit("fee.type.activate"))).toHaveLength(1);
    expect((await audit("fee.type.deactivate"))[0]).toMatchObject({ reason: "retired", before: { active: true }, after: { active: false } });
    expect((await audit("fee.caption.create"))[0]).toMatchObject({ target_type: "fee_caption", after: { academicYear: "2026-27", name: "INSTALLMENT 1", dueOn: "2026-11-30" } });
    // instalments: due date within the year; unique name per year
    expect(await msg(fee.createCaption(S, { academicYear: "2026-27", name: "LATE", dueOn: "2027-06-01", sortOrder: 3 }))).toBe("dueOn: within 2026-06-01 to 2027-05-31");
    expect(await msg(fee.createCaption(S, { academicYear: "2026-27", name: "X", dueOn: "2026-02-30", sortOrder: 3 }))).toMatch(/^dueOn: /);
    expect(await thrown(fee.createCaption(S, { academicYear: "2026-27", name: "INSTALLMENT 1", dueOn: "2026-12-01", sortOrder: 3 }))).toMatchObject({ key: "fee.duplicate" });
    await fee.updateCaption(S, m.i2, { dueOn: "2027-02-28" });
    expect((await audit("fee.caption.update"))[0]).toMatchObject({ before: { dueOn: "2027-01-31" }, after: { dueOn: "2027-02-28" } });
    await fee.setCaptionActive(S, m.i2, false, "merged");
    expect((await audit("fee.caption.deactivate"))[0]).toMatchObject({ reason: "merged", after: { active: false } });
    expect((await fee.listCaptions(T.uA, "2026-27")).rows.map((c) => [c.name, c.active])).toEqual([["INSTALLMENT 1", true], ["INSTALLMENT 2", false]]);
    await fee.setCaptionActive(S, m.i2, true, "split again");
    expect((await audit("fee.caption.activate"))[0]).toMatchObject({ reason: "split again", after: { active: true } });
    // who may: fee.setup only, also by SQL; the permission is sensitive
    for (const p of [() => fee.createFeeType(T.uA, { code: "Z", name: "Z", categoryId: m.catId, sortOrder: 1, hsnSac: "9992", gstRate: "0" }),
      () => fee.createCaption(T.hoAll, { academicYear: "2026-27", name: "Z", dueOn: "2026-12-01", sortOrder: 1 }),
      () => cat.createMaster(T.uA, "fee_category", { code: "Z", name: "Z" })]) {
      expect(await thrown(p())).toBeInstanceOf(Forbidden);
    }
    expect(await asErr(T.uA, `insert into app.fee_type (code, name, category_id, sort_order, hsn_sac, gst_rate) values ('Z', 'Z', $1, 1, '9992', 0)`, [m.catId])).toBe("42501");
    expect((await as(T.uA, `update app.fee_caption set name = 'x'`)).rowCount).toBe(0);
    expect(await sql(`select sensitive from app.permission where key = 'fee.setup'`)).toEqual([{ sensitive: true }]);
    // named checks refuse the same values to the owner
    for (const [q, c] of [[`insert into app.fee_type (code, name, category_id, sort_order, hsn_sac, gst_rate) values ('q', 'Q', ${m.catId}, 1, '9992', 0)`, "fee_type_code_check"],
      [`insert into app.fee_type (code, name, category_id, sort_order, hsn_sac, gst_rate) values ('Q', ' Q', ${m.catId}, 1, '9992', 0)`, "fee_type_name_check"],
      [`insert into app.fee_type (code, name, category_id, sort_order, hsn_sac, gst_rate) values ('Q', 'Q', ${m.catId}, 1, '99a2', 0)`, "fee_type_hsn_sac_check"],
      [`insert into app.fee_type (code, name, category_id, sort_order, hsn_sac, gst_rate) values ('Q', 'Q', ${m.catId}, 1, '9992', 101)`, "fee_type_gst_rate_check"],
      [`insert into app.fee_type (code, name, category_id, sort_order, hsn_sac, gst_rate) values ('Q', 'Q', ${m.catId}, 10000, '9992', 0)`, "fee_type_sort_order_check"],
      [`insert into app.fee_category (code, name) values ('lower', 'x')`, "fee_category_code_check"],
      [`insert into app.fee_category (code, name) values ('UP', '')`, "fee_category_name_check"],
      [`insert into app.fee_caption (academic_year, name, due_on, sort_order) values ('2026-27', ' x', '2026-12-01', 1)`, "fee_caption_name_check"],
      [`insert into app.fee_caption (academic_year, name, due_on, sort_order) values ('2026-27', 'x', '2026-12-01', -1)`, "fee_caption_sort_order_check"]] as const) {
      expect(await sqlErr(q), c).toMatchObject({ code: "23514", constraint: c });
    }
  });

  test("T-FS-002 fee plans: versions, immutability, races, offering, resolution, exact money", async () => {
    const m = await masters();
    // create: the offering rule, a closed year, one draft per key
    expect(await thrown(fee.createPlan(S, { academicYear: "2026-27", courseId: CCNA, centreClassId: METRO }))).toMatchObject({ key: "fee.plan.offering" });
    expect(await thrown(fee.createPlan(S, { academicYear: "2026-27", courseId: CCNA, centreId: C.A }))).toMatchObject({ key: "fee.plan.offering" });
    expect(await msg(fee.createPlan(S, { academicYear: "2026-27", courseId: DCA }))).toBe("centreClassId: a class or a centre, not both");
    await sql(`update app.academic_year set open = false where code = '2025-26'`);
    expect(await msg(fee.createPlan(S, { academicYear: "2025-26", courseId: DCA, centreClassId: METRO }))).toBe("academicYear: closed");
    const { id: p1, version: v1 } = await fee.createPlan(S, { academicYear: "2026-27", courseId: DCA, centreClassId: METRO });
    expect(v1).toBe(1);
    expect((await audit("fee.plan.create"))[0]).toMatchObject({ target_type: "fee_plan", target_id: String(p1),
      after: { key: `fee-plan:2026-27:${DCA}:K${METRO}C`, version: 1, currency: "INR", copiedLines: 0 } });
    expect(await thrown(fee.createPlan(S, { academicYear: "2026-27", courseId: DCA, centreClassId: METRO }))).toMatchObject({ key: "fee.duplicate" });
    const { id: ccnaB } = await fee.createPlan(S, { academicYear: "2026-27", courseId: CCNA, centreId: C.B }); // a named centre: override only
    // lines: exact money; another year's instalment refused; inactive types refused
    await fee.setPlanLine(S, p1, { feeTypeId: m.reg, captionId: m.i1, amount: "0.10" });
    await fee.setPlanLine(S, p1, { feeTypeId: m.course, captionId: m.i1, amount: "0.20" });
    await fee.setPlanLine(S, p1, { feeTypeId: m.course, captionId: m.i2, amount: "12500" });
    expect((await audit("fee.plan.line"))[0]).toMatchObject({ target_id: String(p1), before: { amount: null }, after: { feeTypeId: m.reg, captionId: m.i1, amount: "0.10" } });
    const plan = await fee.getPlan(S, p1);
    expect(plan.byCaption.find((c) => c.captionId === m.i1)!.total).toBe("0.30");
    expect(plan.plan.total).toBe("12500.30");
    expect(plan.lines.map((l) => l.amount)).toEqual(["0.10", "0.20", "12500.00"]);
    expect(await msg(fee.setPlanLine(S, p1, { feeTypeId: m.course, captionId: m.i2, amount: "12500.00" }))).toBe("nothing to change");
    expect(await msg(fee.setPlanLine(S, p1, { feeTypeId: m.course, captionId: m.i2, amount: "1.234" }))).toBe("amount: up to 12 digits and 2 decimals");
    const { id: other } = await fee.createCaption(S, { academicYear: "2027-28", name: "NEXT", dueOn: "2027-08-01", sortOrder: 1 });
    expect(await msg(fee.setPlanLine(S, p1, { feeTypeId: m.course, captionId: other, amount: "1" }))).toBe("captionId: inactive, unknown or another year");
    expect(await sqlErr(`insert into app.fee_plan_line (plan_id, academic_year, fee_type_id, caption_id, amount) values ($1, '2026-27', $2, $3, 1)`, [p1, m.course, other]))
      .toMatchObject({ code: "23503" }); // the composite key
    // while only a draft uses an instalment, its due date may still change
    await fee.updateCaption(S, m.i2, { dueOn: "2027-01-30" });
    // publish: empty refused; inactive refused; audited; then immutable
    expect(await thrown(fee.publishPlan(S, ccnaB, "go"))).toMatchObject({ key: "fee.plan.empty" });
    await fee.setFeeTypeActive(S, m.reg, false, "x");
    expect(await thrown(fee.publishPlan(S, p1, "go"))).toMatchObject({ key: "fee.plan.inactive" });
    expect(await msg(fee.setPlanLine(S, p1, { feeTypeId: m.reg, captionId: m.i2, amount: "1" }))).toBe("feeTypeId: inactive or unknown");
    await fee.setFeeTypeActive(S, m.reg, true, "x");
    expect(await msg(fee.publishPlan(S, p1, " "))).toBe("reason: required");
    await fee.publishPlan(S, p1, "approved by accounts");
    expect((await audit("fee.plan.publish"))[0]).toMatchObject({ target_id: String(p1), reason: "approved by accounts",
      after: { status: "PUBLISHED", version: 1, lines: 3, total: "12500.30" } });
    expect(await sql(`select status, published_by::text by from app.fee_plan where id = $1`, [p1])).toEqual([{ status: "PUBLISHED", by: "00000000-0000-0000-0000-0000000000f6" }]);
    expect(await thrown(fee.setPlanLine(S, p1, { feeTypeId: m.reg, captionId: m.i1, amount: "1" }))).toMatchObject({ key: "fee.plan.locked" });
    expect(await thrown(fee.deletePlan(S, p1))).toMatchObject({ key: "fee.plan.locked" });
    // ... also by SQL as the owner, and the due date it uses is frozen
    for (const q of [`update app.fee_plan_line set amount = 1 where plan_id = ${p1}`, `delete from app.fee_plan_line where plan_id = ${p1}`,
      `insert into app.fee_plan_line (plan_id, academic_year, fee_type_id, caption_id, amount) values (${p1}, '2026-27', ${m.reg}, ${m.i2}, 1)`]) {
      expect(await sqlErr(q), q).toMatchObject({ code: "23514", constraint: "fee_plan_line_guard" });
    }
    for (const q of [`update app.fee_plan set version = 9 where id = ${p1}`, `delete from app.fee_plan where id = ${p1}`, `update app.fee_plan set status = 'DRAFT' where id = ${p1}`]) {
      expect(await sqlErr(q), q).toMatchObject({ code: "23514", constraint: "fee_plan_guard" });
    }
    expect(await thrown(fee.updateCaption(S, m.i1, { dueOn: "2026-12-15" }))).toMatchObject({ key: "fee.caption.locked" });
    await fee.updateCaption(S, m.i1, { name: "INSTALMENT 1" }); // the name may change
    // a new version copies the current one; one draft per key also by SQL; publishing makes it current
    const { id: p2, version: v2 } = await fee.createPlan(S, { academicYear: "2026-27", courseId: DCA, centreClassId: METRO });
    expect(v2).toBe(2);
    expect((await fee.getPlan(S, p2)).lines.map((l) => l.amount)).toEqual(["0.10", "0.20", "12500.00"]);
    expect(await sqlErr(`insert into app.fee_plan (academic_year, course_id, centre_class_id, version) values ('2026-27', ${DCA}, ${METRO}, 3)`))
      .toMatchObject({ code: "23514", constraint: "fee_plan_draft_guard" });
    // resolution: class plan v1 now; v2 when published; a centre override wins; a draft never resolves
    const resolve = (centre: number, course: number) => withScope(S, (tx) => fee.resolvePlan(tx, centre, course, "2026-27"));
    expect(await resolve(C.A, DCA)).toEqual({ planId: p1, currency: "INR" });
    await fee.setPlanLine(S, p2, { feeTypeId: m.course, captionId: m.i2, amount: "13000" });
    await fee.publishPlan(S, p2, "new price");
    expect(await resolve(C.A, DCA)).toEqual({ planId: p2, currency: "INR" });
    expect(await resolve(C.B, CCNA)).toBeNull(); // only a draft
    await fee.setPlanLine(S, ccnaB, { feeTypeId: m.course, captionId: m.i1, amount: "9999.99" });
    await fee.publishPlan(S, ccnaB, "named centre");
    expect(await resolve(C.B, CCNA)).toEqual({ planId: ccnaB, currency: "INR" });
    const { id: ov } = await fee.createPlan(S, { academicYear: "2026-27", courseId: DCA, centreId: C.A });
    await fee.setPlanLine(S, ov, { feeTypeId: m.course, captionId: m.i1, amount: "100" });
    expect(await resolve(C.A, DCA)).toEqual({ planId: p2, currency: "INR" }); // the override is still a draft
    await fee.publishPlan(S, ov, "local price");
    expect(await resolve(C.A, DCA)).toEqual({ planId: ov, currency: "INR" });
    expect(await resolve(C.A2, DCA)).toBeNull(); // no class, no override
    // a draft can be deleted (lines first); a class plan is INR (check)
    const { id: d } = await fee.createPlan(S, { academicYear: "2026-27", courseId: TALLY, centreClassId: METRO });
    await fee.setPlanLine(S, d, { feeTypeId: m.course, captionId: m.i1, amount: "5" });
    await fee.deletePlan(S, d);
    expect((await audit("fee.plan.delete"))[0]).toMatchObject({ target_id: String(d), before: { version: 1, lines: 1 } });
    expect(await sql(`select count(*)::int n from app.fee_plan where id = $1`, [d])).toEqual([{ n: 0 }]);
    expect(await sqlErr(`insert into app.fee_plan (academic_year, course_id, centre_class_id, version, currency) values ('2026-27', ${TALLY}, ${METRO}, 1, 'USD')`))
      .toMatchObject({ code: "23514", constraint: "fee_plan_class_currency_check" });
    for (const [q, c] of [[`insert into app.fee_plan (academic_year, course_id, version) values ('2026-27', ${TALLY}, 1)`, "fee_plan_key_check"],
      [`insert into app.fee_plan (academic_year, course_id, centre_id, version, currency) values ('2026-27', ${TALLY}, 1, 1, 'us')`, "fee_plan_currency_check"]] as const) {
      expect(await sqlErr(q), c).toMatchObject({ code: "23514", constraint: c });
    }

    // races (D1, I2): A publishes while B adds a line, changes a used due date, or deactivates a used type
    const { id: r1 } = await fee.createPlan(S, { academicYear: "2026-27", courseId: TALLY, centreClassId: METRO });
    await fee.setPlanLine(S, r1, { feeTypeId: m.course, captionId: m.i2, amount: "7" });
    const b = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] });
    await b.connect();
    try {
      for (const c of [app, b]) { await c.query("begin"); await c.query("select set_config('app.session_id', $1, true)", [S]); }
      await app.query(`update app.fee_plan set status = 'PUBLISHED' where id = $1`, [r1]); // A holds the plan
      const line = b.query(`insert into app.fee_plan_line (plan_id, academic_year, fee_type_id, caption_id, amount) values ($1, '2026-27', $2, $3, 1)`, [r1, m.reg, m.i2])
        .then(() => "ok", (e: { message: string }) => /constraint "([^"]+)"/.exec(e.message)?.[1]);
      await new Promise((r) => setTimeout(r, 300));
      await app.query("commit");
      expect(await line).toBe("fee_plan_line_guard");
    } finally { await b.query("rollback").catch(() => null); await b.end(); }
    expect((await fee.getPlan(S, r1)).lines).toHaveLength(1);
  });

  test("T-FS-003 readers and routes: drafts hidden; step-up, origin, field details", async () => {
    const m = await masters();
    const { id: draft } = await fee.createPlan(S, { academicYear: "2026-27", courseId: DCA, centreClassId: METRO });
    await fee.setPlanLine(S, draft, { feeTypeId: m.course, captionId: m.i1, amount: "100" });
    expect((await fee.listPlans(T.uA)).rows).toEqual([]);
    expect(await thrown(fee.getPlan(T.uA, draft))).toMatchObject({ reason: "notfound" });
    expect((await as(T.uA, `select count(*)::int n from app.fee_plan_line`)).rows).toEqual([{ n: 0 }]);
    await fee.publishPlan(S, draft, "go");
    expect((await fee.listPlans(T.uA)).rows.map((r) => [r.version, r.status, r.total])).toEqual([[1, "PUBLISHED", "100.00"]]);
    // routes
    const ORIGIN = "https://gems.test";
    const post = (path: string, body: Record<string, string>, origin = ORIGIN) => new Request(`${ORIGIN}${path}`, {
      method: "POST", body: new URLSearchParams(body), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${S}`, origin } });
    const where = (r: Response) => { const u = new URL(r.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const T1 = "/admin/fees/types";
    const type = { op: "create", code: "exam", name: "Exam Fee", categoryId: String(m.catId), sortOrder: "20", hsnSac: "999293", gstRate: "18" };
    expect(where(await typeRoute(post(`${T1}/save`, type)))).toBe(`${T1}?saved=1`);
    expect(where(await typeRoute(post(`${T1}/save`, type)))).toBe(`${T1}?error=fee.duplicate`);
    expect(where(await typeRoute(post(`${T1}/save`, { ...type, code: "x2", gstRate: "12" })))).toBe(`${T1}?error=invalid&detail=gstRate`);
    expect(where(await typeRoute(post(`${T1}/save`, { op: "nope" })))).toBe(`${T1}?error=invalid&detail=op`);
    expect((await typeRoute(post(`${T1}/save`, type, "https://evil.example"))).status).toBe(403);
    const created = await planCreateRoute(post("/admin/fees/plans/create", { academicYear: "2026-27", courseId: String(TALLY), centreClassId: String(METRO) }));
    expect(where(created)).toMatch(/^\/admin\/fees\/plans\/\d+\?saved=1$/);
    const pid = where(created).match(/plans\/(\d+)/)![1]!;
    const save = (b: Record<string, string>) => planSaveRoute(post(`/admin/fees/plans/${pid}/save`, b), { params: Promise.resolve({ id: pid }) });
    const P = `/admin/fees/plans/${pid}`;
    expect(where(await save({ op: "line", feeTypeId: String(m.course), captionId: String(m.i1), amount: "1,000" }))).toBe(`${P}?error=invalid&detail=amount`);
    expect(where(await save({ op: "line", feeTypeId: String(m.course), captionId: String(m.i1), amount: "1000" }))).toBe(`${P}?saved=1`);
    expect(where(await save({ op: "line", feeTypeId: String(m.course), captionId: String(m.i1), amount: "" }))).toBe(`${P}?saved=1`); // "" removes
    expect(where(await save({ op: "publish", reason: "go" }))).toBe(`${P}?error=fee.plan.empty`);
    expect((await planSaveRoute(post(`/admin/fees/plans/x/save`, { op: "line" }), { params: Promise.resolve({ id: "x" }) })).status).toBe(404);
    await setStepUp(S, 3600);
    expect(where(await save({ op: "delete" }))).toBe(`/stepup?next=${encodeURIComponent(P)}`);
  });
});
