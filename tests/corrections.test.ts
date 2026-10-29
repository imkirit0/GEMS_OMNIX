// Correction tickets acceptance tests: T-COR-001…006 (audit 09; docs/designs/correction-tickets). The engine parts use
// small test handlers; the identity handlers' cases follow. Page text is checked by scripts/smoke-security.mjs.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { POST as createRoute } from "../app/tickets/create/route";
import { SESSION_COOKIE } from "../src/server/auth/http";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Forbidden } from "../src/server/action";
import { RbacError } from "../src/server/rbac";
import { fakeStorage } from "../src/server/storage-fake";
import { act, getTicket, raise, requestUpload, ticketReview } from "../src/server/tickets/engine";
import { HANDLERS, TicketError, type TicketHandler } from "../src/server/tickets/handlers";
import { TICKET_GATES } from "../src/server/tickets/policy";
import { setTypeActive, updateType } from "../src/server/tickets/setup";
import { testCounter, type CounterPayload } from "../src/server/tickets/test-handler";
import { asAdmin, C, reset, rows, setStepUp, ST_ROLE, TK, TK_ROLE, tkToken } from "./fixtures";

const COMMITTED = { ...TICKET_GATES }; // before any test opens them
const tok = tkToken;
const admin = (sql: string, params: unknown[] = []) => asAdmin((db) => db.query(sql, params).then((q) => q.rows));
const grant = (user: string, role: number, centre: number) => admin(
  `insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, $2, 'CENTRE', $3)`, [user, role, centre]);
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };
const keyOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof RbacError ? e.key ?? e.reason : e instanceof TicketError ? `${e.reason}:${e.message}` : (e as Error).name));
async function makeType(o: { code: string; handler: string; levels: { user?: string; role?: number }[]; doc?: boolean; active?: boolean; viewer?: string }) {
  return asAdmin(async (db) => {
    const cat = (await db.query(`insert into app.ticket_category (name) values ('Student') returning id`)).rows[0].id as number;
    const id = (await db.query(`insert into app.ticket_type (code, name, category_id, document_required, handler_key, number_prefix, active)
      values ($1, $1, $2, $3, $4, 'TK-26', $5) returning id`, [o.code, cat, o.doc ?? false, o.handler, o.active ?? true])).rows[0].id as number;
    for (const [i, l] of o.levels.entries()) await db.query(`insert into app.ticket_type_level values ($1, $2, $3, $4)`, [id, i + 1, l.user ?? null, l.role ?? null]);
    if (o.viewer) await db.query(`insert into app.ticket_type_viewer (type_id, user_id) values ($1, $2)`, [id, o.viewer]);
    return id;
  });
}
const raiseAt = async (token: string, typeId: number, payload: Record<string, string>, centreId: number = C.A) => {
  const ticketId = randomUUID();
  await raise(token, { ticketId, typeId, centreId, payload, uploadIds: [] });
  return ticketId;
};
const version = async (id: string) => (await admin(`select version from app.ticket where id = $1`, [id]))[0].version as number;

// test handlers for the engine parts
let reviewMode: "ok" | "sql" | "lost" = "ok";
const reviewing: TicketHandler<CounterPayload> = { ...testCounter, key: "test.review",
  async review(tx) {
    if (reviewMode === "sql") await tx.$queryRaw`select 1/0`;
    if (reviewMode === "lost") throw new Error("Connection terminated unexpectedly");
    return { lines: ["Line one"], matches: [TK.raiser] };
  } };
const hidden: TicketHandler<CounterPayload> = { ...testCounter, key: "test.hidden", valuesPermission: "student.view",
  describe() { throw new Error("written for an older handler"); } };

beforeAll(async () => {
  await asAdmin((db) => db.query(fs.readFileSync("tests/sql/ticket-test-handler.sql", "utf8")));
  for (const h of [testCounter, reviewing, hidden]) HANDLERS[h.key] = h as TicketHandler<unknown>;
});
beforeEach(async () => { await reset(); fakeStorage.clear(); reviewMode = "ok"; TICKET_GATES.numberingSigned = false; TICKET_GATES.documentsLive = false; });
afterEach(() => { TICKET_GATES.numberingSigned = false; TICKET_GATES.documentsLive = false; });

describe("correction tickets: engine (T-COR)", () => {
  test("T-COR-005 the go-live gates are committed closed", () => {
    expect(COMMITTED).toEqual({ numberingSigned: false, documentsLive: false });
  });

  test("T-COR-005 no type switches on before numbering, no document type or upload before document storage", async () => {
    await setStepUp(tok("admin"), 0);
    const plain = await makeType({ code: "PLN", handler: "test.counter", levels: [{ user: TK.l1 }], active: false });
    const docs = await makeType({ code: "DOC", handler: "test.counter", levels: [{ user: TK.l1 }], active: false, doc: true });
    expect(await keyOf(setTypeActive(tok("admin"), plain, true))).toBe("ticket.setup.numbering");
    expect(await keyOf(setTypeActive(tok("admin"), docs, true))).toBe("ticket.setup.numbering");
    TICKET_GATES.numberingSigned = true;
    expect(await keyOf(setTypeActive(tok("admin"), plain, true))).toBe("ok");
    expect(await keyOf(setTypeActive(tok("admin"), docs, true))).toBe("ticket.setup.storage");
    // ticking "document required" on a live type is refused while storage is not live
    const [{ category_id }] = await admin(`select category_id from app.ticket_type where id = $1`, [plain]);
    const base = { name: "PLN", categoryId: category_id, priority: "MEDIUM", handlerKey: "test.counter" };
    expect(await keyOf(updateType(tok("admin"), plain, { ...base, documentRequired: true }))).toBe("ticket.setup.storage");
    // an upload for a live document type (switched on by SQL) is refused, and nothing is written
    await admin(`update app.ticket_type set active = true where id = $1`, [docs]);
    expect(await keyOf(requestUpload(tok("raiser"), { typeId: docs, centreId: C.A, fileName: "p.pdf", size: 10, contentType: "application/pdf" }))).toBe("inactive:inactive");
    expect(await admin(`select count(*)::int n from app.ticket_upload`)).toEqual([{ n: 0 }]);
    TICKET_GATES.documentsLive = true;
    expect(await keyOf(updateType(tok("admin"), plain, { ...base, documentRequired: true }))).toBe("ok");
    expect(await keyOf(requestUpload(tok("raiser"), { typeId: docs, centreId: C.A, fileName: "p.pdf", size: 10, contentType: "application/pdf" }))).toBe("ok");
  });

  test("T-COR-004 engine: every review is audited; a failing review degrades to one line; a lost connection is not hidden", async () => {
    const type = await makeType({ code: "REV", handler: "test.review", levels: [{ user: TK.l1 }] });
    const id = await raiseAt(tok("raiser"), type, { key: "k" });
    expect(await ticketReview(tok("l1"), id)).toEqual(["Line one"]);
    reviewMode = "sql";
    expect(await ticketReview(tok("l1"), id)).toEqual(["Review unavailable"]);
    reviewMode = "lost";
    await expect(ticketReview(tok("l1"), id)).rejects.toThrow(/Connection terminated/);
    expect(await thrown(ticketReview(tok("raiser"), id))).toBeInstanceOf(Forbidden); // not an approver
    const audit = await rows("ticket.review.duplicates");
    expect(audit.filter((r) => r.outcome === "OK").map((r) => r.detail.matches)).toEqual([[TK.raiser]]);
    expect(audit.filter((r) => r.outcome === "FAILED").map((r) => r.detail.error)).toEqual(["PrismaClientKnownRequestError"]);
    reviewMode = "ok";
    await act(tok("l1"), { ticketId: id, action: "approve", seenVersion: await version(id) }); // review never blocks
    expect((await admin(`select status::text from app.ticket where id = $1`, [id]))[0].status).toBe("APPROVED");
  });

  test("T-COR-006 engine: the payload is hidden from viewers without the handler's permission; a throwing describe falls back", async () => {
    const type = await makeType({ code: "HID", handler: "test.hidden", levels: [{ user: TK.l1 }], viewer: TK.viewer });
    const id = await raiseAt(tok("raiser"), type, { key: "secret" });
    expect((await getTicket(tok("viewer"), id)).payload).toBeNull();
    const asApprover = await getTicket(tok("l1"), id); // can act
    expect([asApprover.payload, asApprover.described]).toEqual([{ key: "secret", failApply: false, failRevalidate: false }, null]);
    expect((await getTicket(tok("raiser"), id)).payload).toBeNull(); // the raiser without student.view
    await grant(TK.raiser, ST_ROLE, C.A);
    expect((await getTicket(tok("raiser"), id)).payload).toEqual({ key: "secret", failApply: false, failRevalidate: false });
    expect(TK_ROLE.member).toBe(16); // the viewer holds no permission at all
  });
});

// ---------- the identity handlers ----------
let adm = 0;
/** A learner by SQL: person + admission at a centre (2026-27); returns the person id and Admission No. */
async function learner(centreId: number, p: { given: string; family?: string; dob?: string | null; mobile?: string | null }) {
  const no = `ADM-${++adm}`;
  const [{ id }] = await admin(`insert into app.person (id, given_name, family_name, date_of_birth, mobile) values (gen_random_uuid(), $1, $2, $3, $4) returning id::text`,
    [p.given, p.family ?? null, p.dob === undefined ? "2001-01-01" : p.dob, p.mobile === undefined ? `97100${String(adm).padStart(5, "0")}` : p.mobile]);
  await admin(`insert into app.admission (id, person_id, centre_id, academic_year, admission_no, admitted_on) values (gen_random_uuid(), $1, $2, '2026-27', $3, '2026-10-01')`, [id, centreId, no]);
  return { id: id as string, no };
}
const idType = (field: string, code = field.slice(0, 3).toUpperCase()) =>
  makeType({ code, handler: `identity.${field}`, levels: [{ user: TK.l1 }], viewer: TK.viewer });
const stored = async (id: string) => (await admin(`select payload from app.ticket where id = $1`, [id]))[0].payload;
const approve = async (token: string, id: string) => act(token, { ticketId: id, action: "approve", seenVersion: await version(id) });
const given = async (personId: string) => (await admin(`select given_name, match_key from app.person where id = $1`, [personId]))[0];
/** An OPEN ticket inserted directly, in the order the guard triggers require (scripts/smoke-security.mjs). */
async function openTicket(typeId: number, centreId: number, payload: object) {
  const [{ id }] = await admin(`insert into app.ticket (id, number, type_id, centre_id, raised_by, level_count, payload)
    values (gen_random_uuid(), $1, $2, $3, $4, 1, $5) returning id::text`, [`TK-26/X/${randomUUID().slice(0, 8)}`, typeId, centreId, TK.raiser, JSON.stringify(payload)]);
  await admin(`insert into app.ticket_level (ticket_id, centre_id, level, approver_user_id) values ($1, $2, 1, $3)`, [id, centreId, TK.l1]);
  await admin(`insert into app.ticket_event (ticket_id, centre_id, actor_id, action, level) values ($1, $2, $3, 'RAISE', 1)`, [id, centreId, TK.raiser]);
  return id as string;
}

describe("correction tickets: identity handlers (T-COR)", () => {
  test("T-COR-001 raising: the learner by Admission No at the centre, the old value from the record, specific refusals", async () => {
    const type = await idType("givenName", "FNC");
    const anu = await learner(C.A, { given: "Anu", family: "Raj" });
    const other = await learner(C.B, { given: "Bina" });
    const raiseFnc = (payload: Record<string, string>) => keyOf(raiseAt(tok("raiser"), type, payload));
    // without student.view the answer is the same as for an unknown number (DD-13)
    expect(await raiseFnc({ admissionNo: anu.no, newValue: "Anuja" })).toBe("invalid:admission.unknown");
    await grant(TK.raiser, ST_ROLE, C.A);
    const id = await raiseAt(tok("raiser"), type, { admissionNo: ` ${anu.no} `, newValue: " Anuja " });
    expect(await stored(id)).toEqual({ admissionNo: anu.no, personId: anu.id, field: "givenName", oldValue: "Anu", newValue: "Anuja" });
    expect(await raiseFnc({ admissionNo: "ADM-NOPE", newValue: "X" })).toBe("invalid:admission.unknown");
    expect(await raiseFnc({ admissionNo: other.no, newValue: "X" })).toBe("invalid:admission.unknown"); // another centre's
    expect(await raiseFnc({ admissionNo: "", newValue: "X" })).toBe("invalid:admissionNo.required");
    expect(await raiseFnc({ admissionNo: anu.no, newValue: "" })).toBe("invalid:newValue.required");
    expect(await raiseFnc({ admissionNo: anu.no, newValue: "Anu" })).toBe("invalid:newValue.same");
    const dob = await idType("dateOfBirth", "DOB");
    expect(await keyOf(raiseAt(tok("raiser"), dob, { admissionNo: anu.no, newValue: "2001-02-30" }))).toBe("invalid:newValue.format");
    // clearable fields store null; values are stored normalised
    const fam = await raiseAt(tok("raiser"), await idType("familyName", "LNC"), { admissionNo: anu.no, newValue: "" });
    expect((await stored(fam)).newValue).toBeNull();
    const mob = await raiseAt(tok("raiser"), await idType("mobile", "MOB"), { admissionNo: anu.no, newValue: "+91 98470 11111" });
    expect((await stored(mob)).newValue).toBe("9847011111");
    // every key a handler throws has a user text
    expect(Object.keys(HANDLERS["identity.givenName"]!.invalidMessages!).sort()).toEqual(
      ["admission.unknown", "admissionNo.required", "newValue.format", "newValue.required", "newValue.same", "reraise.person"]);
    // the raise route passes the key as detail; the page shows its text from the handler's list
    const body = new URLSearchParams({ ticketId: randomUUID(), typeId: String(type), centreId: String(C.A), "p.admissionNo": "ADM-NOPE", "p.newValue": "X" });
    const res = await createRoute(new Request("https://gems.test/tickets/create", { method: "POST", body,
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://gems.test", cookie: `${SESSION_COOKIE}=${tok("raiser")}` } }));
    expect(res.headers.get("location")).toContain("error=ticket.invalid&detail=admission.unknown");
  });

  test("T-COR-002 stale at the final approval, also concurrently; re-raise for the same learner only; a non-raiser learns nothing", async () => {
    await grant(TK.raiser, ST_ROLE, C.A);
    const type = await idType("givenName", "FNC");
    const anu = await learner(C.A, { given: "Anu" });
    const t1 = await raiseAt(tok("raiser"), type, { admissionNo: anu.no, newValue: "Anuja" });
    const t2 = await raiseAt(tok("raiser"), type, { admissionNo: anu.no, newValue: "Anita" });
    await approve(tok("l1"), t1);
    expect((await given(anu.id)).given_name).toBe("Anuja");
    expect(await keyOf(approve(tok("l1"), t2))).toBe("stale:changed");
    // concurrently: both wait on the person lock (held here), then one applies and the other is stale
    const q = await learner(C.A, { given: "Quinn" });
    const t3 = await raiseAt(tok("raiser"), type, { admissionNo: q.no, newValue: "Quentin" });
    const t4 = await raiseAt(tok("raiser"), type, { admissionNo: q.no, newValue: "Quincy" });
    const hold = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
    await hold.connect();
    try {
      await hold.query("begin");
      await hold.query(`select 1 from app.person where id = $1 for update`, [q.id]);
      const both = Promise.allSettled([approve(tok("l1"), t3), approve(tok("l1"), t4)]);
      await new Promise((r) => setTimeout(r, 500));
      await hold.query("commit");
      const done = await both;
      expect(done.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(done.find((r) => r.status === "rejected")).toMatchObject({ reason: { reason: "stale", message: "changed" } });
    } finally { await hold.end(); }
    // the stale ticket is rejected; its re-raise names the same learner and reads the value afresh
    await act(tok("l1"), { ticketId: t2, action: "reject", seenVersion: await version(t2), remarks: "stale" });
    const again = randomUUID();
    await raise(tok("raiser"), { ticketId: again, typeId: type, centreId: C.A, payload: { admissionNo: anu.no, newValue: "Anita" }, uploadIds: [], reraiseOf: t2 });
    expect(await stored(again)).toMatchObject({ personId: anu.id, oldValue: "Anuja", newValue: "Anita" });
    // another learner on a re-raise is refused; a non-raiser gets the engine's refusal before any domain answer
    const ben = await learner(C.A, { given: "Ben" });
    const t5 = await raiseAt(tok("raiser"), type, { admissionNo: anu.no, newValue: "Anna" });
    await act(tok("l1"), { ticketId: t5, action: "reject", seenVersion: await version(t5), remarks: "no" });
    const reraise = (token: string) => keyOf(raise(token, { ticketId: randomUUID(), typeId: type, centreId: C.A,
      payload: { admissionNo: ben.no, newValue: "Benny" }, uploadIds: [], reraiseOf: t5 }));
    await grant(TK.l2, TK_ROLE.raiser, C.A);
    await grant(TK.l2, ST_ROLE, C.A);
    expect(await reraise(tok("l2"))).toBe("invalid:only the raiser can re-raise a rejected ticket");
    // even naming an unknown number: the raiser check answers before any domain check (D1)
    expect(await keyOf(raise(tok("l2"), { ticketId: randomUUID(), typeId: type, centreId: C.A,
      payload: { admissionNo: "ADM-NOPE", newValue: "X" }, uploadIds: [], reraiseOf: t5 }))).toBe("invalid:only the raiser can re-raise a rejected ticket");
    expect(await reraise(tok("raiser"))).toBe("invalid:reraise.person");
    // a value the rules no longer accept is refused as stale at approval
    const bad = await openTicket(type, C.A, { admissionNo: ben.no, personId: ben.id, field: "givenName", oldValue: "Ben", newValue: "x".repeat(101) });
    expect(await keyOf(approve(tok("l1"), bad))).toBe("stale:format");
  });

  test("T-COR-003 applying: the field and match key change in the approval; the audit names the field; a failing apply is audited", async () => {
    await grant(TK.raiser, ST_ROLE, C.A);
    const type = await idType("givenName", "FNC");
    const anu = await learner(C.A, { given: "Anu", family: "Raj" });
    const before = await given(anu.id);
    const id = await raiseAt(tok("raiser"), type, { admissionNo: anu.no, newValue: "Anuja" });
    await approve(tok("l1"), id);
    const after = await given(anu.id);
    expect([after.given_name, after.match_key !== before.match_key]).toEqual(["Anuja", true]);
    const [audit] = (await rows("ticket.approve")).filter((r) => r.target_id === id);
    expect([audit.before, audit.after]).toEqual([{ fields: ["givenName"] }, { fields: ["givenName"] }]);
    // a person admitted only at another centre: changeIdentity refuses, the approval fails and is audited
    const away = await learner(C.B, { given: "Away" });
    await grant(TK.l1, TK_ROLE.member, C.B); // the approver may read the person, so revalidate passes
    const t = await openTicket(type, C.A, { admissionNo: away.no, personId: away.id, field: "givenName", oldValue: "Away", newValue: "Faraway" });
    expect(await keyOf(approve(tok("l1"), t))).toBe("ApplyFailed");
    expect((await rows("ticket.apply_failed")).map((r) => [r.outcome, r.detail.error])).toEqual([["FAILED", "PersonError"]]);
    expect((await given(away.id)).given_name).toBe("Away");
  });

  test("T-COR-004 the duplicate review: approver scope, names only with student.view, none, impossible", async () => {
    await grant(TK.raiser, ST_ROLE, C.A);
    const type = await idType("givenName", "FNC");
    const p = await learner(C.A, { given: "Anu", family: "Raj", dob: "2001-05-05", mobile: "9876500001" });
    const dup = await learner(C.A2, { given: "Anuja", family: "Raj", dob: "2001-05-05", mobile: "9876500001" });
    await learner(C.B, { given: "Anuja", family: "Raj", dob: "2001-05-05", mobile: "9876500001" }); // visible, not approvable
    await grant(TK.l1, TK_ROLE.level1, C.A2);
    await grant(TK.l1, TK_ROLE.member, C.B);
    const id = await raiseAt(tok("raiser"), type, { admissionNo: p.no, newValue: "Anuja" });
    expect(await ticketReview(tok("l1"), id)).toEqual([`Possible duplicate: ${dup.no} at KL3-07`]);
    await grant(TK.l1, ST_ROLE, C.A2);
    expect(await ticketReview(tok("l1"), id)).toEqual([`Possible duplicate: ${dup.no} at KL3-07, Anuja Raj, born 2001-05-05`]);
    expect((await rows("ticket.review.duplicates")).map((r) => [r.outcome, r.detail.matches])).toEqual([["OK", [dup.id]], ["OK", [dup.id]]]);
    const none = await raiseAt(tok("raiser"), type, { admissionNo: (await learner(C.A, { given: "Zed" })).no, newValue: "Zack" });
    expect(await ticketReview(tok("l1"), none)).toEqual(["No likely duplicates at centres you approve for"]);
    // a case-only correction keeps the match key: the learner never lists itself
    const caseOnly = await raiseAt(tok("raiser"), type, { admissionNo: (await learner(C.A, { given: "Kim" })).no, newValue: "KIM" });
    expect(await ticketReview(tok("l1"), caseOnly)).toEqual(["No likely duplicates at centres you approve for"]);
    const nokey = await raiseAt(tok("raiser"), type, { admissionNo: (await learner(C.A, { given: "Nod", dob: null })).no, newValue: "Noddy" });
    expect(await ticketReview(tok("l1"), nokey)).toEqual(["Duplicate check not possible: date of birth or mobile missing"]);
    await approve(tok("l1"), id); // the warning never blocks (DD-3)
    expect((await given(p.id)).given_name).toBe("Anuja");
  });

  test("T-COR-006 viewers without student.view who cannot act see no values", async () => {
    await grant(TK.raiser, ST_ROLE, C.A);
    const type = await idType("dateOfBirth", "DOB");
    const p = await learner(C.A, { given: "Dee" });
    const id = await raiseAt(tok("raiser"), type, { admissionNo: p.no, newValue: "2000-12-31" });
    const viewer = await getTicket(tok("viewer"), id);
    expect([viewer.payload, viewer.described]).toEqual([null, null]);
    const approver = await getTicket(tok("l1"), id);
    expect(approver.described).toEqual([["Admission No", p.no], ["Field", "Date of birth"], ["Old value", "2001-01-01"], ["New value", "2000-12-31"]]);
    expect(approver.hasReview).toBe(true);
  });
});
