// Centre onboarding: T-CO-001…003 (audit 09; docs/designs/centre-onboarding/centre-onboarding.md). T-CO-004 (routes) is
// tests/centre-routes.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { Forbidden } from "../src/server/action";
import { auth } from "../src/server/auth/http";
import * as co from "../src/server/centres";
import * as enq from "../src/server/enquiry";
import { AdmissionExists, admit, admitOptions, getPerson, type AdmitInput } from "../src/server/people";
import { asAdmin, C, CO, EQ_ROLE, newSession, reset, rows, setStepUp, ST, ST_TOKEN, T } from "./fixtures";

const M = "tok-coM", R1 = "tok-coR1", CAT = "tok-catA";
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const msg = async (p: Promise<unknown>) => ((await thrown(p)) as Error).message;
const sql = (q: string, p: unknown[] = []) => asAdmin((db) => db.query(q, p).then((r) => r.rows));
const sqlErr = (q: string, p: unknown[] = []) => asAdmin(async (db) => {
  await db.query("begin");
  try { await db.query(q, p); return null; } catch (e) { return e as { code: string; constraint?: string }; } finally { await db.query("rollback"); }
});
const audit = async (action: string) => (await rows(action)).filter((r) => r.outcome === "OK");
const FULL: co.CentreInput = { code: "kl9-01", name: " New centre ", areaId: 1, email: " office@example.in ", phone: "0484 2300000",
  address: " Line 1\nLine 2 ", category: "SCHOOL", gstEnabled: true, gstSupply: "STATE", gstin: "32abcde1234f1z5", ownership: "FRANCHISE",
  agreementFrom: "2026-11-01", agreementTo: "2029-10-31", openedOn: "2026-11-15" };
const MIN: co.CentreInput = { code: "KL9-02", name: "Plain", areaId: 1, phone: "9800000000", gstEnabled: false };

let app: pg.Client; // gems_app with a session, as withScope connects
const as = async (tok: string, q: string, p: unknown[] = []) => {
  await app.query("begin");
  await app.query("select set_config('app.session_id', $1, true)", [tok]);
  try { return await app.query(q, p); } finally { await app.query("rollback"); }
};
const asErr = (tok: string, q: string) => as(tok, q).then(() => null, (e: { code: string }) => e.code);
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(async () => { await app.end(); await auth().close(); });
beforeEach(async () => { await reset(); await setStepUp(M, 0); await setStepUp(R1, 0); });

describe("T-CO centre onboarding", () => {
  test("T-CO-001 creating and editing centres: fields, messages in order, checks, audit, who may", async () => {
    expect(await co.createCentre(M, FULL)).toEqual({ id: 4, code: "KL9-01" });
    const after = { code: "KL9-01", name: "New centre", areaId: 1, email: "office@example.in", phone: "4842300000", address: "Line 1\nLine 2",
      category: "SCHOOL", gstEnabled: true, gstSupply: "STATE", gstin: "32ABCDE1234F1Z5", ownership: "FRANCHISE", agreementFrom: "2026-11-01",
      agreementTo: "2029-10-31", openedOn: "2026-11-15", status: "INACTIVE" };
    expect((await audit("org.centre.create"))[0]).toMatchObject({ target_type: "centre", target_id: "4", after });
    const { status: _s, ...stored } = after;
    expect(await co.getCentre(M, 4)).toMatchObject({ ...stored, status: "INACTIVE", region: "R1", classCode: null, canManage: true });

    // each message, in the order of the design (C6); validation before the database
    const bad: [Partial<co.CentreInput>, string][] = [
      [{ code: "", name: "" }, "code: required"], [{ name: " ", areaId: 0 }, "name: 1-200 characters"],
      [{ areaId: 0, email: "x" }, "areaId: unknown"], [{ email: "a@b@c", phone: "1" }, "email: one @"],
      [{ email: `${"a".repeat(200)}@b` }, "email: at most 200"], [{ phone: "12345", address: "a\u0001" }, "phone: 10 digits"],
      [{ address: "a\u0001", category: "X" as never }, "address: invalid characters"],
      [{ category: "X" as never, gstSupply: "X" as never }, "category: one of the listed values"],
      [{ gstSupply: "X" as never, gstin: "X" }, "gstSupply: one of the listed values"], [{ gstin: "32ABCDE1234F1Z", ownership: "X" as never }, "gstin: 15 characters, GSTIN format"],
      [{ ownership: "X" as never, agreementFrom: "1/1/2026" }, "ownership: one of the listed values"],
      [{ agreementFrom: "2026-02-30", agreementTo: "x" }, "agreementFrom: not a date"], [{ agreementTo: "x", openedOn: "x" }, "agreementTo: YYYY-MM-DD"],
      [{ openedOn: "x" }, "openedOn: YYYY-MM-DD"], [{ gstEnabled: "1" as never }, "gstEnabled: invalid"],
      [{ phone: "" }, "phone: required"], [{ phone: undefined as never }, "phone: required"],
      [{ gstEnabled: false, gstSupply: "STATE", gstin: "32ABCDE1234F1Z5" }, "gstSupply: only with GST"],
      [{ gstEnabled: false, gstin: "32ABCDE1234F1Z5" }, "gstin: only with GST"],
      [{ agreementFrom: "2026-11-01", agreementTo: "2026-10-31" }, "agreementTo: not before agreementFrom"],
    ];
    for (const [o, m] of bad) expect(await msg(co.createCentre(M, { ...MIN, code: "KL9-03", ...o })), JSON.stringify(o)).toBe(m);
    expect(await msg(co.createCentre(M, { ...MIN, areaId: 99 }))).toBe("areaId: unknown"); // existence, in the transaction
    expect(await thrown(co.createCentre(M, { ...MIN, code: "kl9-01" }))).toMatchObject({ key: "org.centre.duplicate" });
    expect(await sql(`select count(*)::int n from app.centre`)).toEqual([{ n: 4 }]);

    // update: merged GST rules; absent keeps; null clears; a set phone stays; nothing to change; an area move
    expect(await msg(co.updateCentre(M, 4, { gstEnabled: false }))).toBe("gstSupply: only with GST");
    await co.updateCentre(M, 4, { gstEnabled: false, gstSupply: null, gstin: null, email: null, name: "Renamed" });
    expect((await audit("org.centre.update"))[0]).toMatchObject({ target_id: "4",
      before: { name: "New centre", email: "office@example.in", gstEnabled: true, gstSupply: "STATE", gstin: "32ABCDE1234F1Z5" },
      after: { name: "Renamed", email: null, gstEnabled: false, gstSupply: null, gstin: null } });
    expect(Object.keys((await audit("org.centre.update"))[0].after).sort()).toEqual(["email", "gstEnabled", "gstSupply", "gstin", "name"]);
    expect(await msg(co.updateCentre(M, 4, { phone: null }))).toBe("phone: required");
    expect(await msg(co.updateCentre(M, 4, { phone: "" }))).toBe("phone: required");
    expect(await msg(co.updateCentre(M, 4, { name: " Renamed ", phone: "+91 48423 00000", agreementFrom: "2026-11-01" }))).toBe("nothing to change");
    expect(await msg(co.updateCentre(M, 4, {}))).toBe("nothing to change");
    expect(await msg(co.updateCentre(M, 4, { agreementTo: "2026-01-01" }))).toBe("agreementTo: not before agreementFrom");
    expect(await msg(co.updateCentre(M, 4, { areaId: 99 }))).toBe("areaId: unknown");
    await co.updateCentre(M, 4, { areaId: 3 });
    expect((await audit("org.centre.update"))[1]).toMatchObject({ before: { areaId: 1 }, after: { areaId: 3 } });
    expect((await co.getCentre(M, 4))!.region).toBe("R2");
    expect(await thrown(co.updateCentre(M, 99, { name: "x" }))).toMatchObject({ reason: "notfound" });
    // a legacy centre without a phone may stay without one
    await co.updateCentre(M, C.A, { name: "Centre A renamed" });
    expect(await sql(`select phone from app.centre where id = 1`)).toEqual([{ phone: null }]);

    // who may: org.centre.manage at ALL scope only (R1 holds it for region 1), fresh step-up
    for (const tok of [R1, T.hoAll, CAT]) {
      expect(await thrown(co.createCentre(tok, { ...MIN, code: "KL9-09" })), tok).toBeInstanceOf(Forbidden);
      expect(await thrown(co.updateCentre(tok, C.A, { name: "x" })), tok).toBeInstanceOf(Forbidden);
    }
    expect((await rows("org.centre.create")).filter((r) => r.outcome === "DENIED")).toHaveLength(3);
    await setStepUp(M, 3600);
    expect(await thrown(co.createCentre(M, { ...MIN, code: "KL9-09" }))).toMatchObject({ name: "StepUpRequired" });
    await setStepUp(M, 0);

    // the database: RLS for non-holders; centre_write_guard keeps each permission to its own columns (D3)
    expect(await asErr(R1, `insert into app.centre (id, code, name, area_id) values (50, 'X', 'x', 1)`)).toBe("42501");
    expect((await as(T.hoAll, `update app.centre set name = 'x'`)).rowCount).toBe(0);
    expect(await asErr(CAT, `update app.centre set status = 'INACTIVE' where id = 1`)).toBe("42501");
    expect(await asErr(CAT, `update app.centre set name = 'x' where id = 1`)).toBe("42501");
    expect(await asErr(M, `update app.centre set centre_class_id = 1 where id = 1`)).toBe("42501");
    expect((await as(CAT, `update app.centre set centre_class_id = 1 where id = 1`)).rowCount).toBe(1);
    expect(await asErr(M, `update app.centre set code = 'X' where id = 1`)).toBe("42501"); // codes never change (grant)
    expect(await asErr(M, `delete from app.centre where id = 4`)).toBe("42501");
    expect(await asErr(M, `insert into app.centre (id, code, name, area_id, status) values (51, 'X', 'x', 1, 'ACTIVE')`)).toBe("42501");
    expect((await sql(`select column_name from information_schema.column_privileges where table_schema = 'app' and table_name = 'centre'
      and grantee = 'gems_app' and privilege_type = 'INSERT' order by column_name`)).map((r) => r.column_name)).toEqual(["address",
      "agreement_from", "agreement_to", "area_id", "category", "code", "email", "gst_enabled", "gst_supply", "gstin", "id", "name",
      "opened_on", "ownership", "phone"]); // never status or the class
    expect(await sql(`select sensitive from app.permission where key = 'org.centre.manage'`)).toEqual([{ sensitive: true }]);

    // readers: managers see every centre; others their scope only (null alike for 404 parity)
    expect((await co.listCentres(M)).map((c) => c.code)).toEqual(["KL2-25", "KL3-07", "KL9-01", "TN1-03"]);
    expect((await co.listCentres(T.uA)).map((c) => c.code)).toEqual(["KL2-25"]);
    expect(await co.getCentre(T.uA, 4)).toBeNull();
    expect(await co.getCentre(T.uA, C.A)).toMatchObject({ code: "KL2-25", canManage: false });
    expect(await co.getCentre(M, 999)).toBeNull();

    // every named check refuses the same values to the owner
    const checks: [string, string][] = [["code", "'kl9-x'"], ["email", "'a@b@c'"], ["phone", "'12345'"], ["category", "'X'"],
      ["gst_supply", "'X'"], ["gstin", "'X'"], ["ownership", "'X'"], ["address", "' x'"]];
    for (const [col, v] of checks) {
      const e = await sqlErr(`insert into app.centre (id, code, name, area_id, gst_enabled, ${col === "code" ? "email" : col}) values (60, ${col === "code" ? v : "'KL9-X'"}, 'x', 1, true, ${col === "code" ? "null" : v})`);
      expect(e, col).toMatchObject({ code: "23514", constraint: `centre_${col}_check` });
    }
    expect(await sqlErr(`insert into app.centre (id, code, name, area_id, gstin) values (60, 'KL9-X', 'x', 1, '32ABCDE1234F1Z5')`))
      .toMatchObject({ code: "23514", constraint: "centre_gst_check" });
    expect(await sqlErr(`insert into app.centre (id, code, name, area_id, agreement_from, agreement_to) values (60, 'KL9-X', 'x', 1, '2026-02-01', '2026-01-01')`))
      .toMatchObject({ code: "23514", constraint: "centre_agreement_check" });
  });

  test("T-CO-002 regions and areas: add, rename, duplicates, no re-parenting, row security", async () => {
    expect(await co.createRegion(M, { code: "r3", name: " Region 3 " })).toEqual({ id: 3 });
    expect((await audit("org.region.create"))[0]).toMatchObject({ target_type: "region", after: { id: 3, code: "R3", name: "Region 3" } });
    expect(await msg(co.createRegion(M, { code: "", name: "" }))).toBe("code: required");
    expect(await msg(co.createRegion(M, { code: "R4", name: "x".repeat(101) }))).toBe("name: 1-100 characters");
    expect(await thrown(co.createRegion(M, { code: "R1", name: "x" }))).toMatchObject({ key: "org.region.duplicate" });
    await co.updateRegion(M, 3, { name: "Region three" });
    expect((await audit("org.region.update"))[0]).toMatchObject({ target_id: "3", before: { name: "Region 3" }, after: { name: "Region three" } });
    expect(await msg(co.updateRegion(M, 3, { name: " Region three " }))).toBe("nothing to change");
    expect(await thrown(co.updateRegion(M, 99, { name: "x" }))).toMatchObject({ reason: "notfound" });

    expect(await co.createArea(M, { regionId: 3, name: "C1" })).toEqual({ id: 4 });
    expect((await audit("org.area.create"))[0]).toMatchObject({ target_type: "area", after: { id: 4, regionId: 3, name: "C1" } });
    expect(await msg(co.createArea(M, { regionId: 99, name: "C2" }))).toBe("regionId: unknown");
    expect(await msg(co.createArea(M, { regionId: 0, name: "" }))).toBe("regionId: unknown");
    expect(await thrown(co.createArea(M, { regionId: 3, name: "C1" }))).toMatchObject({ key: "org.area.duplicate" });
    await co.createArea(M, { regionId: 1, name: "C1" }); // the same name in another region
    await co.updateArea(M, 4, { name: "C one" });
    expect((await audit("org.area.update"))[0]).toMatchObject({ before: { name: "C1" }, after: { name: "C one" } });
    expect(await thrown(co.updateArea(M, 1, { name: "A2" }))).toMatchObject({ key: "org.area.duplicate" });

    for (const tok of [R1, T.hoAll]) {
      expect(await thrown(co.createRegion(tok, { code: "R9", name: "x" })), tok).toBeInstanceOf(Forbidden);
      expect(await thrown(co.updateArea(tok, 1, { name: "x" })), tok).toBeInstanceOf(Forbidden);
    }
    // no re-parenting and no code change, even for a holder; no deletes
    expect(await asErr(M, `update app.area set region_id = 2 where id = 1`)).toBe("42501");
    expect(await asErr(M, `update app.region set code = 'X' where id = 1`)).toBe("42501");
    expect(await asErr(M, `delete from app.area where id = 4`)).toBe("42501");
    expect(await asErr(R1, `insert into app.area (region_id, name) values (1, 'x')`)).toBe("42501");
    expect((await as(R1, `update app.region set name = 'x'`)).rowCount).toBe(0);
    expect((await as(T.uA, `select count(*)::int n from app.area`)).rows).toEqual([{ n: 5 }]); // everyone reads

    const geo = await co.listGeography(T.uA);
    expect(geo.regions.map((r) => r.code)).toEqual(["R1", "R2", "R3"]);
    expect(geo.areas.find((a) => a.id === 4)).toEqual({ id: 4, regionId: 3, name: "C one", regionCode: "R3" });
    expect(geo.canManage).toBe(false);
    expect((await co.listGeography(M)).canManage).toBe(true);
    const sec = await sql(`select c.relname, c.relrowsecurity rls, c.relforcerowsecurity force,
        array(select case polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end
          from pg_policy where polrelid = c.oid order by 1) cmds
      from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'app' where c.relname in ('region', 'area') order by 1`);
    expect(sec).toEqual([{ relname: "area", rls: true, force: true, cmds: ["INSERT", "SELECT", "UPDATE"] },
      { relname: "region", rls: true, force: true, cmds: ["INSERT", "SELECT", "UPDATE"] }]);
  });

  test("T-CO-003 activation, the trading gate and sign-in", async () => {
    const { id } = await co.createCentre(M, MIN);
    // a centre-only user of the new centre cannot sign in until it is active (0004 account_usable)
    const STAFF = "00000000-0000-0000-0000-0000000000f9";
    await sql(`insert into app.app_user (id, login, display_name, status) values ($1, 'co-staff', 'Staff', 'ACTIVE')`, [STAFF]);
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 1, 'CENTRE', $2)`, [STAFF, id]);
    await newSession(STAFF, "tok-coStaff");
    const usable = async () => (await as("tok-coStaff", `select app.session_user_id()::text u`)).rows[0].u;
    expect(await usable()).toBeNull();

    expect(await msg(co.setCentreActive(M, id, true, " "))).toBe("reason: required");
    expect(await thrown(co.setCentreActive(M, id, true, "open"))).toMatchObject({ key: "org.centre.checklist" }); // no class
    await sql(`update app.centre set centre_class_id = 1, gst_enabled = true where id = $1`, [id]);
    expect(await thrown(co.setCentreActive(M, id, true, "open"))).toMatchObject({ key: "org.centre.checklist" }); // GST incomplete
    await co.updateCentre(M, id, { gstSupply: "STATE" });
    expect(await thrown(co.setCentreActive(M, id, true, "open"))).toMatchObject({ key: "org.centre.checklist" });
    await co.updateCentre(M, id, { gstin: "32ABCDE1234F1Z5" });
    await co.setCentreActive(M, id, true, "agreement signed");
    expect((await audit("org.centre.activate"))[0]).toMatchObject({ target_id: String(id), reason: "agreement signed",
      before: { status: "INACTIVE" }, after: { status: "ACTIVE" } });
    expect(await msg(co.setCentreActive(M, id, true, "again"))).toBe("already active");
    expect(await usable()).toBe(STAFF);
    expect(await msg(co.updateCentre(M, id, { gstin: null }))).toBe("gstin: required while active");
    expect(await msg(co.updateCentre(M, id, { gstSupply: null }))).toBe("gstSupply: required while active");
    await co.setCentreActive(M, id, false, "closed");
    expect((await audit("org.centre.deactivate"))[0]).toMatchObject({ reason: "closed", before: { status: "ACTIVE" }, after: { status: "INACTIVE" } });
    expect(await msg(co.setCentreActive(M, id, false, "again"))).toBe("already inactive");
    expect(await usable()).toBeNull();
    expect(await thrown(co.setCentreActive(R1, id, true, "x"))).toBeInstanceOf(Forbidden);
    expect(await thrown(co.setCentreActive(M, 999, true, "x"))).toMatchObject({ reason: "notfound" });

    // the trading gate at centre A: sh (student admin at ALL) also works enquiries everywhere
    await sql(`insert into app.role_assignment (user_id, role_id, scope_kind) values ($1, $2, 'ALL')`, [ST.sh, EQ_ROLE.worker]);
    const SH = ST_TOKEN.sh;
    const input = (o: Partial<AdmitInput> = {}): AdmitInput => ({ person: { givenName: "Gate", mobile: "9300000001" }, centreId: C.A,
      academicYear: "2026-27", admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o });
    const saved = await admit(SH, input({ admissionId: "00000000-0000-4000-8000-000000000001" }));
    await sql(`update app.centre set status = 'INACTIVE' where id = $1`, [C.A]);
    expect(await msg(admit(SH, input({ person: { givenName: "Gate2", mobile: "9300000002" } })))).toBe("centreId: centre is not active");
    expect(await thrown(admit(SH, input({ admissionId: "00000000-0000-4000-8000-000000000001" })))).toBeInstanceOf(AdmissionExists); // resubmit: saved
    expect((await getPerson(SH, saved.personId)).admissions).toHaveLength(1); // existing records stay
    expect((await admitOptions(SH)).centres.map((c) => c.id)).not.toContain(C.A);
    expect((await admitOptions(SH)).centres.map((c) => c.id)).toContain(C.B);
    const enquiry = { centreId: C.A, givenName: "Gate", dateOfBirth: "2005-01-01", gender: "FEMALE", mobile: "9300000003", pathId: 1, typeId: 1,
      courseCodes: ["DCA"] } as enq.EnquiryInput;
    expect(await msg(enq.createEnquiry(SH, enquiry))).toBe("centreId: centre is not active");
    const a = (await enq.enquiryOptions(SH)).centres.find((c) => c.id === C.A)!;
    expect(a).toMatchObject({ manage: true, active: false }); // manage stays, so old enquiries keep their bulk actions
    expect(await enq.createEnquiry(SH, { ...enquiry, centreId: C.B })).toMatchObject({ id: expect.any(String) });
    await sql(`update app.centre set status = 'ACTIVE' where id = $1`, [C.A]);
    expect(await enq.createEnquiry(SH, enquiry)).toMatchObject({ id: expect.any(String) });
  });
});
