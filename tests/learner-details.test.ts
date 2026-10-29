// Learner details acceptance tests: T-LD-001…004 (audit 09; docs/designs/learner-details). Domain level here;
// the form layer (submitAdmission, submitDetails) is covered at the end; the pages by scripts/smoke-security.mjs.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import pg from "pg";
import { Forbidden } from "../src/server/action";
import { BLOOD_GROUPS, COUNTRY_CODES, detailField, DETAIL_KEYS, EMPLOYMENT_STATUSES, QUALIFICATIONS, type Details } from "../src/server/details";
import { detailsFrom, submitAdmission, submitDetails, type DetailsFormState } from "../src/server/admission-form";
import { admit, getPerson, PersonError, updateDetails, type AdmitInput } from "../src/server/people";
import { randomUUID } from "node:crypto";
import { asAdmin, C, newSession, reset, rows, ST_TOKEN } from "./fixtures";

const { sa, sb, sr } = ST_TOKEN;
const V = "tok-stuV"; // student.view only, at centre A (design R9)
const RESET_SQL = fs.readFileSync("scripts/etl/reset.sql", "utf8");
let n = 0;
const learner = (o: Partial<AdmitInput> = {}): AdmitInput => ({
  person: { givenName: `Lina${++n}`, dateOfBirth: "2001-01-01", mobile: `97000${String(n).padStart(5, "0")}` },
  centreId: C.A, academicYear: "2026-27", admittedOn: "2026-10-28", courses: [{ courseCode: "DCA", joinDate: "2026-11-01" }], ...o,
});
const FULL: Partial<Details> = { currentAddress: "12 MG Road\nErnakulam", currentPlace: "Kochi", currentPincode: "682001",
  employmentStatus: "STUDENT", qualification: "SSLC", fatherName: "Ravi", fatherPhone: "+91 98470 11111" };
const admin = (sql: string, params: unknown[] = []) => asAdmin((db) => db.query(sql, params).then((q) => q.rows));
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const detailRow = async (personId: string) => (await admin(`select * from app.person_detail where person_id = $1`, [personId]))[0];

// the database gate alone: gems_app with a session (tests/catalogue.test.ts pattern)
let app: pg.Client;
const as = async (tok: string, sql: string, params: unknown[] = []) => {
  await app.query("begin");
  await app.query("select set_config('app.session_id', $1, true)", [tok]);
  try { return await app.query(sql, params); } finally { await app.query("rollback"); }
};
beforeAll(async () => { app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] }); await app.connect(); });
afterAll(() => app.end());
beforeEach(async () => {
  await reset();
  await admin(`insert into app.role (id, key, name) values (19, 'student_viewer', 'Student viewer')`);
  await admin(`insert into app.role_permission values (19, 'student.view')`);
  const [{ id }] = await admin(`insert into app.app_user (id, login, display_name, status) values (gen_random_uuid(), 'sv', 'Student viewer', 'ACTIVE') returning id`);
  await admin(`insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, 19, 'CENTRE', $2)`, [id, C.A]);
  await newSession(id, V);
});

describe("learner details (T-LD)", () => {
  test("T-LD-001 details at admission: new person; existing person only when none exist; the admit audit lists the fields", async () => {
    const a = await admit(sa, learner({ details: FULL }));
    const row = await detailRow(a.personId);
    expect(row).toMatchObject({ version: 1, current_address: "12 MG Road\nErnakulam", father_phone: "9847011111", employment_status: "STUDENT" });
    const audit = (await rows("person.admit")).find((r) => r.target_id === a.personId)!;
    expect(audit.detail.detailFields).toEqual(DETAIL_KEYS.filter((k) => FULL[k] != null));
    // an existing learner without details gets the typed ones; one with details keeps the stored ones (DD-13)
    const b = await admit(sa, learner());
    expect(await detailRow(b.personId)).toBeUndefined();
    await admit(sr, learner({ person: { existingId: b.personId }, centreId: C.A2, details: { currentPlace: "Aluva", currentPincode: "683101" } }));
    expect(await detailRow(b.personId)).toMatchObject({ current_place: "Aluva", version: 1 });
    await admit(sr, learner({ person: { existingId: a.personId }, centreId: C.A2, details: { currentPlace: "Elsewhere" } }));
    expect((await detailRow(a.personId)).current_place).toBe("Kochi");
    // invalid details are field errors before anything is written
    expect(await thrown(admit(sa, learner({ details: { currentPincode: "012345" } })))).toMatchObject({ field: "currentPincode", rule: "6 digits, not starting with 0" });
    // details inserted only after the admission (the insert policy needs it)
    expect(await admin(`select count(*)::int n from app.person_detail`)).toEqual([{ n: 2 }]);
  });

  test("T-LD-002 editing: version, clearing, required stays app-side, field names only in the audit, who may edit", async () => {
    const { personId: p } = await admit(sa, learner({ details: FULL }));
    expect(await updateDetails(sa, p, C.A, 1, { currentPlace: "Aluva" })).toEqual({ version: 2, changed: ["currentPlace"] });
    const [audit] = (await rows("person.details.update")).filter((r) => r.outcome === "OK");
    expect([audit.detail, audit.before, audit.after, audit.target_centre_id]).toEqual([{ fields: ["currentPlace"] }, null, null, C.A]);
    expect(await thrown(updateDetails(sa, p, C.A, 1, { currentPlace: "X" }))).toMatchObject({ field: "details", rule: "changed since you opened them; reload the page" });
    expect(await updateDetails(sa, p, C.A, 2, { currentPlace: null })).toEqual({ version: 3, changed: ["currentPlace"] });
    expect((await getPerson(sa, p)).details?.currentPlace).toBeNull();
    expect((await updateDetails(sa, p, C.A, 3, { employmentStatus: "NOT_KNOWN" })).version).toBe(4);
    // the stored phone in another spelling is no change
    expect(await thrown(updateDetails(sa, p, C.A, 4, { fatherPhone: "098470-11111" }))).toMatchObject({ field: "details", rule: "nothing to change" });
    // a centre without student.admit: Forbidden and DENIED; a centre with it but no admission: notfound, no audit row
    expect(await thrown(updateDetails(sa, p, C.B, 4, { currentPlace: "X" }))).toBeInstanceOf(Forbidden);
    expect((await rows("person.details.update")).filter((r) => r.outcome === "DENIED")).toHaveLength(1);
    const before = (await rows("person.details.update")).length;
    expect(await thrown(updateDetails(sr, p, C.A2, 4, { currentPlace: "X" }))).toMatchObject({ reason: "notfound" });
    for (const bad of ["", "1e0", " 1", "-1"]) expect(await thrown(updateDetails(sa, p, bad, 4, { currentPlace: "X" })), bad).toMatchObject({ reason: "notfound" });
    expect((await rows("person.details.update")).length).toBe(before);
    // a view-only user sees the person but may not edit
    const view = await getPerson(V, p);
    expect([view.editCentreId, (await getPerson(sa, p)).editCentreId, view.detailsVersion]).toEqual([null, C.A, 4]);
    expect(await thrown(updateDetails(V, p, C.A, 4, { currentPlace: "X" }))).toBeInstanceOf(Forbidden);
    // identity never changes here
    const id = await admin(`select given_name, mobile, match_key from app.person where id = $1`, [p]);
    await updateDetails(sa, p, C.A, 4, { motherName: "Sita" });
    expect(await admin(`select given_name, mobile, match_key from app.person where id = $1`, [p])).toEqual(id);
  });

  test("T-LD-003 scope by direct SQL; concurrent first edits; admit of an existing learner racing a first edit", async () => {
    const { personId: p } = await admit(sa, learner({ details: FULL }));
    const { personId: q } = await admit(sa, learner());
    expect((await as(sb, `select * from app.person_detail where person_id = $1`, [p])).rowCount).toBe(0);
    expect((await as(sb, `update app.person_detail set current_place = 'x' where person_id = $1`, [p])).rowCount).toBe(0);
    expect((await as(V, `update app.person_detail set current_place = 'x' where person_id = $1`, [p])).rowCount).toBe(0);
    await expect(as(sb, `insert into app.person_detail (person_id, current_place) values ($1, 'x')`, [q])).rejects.toMatchObject({ code: "42501" });
    await expect(as(V, `insert into app.person_detail (person_id, current_place) values ($1, 'x')`, [q])).rejects.toMatchObject({ code: "42501" });
    await expect(as(sa, `update app.person_detail set person_id = $2 where person_id = $1`, [p, q])).rejects.toMatchObject({ code: "42501" });
    // two first edits of a person without details: one saves, the other is stale (no raw database error)
    const both = await Promise.allSettled([updateDetails(sa, q, C.A, 0, { currentPlace: "A" }), updateDetails(sa, q, C.A, 0, { currentPlace: "B" })]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(both.find((r) => r.status === "rejected")).toMatchObject({ reason: { field: "details" } });
    // an existing-learner admit with details racing a first edit: exactly one writes, the other is ignored or stale
    const { personId: r } = await admit(sa, learner());
    const race = await Promise.allSettled([
      admit(sr, learner({ person: { existingId: r }, centreId: C.A2, details: { currentPlace: "Admit" } })),
      updateDetails(sa, r, C.A, 0, { currentPlace: "Edit" }),
    ]);
    for (const x of race) if (x.status === "rejected") expect(x.reason).toMatchObject({ field: "details" });
    expect((await admin(`select count(*)::int n, min(version) v from app.person_detail where person_id = $1`, [r]))[0]).toEqual({ n: 1, v: 1 });
  });

  test("T-LD-004 app and database accept and refuse the same values, whatever the locale", async () => {
    const [{ id }] = await admin(`insert into app.person (id, given_name) values (gen_random_uuid(), 'Probe') returning id`);
    const dbAccepts = async (column: string, v: string) => asAdmin(async (db) => {
      await db.query("begin");
      try { await db.query(`insert into app.person_detail (person_id, ${column}) values ($1, $2)`, [id, v]); return true; }
      catch (e) { if ((e as { code: string }).code === "23514") return false; throw e; } finally { await db.query("rollback"); }
    });
    const appAccepts = (k: (typeof DETAIL_KEYS)[number], v: string) => { try { return detailField(k, v) === v; } catch { return false; } };
    const samples: [(typeof DETAIL_KEYS)[number], string, string][] = [
      ...[...BLOOD_GROUPS, "C+"].map((v) => ["bloodGroup", "blood_group", v] as [(typeof DETAIL_KEYS)[number], string, string]),
      ...[...Object.keys(EMPLOYMENT_STATUSES), "RETIRED", "constructor"].map((v) => ["employmentStatus", "employment_status", v] as [(typeof DETAIL_KEYS)[number], string, string]),
      ...[...Object.keys(QUALIFICATIONS), "PHD"].map((v) => ["qualification", "qualification", v] as [(typeof DETAIL_KEYS)[number], string, string]),
      ["fatherName", "father_name", " x"], ["fatherName", "father_name", "x\u0085"], ["fatherName", "father_name", "a\tb"],
      ["fatherName", "father_name", "x﻿"], ["fatherName", "father_name", "Ravi Kumar"],
      ["currentAddress", "current_address", " x\ny"], ["currentAddress", "current_address", "x\ny"], ["currentAddress", "current_address", "x\u0001y"],
      ["currentAddress", "current_address", "😀".repeat(500)], ["currentAddress", "current_address", "😀".repeat(501)],
      ["currentPincode", "current_pincode", "682001"], ["currentPincode", "current_pincode", "082001"],
      ["fatherPhone", "father_phone", "9847011111"], ["fatherPhone", "father_phone", "98470"],
    ];
    for (const [k, col, v] of samples) expect(await dbAccepts(col, v), `${k} ${JSON.stringify(v)}`).toBe(appAccepts(k, v));
    // nationality: the list in the app, the format in the database
    expect([detailField("nationality", "in"), appAccepts("nationality", "ZZ"), await dbAccepts("nationality", "ZZ")]).toEqual(["IN", false, true]);
    expect(() => detailField("nationality", "ß")).toThrow(PersonError);
    // characters the database cannot hold or never sees: refused by the app
    for (const v of ["a\u0000b", "a\ud800b"]) expect(() => detailField("fatherName", v)).toThrow("invalid characters");
    // the country list: 249 unique codes, each with a display name
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    expect([COUNTRY_CODES.length, new Set(COUNTRY_CODES).size, COUNTRY_CODES.filter((c) => names.of(c) === c)]).toEqual([249, 249, []]);
    // the migration reset clears details (person_detail references person)
    await admit(sa, learner({ details: FULL }));
    await admin(RESET_SQL);
    expect(await admin(`select count(*)::int n from app.person_detail`)).toEqual([{ n: 0 }]);
  });

  test("T-LD-004 a detail check violation becomes a field error, never the failing row", async () => {
    const [{ def }] = await admin(`select pg_get_constraintdef(oid) def from pg_constraint where conname = 'person_detail_father_name_check'`);
    await admin(`alter table app.person_detail drop constraint person_detail_father_name_check;
      alter table app.person_detail add constraint person_detail_father_name_check check (char_length(father_name) <= 5)`);
    try {
      expect(await thrown(admit(sa, learner({ details: { fatherName: "Abcdef" } })))).toMatchObject({ field: "fatherName", rule: "invalid" });
    } finally {
      await admin(`alter table app.person_detail drop constraint person_detail_father_name_check;
        alter table app.person_detail add constraint person_detail_father_name_check ${def}`);
    }
  });
});

describe("learner details through the forms (T-LD-001, T-LD-002 form layer)", () => {
  const H = new Headers({ origin: "http://localhost", host: "localhost" });
  const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
  const admitForm = (o: Record<string, string> = {}) => form({ centreId: String(C.A), academicYear: "2026-27", admittedOn: "2026-10-28",
    givenName: `Form${++n}`, dateOfBirth: "2001-02-02", mobile: `96000${String(n).padStart(5, "0")}`, "course.1.courseCode": "DCA",
    "course.1.joinDate": "2026-11-01", admissionId: randomUUID(), currentPincode: "682001", employmentStatus: "STUDENT",
    qualification: "SSLC", ...o });
  const personOf = (r: unknown) => (r as { redirect: string }).redirect.replace("/students/", "");

  test("T-LD-001 admit form: same as current copies; the three fields required for a new person; an untouched select is null", async () => {
    const p = personOf(await submitAdmission(sa, H, admitForm({ currentAddress: "1 Hill Road", currentPlace: "Thrissur", permanentSame: "on",
      permanentAddress: "typed but replaced", bloodGroup: "", nationality: "IN" })));
    expect(await detailRow(p)).toMatchObject({ permanent_address: "1 Hill Road", permanent_place: "Thrissur", permanent_pincode: "682001",
      blood_group: null, nationality: "IN" });
    const missing = await submitAdmission(sa, H, admitForm({ currentPincode: "", employmentStatus: "", qualification: "" }));
    expect((missing as { fieldErrors: Record<string, string> }).fieldErrors).toEqual({ currentPincode: "required", employmentStatus: "required", qualification: "required" });
    expect(detailsFrom(form({ bloodGroup: "", nationality: "" }))).toEqual({ bloodGroup: "", nationality: "" }); // "" clears, never a list value
  });

  test("T-LD-002 edit form: required on every edit, a missing optional input kept, stale and no-Origin cases", async () => {
    const { personId: p } = await admit(sa, learner({ details: { ...FULL, bloodGroup: "O+" } }));
    const edit = (o: Record<string, string>, h = H) => submitDetails(sa, h, form({ personId: p, centreId: String(C.A), version: "1",
      currentPincode: "682001", employmentStatus: "STUDENT", qualification: "SSLC", currentPlace: "Kakkanad", ...o }));
    // bloodGroup not posted at all: kept
    expect(await edit({})).toEqual({ redirect: `/students/${p}` });
    expect(await detailRow(p)).toMatchObject({ current_place: "Kakkanad", blood_group: "O+", version: 2 });
    expect(((await edit({ version: "2", qualification: "" })) as DetailsFormState).fieldErrors).toEqual({ qualification: "required" });
    expect(((await edit({ currentPlace: "Old version" })) as DetailsFormState).formError).toBe("changed since you opened them; reload the page");
    expect(((await edit({ version: "2", fatherPhone: "123" })) as DetailsFormState).fieldErrors).toEqual({ fatherPhone: "10 digits" });
    expect(await thrown(edit({ version: "2" }, new Headers({ host: "localhost" })))).toBeInstanceOf(Forbidden);
    expect(await thrown(submitDetails(sr, H, form({ personId: p, centreId: String(C.A2), version: "2", currentPincode: "682001",
      employmentStatus: "STUDENT", qualification: "SSLC" })))).toMatchObject({ reason: "notfound" });
  });
});
