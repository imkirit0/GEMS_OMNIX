// Ticket engine acceptance tests (audit 09 §T-TKT; design item 19). Runs against the local Docker database with
// the test.counter handler (tests/sql/ticket-test-handler.sql) and the in-memory storage driver.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Forbidden } from "../src/server/action";
import { withScope } from "../src/server/db";
import { StepUpRequired, RbacError } from "../src/server/rbac";
import { fakeStorage } from "../src/server/storage-fake";
import {
  act, approvalQueue, documentLink, getTicket, listTickets, raise, raiseOptions, reassign, requestUpload,
} from "../src/server/tickets/engine";
import { ApplyFailed, HANDLERS, TicketError, TicketNotFound, type TicketHandler } from "../src/server/tickets/handlers";
import { testCounter } from "../src/server/tickets/test-handler";
import {
  createCategory, createType, getType, listTypes, setTypeActive, setTypeLevels, setTypeViewers, updateType,
} from "../src/server/tickets/setup";
import { asAdmin, audits, C, reset, rows, setStepUp, T, TK, TK_ROLE, tkToken } from "./fixtures";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a, 0x31, 0x20]);
const tok = tkToken;

type LevelSpec = { user?: string; role?: number };
async function makeType(o: { code: string; levels: LevelSpec[]; doc?: boolean; active?: boolean; handler?: string; viewer?: LevelSpec }) {
  return asAdmin(async (db) => {
    const cat = (await db.query(`insert into app.ticket_category (name) values ('Student') returning id`)).rows[0].id as number;
    const id = (await db.query(`insert into app.ticket_type (code, name, category_id, document_required, handler_key, number_prefix, active)
      values ($1, $1, $2, $3, $4, 'TK-26', $5) returning id`, [o.code, cat, o.doc ?? false, o.handler ?? "test.counter", o.active ?? true])).rows[0].id as number;
    for (const [i, l] of o.levels.entries()) {
      await db.query(`insert into app.ticket_type_level values ($1, $2, $3, $4)`, [id, i + 1, l.user ?? null, l.role ?? null]);
    }
    if (o.viewer) await db.query(`insert into app.ticket_type_viewer (type_id, user_id, role_id) values ($1, $2, $3)`, [id, o.viewer.user ?? null, o.viewer.role ?? null]);
    return id;
  });
}
const raiseAt = async (token: string, typeId: number, payload: Record<string, string> = { key: "k" },
  extra: Partial<Parameters<typeof raise>[1]> = {}) => {
  const ticketId = randomUUID();
  await raise(token, { ticketId, typeId, centreId: C.A, payload, uploadIds: [], ...extra });
  return ticketId;
};
const ticket = (id: string) => asAdmin((db) => db.query(`select status::text, current_level, version, assigned_user_id::text, number,
  reraise_of::text from app.ticket where id = $1`, [id]).then((r) => r.rows[0]));
const counter = (key = "k") => asAdmin((db) => db.query(`select value from app.test_ticket_counter where key = $1`, [key])
  .then((r) => (r.rows[0]?.value ?? 0) as number));
const events = (id: string) => asAdmin((db) => db.query(`select action::text, level, remarks, to_user_id::text, detail from app.ticket_event
  where ticket_id = $1 order by id`, [id]).then((r) => r.rows));
const approve = async (token: string, id: string, remarks?: string) =>
  act(token, { ticketId: id, action: "approve", seenVersion: (await ticket(id)).version, remarks });
const reasonOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => e instanceof TicketError ? e.reason : (e as Error).name);
const grant = (user: string, role: number, centre: number) => asAdmin((db) => db.query(
  `insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, $2, 'CENTRE', $3)`, [user, role, centre]));
async function uploadPdf(token: string, typeId: number, bytes: Uint8Array = PDF, centreId: number = C.A, declared = bytes.length) {
  const { uploadId } = await requestUpload(token, { typeId, centreId, fileName: "proof.pdf", size: declared, contentType: "application/pdf" });
  fakeStorage.put(`uploads/${centreId}/${uploadId}`, bytes);
  return uploadId;
}

beforeAll(async () => {
  await asAdmin((db) => db.query(fs.readFileSync("tests/sql/ticket-test-handler.sql", "utf8")));
  HANDLERS[testCounter.key] = testCounter as TicketHandler<unknown>;
});
beforeEach(async () => { await reset(); fakeStorage.clear(); });

describe("ticket engine (T-TKT)", () => {
  test("T-TKT-001 raise without a mandatory document is refused; with one it is linked", async () => {
    const typeId = await makeType({ code: "DOC", levels: [{ role: TK_ROLE.level1 }], doc: true });
    expect(await reasonOf(raiseAt(tok("raiser"), typeId))).toBe("document");
    expect(await asAdmin((db) => db.query(`select count(*)::int n from app.ticket`).then((r) => r.rows[0].n))).toBe(0);
    const uploadId = await uploadPdf(tok("raiser"), typeId);
    const id = await raiseAt(tok("raiser"), typeId, { key: "k" }, { uploadIds: [uploadId] });
    const docs = await asAdmin((db) => db.query(`select content_type, size_bytes::int from app.ticket_document where ticket_id = $1`, [id]).then((r) => r.rows));
    expect(docs).toEqual([{ content_type: "application/pdf", size_bytes: PDF.length }]); // type from the bytes, size from storage
    expect((await rows("ticket.upload.request"))[0]).toMatchObject({ outcome: "OK", target_type: "ticket_upload", target_id: uploadId });
    expect((await rows("ticket.raise"))[0]).toMatchObject({ outcome: "OK", target_type: "ticket", target_id: id, target_centre_id: C.A });
  });

  test("T-TKT-002 numbering: one network-wide counter, no duplicates, no gap after a rollback, first raise creates the row", async () => {
    expect(await asAdmin((db) => db.query(`select count(*)::int n from app.ticket_number_series`).then((r) => r.rows[0].n))).toBe(0);
    const typeId = await makeType({ code: "NUM", levels: [{ role: TK_ROLE.level1 }] });
    await grant(TK.b, TK_ROLE.raiser, C.B);
    const a = await raiseAt(tok("raiser"), typeId);
    const b = await raise(tok("b"), { ticketId: randomUUID(), typeId, centreId: C.B, payload: { key: "k" }, uploadIds: [] });
    expect((await ticket(a)).number).toBe("TK-26/NUM/1");
    expect((await ticket(b.id)).number).toBe("TK-26/NUM/2"); // another centre, same counter (zoom-out B1)
    // a racing double submit: one insert wins, the other rolls back and releases its number
    const same = randomUUID();
    const twice = await Promise.allSettled([0, 1].map(() => raise(tok("raiser"), { ticketId: same, typeId, centreId: C.A, payload: { key: "k" }, uploadIds: [] })));
    expect(twice.filter((r) => r.status === "fulfilled" && r.value.created)).toHaveLength(1);
    const ids = await Promise.all([0, 1, 2, 3].map(() => raiseAt(tok("raiser"), typeId)));
    const numbers = (await Promise.all([same, ...ids].map(ticket))).map((t) => Number(t.number.split("/")[2])).sort((x, y) => x - y);
    expect(numbers).toEqual([3, 4, 5, 6, 7]); // consecutive: the loser of the race left no gap
    expect(await asAdmin((db) => db.query(`select period, current::int from app.ticket_number_series`).then((r) => r.rows)))
      .toEqual([{ period: "ALL", current: 7 }]);
  });

  test("T-TKT-003 the queue shows only tickets the actor can act on, in scope", async () => {
    const typeId = await makeType({ code: "QUE", levels: [{ role: TK_ROLE.level1 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    const inQueue = async (token: string) => (await approvalQueue(token)).rows.some((r) => r.id === id);
    expect(await inQueue(tok("l1"))).toBe(true);
    expect(await inQueue(tok("b"))).toBe(false); // same role, other centre
    expect(await inQueue(tok("raiser"))).toBe(false);
    expect(await inQueue(tok("l2"))).toBe(false);
  });

  test("T-TKT-004 level-1 approval on a two-level type advances the level and changes no domain data", async () => {
    const typeId = await makeType({ code: "TWO", levels: [{ role: TK_ROLE.level1 }, { user: TK.l2 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    await approve(tok("l1"), id);
    expect(await ticket(id)).toMatchObject({ status: "OPEN", current_level: 2, version: 2 });
    expect(await counter()).toBe(0);
    expect((await rows("ticket.approve"))[0]).toMatchObject({ before: { level: 1, assignedUserId: null }, after: { level: 2, assignedUserId: null } });
    expect((await rows("ticket.approve"))[0].detail).toMatchObject({ level: 1, final: false });
  });

  test("T-TKT-005 last-level approval applies the change exactly once, with history and audit", async () => {
    const typeId = await makeType({ code: "FIN", levels: [{ role: TK_ROLE.level1 }, { user: TK.l2 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    await approve(tok("l1"), id);
    await approve(tok("l2"), id);
    expect(await ticket(id)).toMatchObject({ status: "APPROVED", current_level: 2, version: 3 });
    expect(await counter()).toBe(1);
    expect((await events(id)).map((e) => e.action)).toEqual(["RAISE", "APPROVE", "APPROVE"]);
    expect((await events(id))[2].detail).toEqual({ final: true });
    const final = (await rows("ticket.approve"))[1];
    expect(final).toMatchObject({ outcome: "OK", before: { value: 0 }, after: { value: 1 } });
    expect(final.detail).toMatchObject({ level: 2, final: true });
    await expect(approve(tok("l2"), id)).rejects.toMatchObject({ reason: "conflict" }); // closed
  });

  test("T-TKT-006 two concurrent last-level approvals: one applies, the other gets a conflict", async () => {
    const typeId = await makeType({ code: "RACE", levels: [{ role: TK_ROLE.level1 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    const seen = (await ticket(id)).version;
    const results = await Promise.allSettled([tok("l1"), tok("both")].map((t) => act(t, { ticketId: id, action: "approve", seenVersion: seen })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ reason: "conflict" });
    expect(await counter()).toBe(1);
  });

  test("T-TKT-007 apply throws: everything rolls back, the ticket stays at its level, a FAILED row records it", async () => {
    const typeId = await makeType({ code: "BOOM", levels: [{ role: TK_ROLE.level1 }] });
    const id = await raiseAt(tok("raiser"), typeId, { key: "k", failApply: "1" });
    await expect(approve(tok("l1"), id)).rejects.toBeInstanceOf(ApplyFailed);
    expect(await ticket(id)).toMatchObject({ status: "OPEN", current_level: 1, version: 1 });
    expect(await counter()).toBe(0); // the increment inside apply rolled back
    const failed = await rows("ticket.apply_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ outcome: "FAILED", target_type: "ticket", target_id: id, target_centre_id: C.A });
    expect(failed[0].detail).toEqual({ level: 1, error: "Error" }); // the cause's name, never its message
    expect(await rows("ticket.approve")).toHaveLength(0);
  });

  test("T-TKT-008 reject needs remarks and closes the ticket", async () => {
    const typeId = await makeType({ code: "REJ", levels: [{ role: TK_ROLE.level1 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    const v = (await ticket(id)).version;
    expect(await reasonOf(act(tok("l1"), { ticketId: id, action: "reject", seenVersion: v, remarks: "  " }))).toBe("invalid");
    await act(tok("l1"), { ticketId: id, action: "reject", seenVersion: v, remarks: "Proof missing" });
    expect(await ticket(id)).toMatchObject({ status: "REJECTED" });
    expect((await events(id))[1]).toMatchObject({ action: "REJECT", remarks: "Proof missing" });
    expect((await rows("ticket.reject"))[0]).toMatchObject({ before: { status: "OPEN", level: 1 }, after: { status: "REJECTED" } });
  });

  test("T-TKT-009 forward only to an in-scope approver; afterwards only they can act", async () => {
    const typeId = await makeType({ code: "FWD", levels: [{ role: TK_ROLE.level1 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    const forward = async (to: string) => act(tok("l1"), { ticketId: id, action: "forward", seenVersion: (await ticket(id)).version, forwardTo: to });
    expect(await reasonOf(forward(TK.b))).toBe("invalid"); // other centre
    expect(await reasonOf(forward(TK.raiser))).toBe("invalid");
    expect(await reasonOf(forward(TK.l1))).toBe("invalid"); // the actor
    expect(await reasonOf(forward(TK.reviewer))).toBe("invalid"); // no ticket.approve
    await forward(TK.fwd);
    expect((await ticket(id)).assigned_user_id).toBe(TK.fwd);
    expect((await rows("ticket.forward"))[0]).toMatchObject({ before: { assignedUserId: null }, after: { assignedUserId: TK.fwd } });
    await expect(approve(tok("l1"), id)).rejects.toBeInstanceOf(Forbidden);
    await approve(tok("fwd"), id);
    expect(await ticket(id)).toMatchObject({ status: "APPROVED" });
  });

  test("T-TKT-010 the raiser cannot act on their own ticket at any level, even holding the role", async () => {
    const typeId = await makeType({ code: "SELF", levels: [{ role: TK_ROLE.level1 }] });
    await grant(TK.l1, TK_ROLE.raiser, C.A);
    const id = await raiseAt(tok("l1"), typeId);
    await expect(approve(tok("l1"), id)).rejects.toBeInstanceOf(Forbidden);
    await expect(act(tok("l1"), { ticketId: id, action: "reject", seenVersion: 1, remarks: "x" })).rejects.toBeInstanceOf(Forbidden);
    expect((await approvalQueue(tok("l1"))).rows).toHaveLength(0);
    expect((await getTicket(tok("l1"), id)).canAct).toBe(false);
    expect((await audits("ticket.approve")).map((a) => a.outcome)).toEqual(["DENIED"]);
  });

  test("T-TKT-011 a stale request is refused with the handler's reason and nothing changes", async () => {
    const typeId = await makeType({ code: "STALE", levels: [{ role: TK_ROLE.level1 }] });
    const id = await raiseAt(tok("raiser"), typeId, { key: "k", failRevalidate: "1" });
    await expect(approve(tok("l1"), id)).rejects.toMatchObject({ reason: "stale", message: "test" });
    expect(testCounter.staleMessages["test"]).toBe("Test refusal");
    expect(await ticket(id)).toMatchObject({ status: "OPEN", version: 1 });
    expect(await counter()).toBe(0);
    expect(await rows("ticket.apply_failed")).toHaveLength(0);
  });

  test("T-TKT-012 viewers see a ticket but cannot act; posting an action is forbidden, not 404", async () => {
    const typeId = await makeType({ code: "VIEW", levels: [{ role: TK_ROLE.level1 }], viewer: { user: TK.viewer } });
    const id = await raiseAt(tok("raiser"), typeId);
    expect((await getTicket(tok("viewer"), id)).canAct).toBe(false); // named viewer of the type
    expect((await getTicket(tok("reviewer"), id)).number).toBe("TK-26/VIEW/1"); // ticket.view over the centre
    await expect(approve(tok("viewer"), id)).rejects.toBeInstanceOf(Forbidden);
    expect((await listTickets(tok("viewer"))).rows.map((r) => r.id)).toEqual([id]);
    await expect(getTicket(T.uA, id)).rejects.toBeInstanceOf(TicketNotFound); // centre A, but neither viewer nor named
  });

  test("T-TKT-013 role-based levels are resolved when someone acts", async () => {
    const typeId = await makeType({ code: "ROLE", levels: [{ role: TK_ROLE.level2 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    await asAdmin((db) => db.query(`delete from app.role_assignment where user_id = $1 and role_id = $2`, [TK.both, TK_ROLE.level2]));
    await expect(approve(tok("both"), id)).rejects.toBeInstanceOf(Forbidden); // lost the role after the raise
    await grant(TK.fwd, TK_ROLE.level2, C.A);
    await approve(tok("fwd"), id); // gained it after the raise
    expect(await ticket(id)).toMatchObject({ status: "APPROVED" });
  });

  test("T-TKT-014 history and document links are append-only", async () => {
    const typeId = await makeType({ code: "HIST", levels: [{ role: TK_ROLE.level1 }], doc: true });
    const id = await raiseAt(tok("raiser"), typeId, { key: "k" }, { uploadIds: [await uploadPdf(tok("raiser"), typeId)] });
    for (const sql of [`update app.ticket_event set remarks = 'x' where ticket_id = '${id}'`, `delete from app.ticket_event where ticket_id = '${id}'`,
      "truncate app.ticket_event", "update app.ticket_document set size_bytes = 1", "truncate app.ticket_document"]) {
      await expect(asAdmin((db) => db.query(sql)), sql).rejects.toThrow(/append-only/); // even the owner
    }
    await expect(withScope(tok("raiser"), (tx) => tx.$executeRaw`delete from app.ticket_event`)).rejects.toThrow(); // no grant
  });

  test("T-TKT-015 re-raise: only the raiser, only once, only from REJECTED, keeping type and centre", async () => {
    const typeId = await makeType({ code: "RER", levels: [{ role: TK_ROLE.level1 }] });
    const other = await makeType({ code: "OTH", levels: [{ role: TK_ROLE.level1 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    expect(await reasonOf(raiseAt(tok("raiser"), typeId, { key: "k" }, { reraiseOf: id }))).toBe("invalid"); // still OPEN
    await act(tok("l1"), { ticketId: id, action: "reject", seenVersion: 1, remarks: "Wrong course" });
    await grant(TK.fwd, TK_ROLE.raiser, C.A);
    expect(await reasonOf(raiseAt(tok("fwd"), typeId, { key: "k" }, { reraiseOf: id }))).toBe("invalid"); // not the raiser
    const again = await raiseAt(tok("raiser"), other, { key: "k" }, { reraiseOf: id, centreId: C.B });
    const t = await asAdmin((db) => db.query(`select type_id, centre_id, reraise_of::text from app.ticket where id = $1`, [again]).then((r) => r.rows[0]));
    expect(t).toEqual({ type_id: typeId, centre_id: C.A, reraise_of: id }); // form's type and centre ignored
    expect((await rows("ticket.raise"))[1].detail).toMatchObject({ reraiseOf: id });
    expect(await reasonOf(raiseAt(tok("raiser"), typeId, { key: "k" }, { reraiseOf: id }))).toBe("invalid"); // only once
  });

  test.todo("T-TKT-016 SLA reminder job: Stage 5 (D-TKT-3)");
  test.todo("T-TKT-017 per-type handlers: built with each domain module (Stages 3 to 6)");
  test.todo("T-TKT-018 bulk approve: Stage 5");

  test("T-TKT-019 document download needs ticket.document.view, is audited, and is 404 outside scope", async () => {
    const typeId = await makeType({ code: "DL", levels: [{ role: TK_ROLE.level1 }], doc: true });
    const uploadId = await uploadPdf(tok("raiser"), typeId);
    const id = await raiseAt(tok("raiser"), typeId, { key: "k" }, { uploadIds: [uploadId] });
    const [doc] = (await getTicket(tok("raiser"), id)).documents;
    expect(await documentLink(tok("raiser"), id, Number(doc!.id))).toBe(`fake://uploads/${C.A}/${uploadId}?expires=60`);
    expect((await rows("ticket.document.download"))[0]).toMatchObject({ outcome: "OK", target_type: "ticket_document", target_id: String(doc!.id) });
    await expect(documentLink(tok("reviewer"), id, Number(doc!.id))).rejects.toBeInstanceOf(Forbidden); // sees the ticket, not documents
    await expect(documentLink(T.uB, id, Number(doc!.id))).rejects.toBeInstanceOf(TicketNotFound);
    const other = await raiseAt(tok("raiser"), typeId, { key: "k" }, { uploadIds: [await uploadPdf(tok("raiser"), typeId)] });
    await expect(documentLink(tok("raiser"), other, Number(doc!.id))).rejects.toBeInstanceOf(TicketNotFound); // not on this ticket
  });

  test("T-TKT-020 uploads are checked before attaching: real size, signature, owner, centre, attached once", async () => {
    const typeId = await makeType({ code: "UPL", levels: [{ role: TK_ROLE.level1 }], doc: true });
    const tryWith = async (bytes: Uint8Array, declared = bytes.length) =>
      reasonOf(raiseAt(tok("raiser"), typeId, { key: "k" }, { uploadIds: [await uploadPdf(tok("raiser"), typeId, bytes, C.A, declared)] }));
    expect(await tryWith(new TextEncoder().encode("MZ not a pdf at all"))).toBe("document"); // wrong signature
    const big = new Uint8Array(10 * 1024 * 1024 + 1); big.set(PDF);
    expect(await tryWith(big, PDF.length)).toBe("document"); // the browser said 17 bytes; storage says otherwise
    await grant(TK.fwd, TK_ROLE.raiser, C.A);
    const foreign = await uploadPdf(tok("fwd"), typeId);
    expect(await reasonOf(raiseAt(tok("raiser"), typeId, { key: "k" }, { uploadIds: [foreign] }))).toBe("document"); // another user's
    expect(await reasonOf(requestUpload(tok("raiser"), { typeId, centreId: C.A, fileName: "a.exe", size: 10, contentType: "application/x-msdownload" }))).toBe("document");
    const ok = await uploadPdf(tok("raiser"), typeId);
    await raiseAt(tok("raiser"), typeId, { key: "k" }, { uploadIds: [ok] });
    expect(await reasonOf(raiseAt(tok("raiser"), typeId, { key: "k" }, { uploadIds: [ok] }))).toBe("document"); // already attached
    const missing = (await requestUpload(tok("raiser"), { typeId, centreId: C.A, fileName: "a.pdf", size: 10, contentType: "application/pdf" })).uploadId;
    expect(await reasonOf(raiseAt(tok("raiser"), typeId, { key: "k" }, { uploadIds: [missing] }))).toBe("document"); // never PUT
  });

  test("T-TKT-021 nobody approves two levels of one ticket, by roles or by forwarding", async () => {
    const typeId = await makeType({ code: "DIST", levels: [{ role: TK_ROLE.level1 }, { role: TK_ROLE.level2 }] });
    const a = await raiseAt(tok("raiser"), typeId);
    await approve(tok("both"), a);
    await expect(approve(tok("both"), a)).rejects.toBeInstanceOf(Forbidden);
    await approve(tok("l2"), a);
    const b = await raiseAt(tok("raiser"), typeId);
    await act(tok("l1"), { ticketId: b, action: "forward", seenVersion: 1, forwardTo: TK.l2 });
    await approve(tok("l2"), b); // level 1, as the forward target
    await expect(approve(tok("l2"), b)).rejects.toBeInstanceOf(Forbidden); // not level 2 as well
    expect(await reasonOf(act(tok("both"), { ticketId: b, action: "forward", seenVersion: (await ticket(b)).version, forwardTo: TK.l2 }))).toBe("invalid");
  });

  test("T-TKT-022 an administrator reassigns a ticket whose named approver was disabled", async () => {
    const typeId = await makeType({ code: "STR", levels: [{ user: TK.l2 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    await asAdmin((db) => db.query(`update app.app_user set status = 'DISABLED' where id = $1`, [TK.l2]));
    for (const t of [tok("l1"), tok("both"), tok("fwd")]) await expect(approve(t, id)).rejects.toBeInstanceOf(Forbidden); // stranded
    const r = { ticketId: id, seenVersion: 1, toUserId: TK.fwd };
    await expect(reassign(tok("admin"), r)).rejects.toBeInstanceOf(StepUpRequired);
    await setStepUp(tok("admin"), 0);
    await expect(reassign(tok("l1"), r)).rejects.toBeInstanceOf(Forbidden);
    expect(await reasonOf(reassign(tok("admin"), { ...r, toUserId: TK.raiser }))).toBe("invalid");
    await reassign(tok("admin"), r);
    expect((await events(id))[1]).toMatchObject({ action: "FORWARD", to_user_id: TK.fwd, detail: { admin: true } });
    expect((await rows("ticket.reassign")).map((x) => x.outcome)).toEqual(["DENIED", "OK"]); // l1's attempt, then the admin's
    expect((await rows("ticket.reassign"))[1]).toMatchObject({ after: { assignedUserId: TK.fwd } });
    await approve(tok("fwd"), id);
    expect(await ticket(id)).toMatchObject({ status: "APPROVED" });
  });
});

describe("ticket engine guards and rules", () => {
  test("guard triggers refuse illegal states and transitions from the app role", async () => {
    const typeId = await makeType({ code: "GRD", levels: [{ role: TK_ROLE.level1 }, { role: TK_ROLE.level2 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    const asApp = (fn: Parameters<typeof withScope>[1]) => withScope(tok("raiser"), fn);
    await expect(asApp((tx) => tx.$executeRaw`update app.ticket set current_level = 2 where id = ${id}::uuid`)).rejects.toThrow(/version/);
    await expect(asApp((tx) => tx.$executeRaw`update app.ticket set current_level = 3, version = version + 1 where id = ${id}::uuid`)).rejects.toThrow();
    await expect(asApp((tx) => tx.$executeRaw`update app.ticket set status = 'APPROVED', closed_at = now(), version = version + 1
      where id = ${id}::uuid`)).rejects.toThrow(/last level/);
    await expect(asApp((tx) => tx.$executeRaw`insert into app.ticket (id, number, type_id, centre_id, raised_by, status, level_count, payload, closed_at)
      values (${randomUUID()}::uuid, 'X', ${typeId}, ${C.A}, ${TK.raiser}::uuid, 'APPROVED', 1, '{}', now())`)).rejects.toThrow(/inserted OPEN/);
    await expect(asApp((tx) => tx.$executeRaw`insert into app.ticket_level (ticket_id, centre_id, level, approver_role_id)
      values (${id}::uuid, ${C.A}, 3, 11)`)).rejects.toThrow(/outside the ticket/);
    await act(tok("l1"), { ticketId: id, action: "reject", seenVersion: 1, remarks: "x" });
    await expect(asApp((tx) => tx.$executeRaw`update app.ticket set status = 'OPEN', closed_at = null, version = version + 1
      where id = ${id}::uuid`)).rejects.toThrow(/closed/);
    await expect(asAdmin((db) => db.query(`insert into app.ticket_level (ticket_id, centre_id, level, approver_role_id) values ($1, 1, 2, 11)`, [id])))
      .rejects.toThrow(); // levels are fixed once raised (primary key or guard)
  });

  test("idempotent raise: the same form id twice gives one ticket", async () => {
    const typeId = await makeType({ code: "IDM", levels: [{ role: TK_ROLE.level1 }] });
    const ticketId = randomUUID();
    const input = { ticketId, typeId, centreId: C.A, payload: { key: "k" }, uploadIds: [] };
    expect(await raise(tok("raiser"), input)).toEqual({ id: ticketId, created: true });
    expect(await raise(tok("raiser"), input)).toEqual({ id: ticketId, created: false });
    expect(await rows("ticket.raise")).toHaveLength(1); // the second submit writes and audits nothing
  });

  test("uploads are refused until a live type needs documents (DD-16)", async () => {
    const off = await makeType({ code: "OFF", levels: [{ role: TK_ROLE.level1 }], doc: true, active: false });
    const noDoc = await makeType({ code: "NOD", levels: [{ role: TK_ROLE.level1 }] });
    const ask = (typeId: number) => requestUpload(tok("raiser"), { typeId, centreId: C.A, fileName: "a.pdf", size: 10, contentType: "application/pdf" });
    expect(await reasonOf(ask(off))).toBe("inactive");
    expect(await reasonOf(ask(noDoc))).toBe("inactive");
    await expect(ask(noDoc)).rejects.toThrow(); // and nothing was stored
    expect(await asAdmin((db) => db.query(`select count(*)::int n from app.ticket_upload`).then((r) => r.rows[0].n))).toBe(0);
  });

  test("deactivation stops raises and last-level approvals; reject still works (DD-12)", async () => {
    const typeId = await makeType({ code: "DEA", levels: [{ role: TK_ROLE.level1 }] });
    const a = await raiseAt(tok("raiser"), typeId);
    const b = await raiseAt(tok("raiser"), typeId);
    await asAdmin((db) => db.query(`update app.ticket_type set active = false where id = $1`, [typeId]));
    expect(await reasonOf(raiseAt(tok("raiser"), typeId))).toBe("inactive");
    expect(await reasonOf(approve(tok("l1"), a))).toBe("inactive");
    await act(tok("l1"), { ticketId: b, action: "reject", seenVersion: 1, remarks: "type off" });
    expect((await raiseOptions(tok("raiser"))).types).toEqual([]);
  });

  test("type setup: step-up and ticket.type.manage required; refusals carry their message keys", async () => {
    const admin = tok("admin");
    await expect(createCategory(admin, { name: "Student" })).rejects.toBeInstanceOf(StepUpRequired);
    await setStepUp(admin, 0);
    await expect(createCategory(tok("l1"), { name: "Student" })).rejects.toBeInstanceOf(Forbidden);
    const cat = await createCategory(admin, { name: "Student" });
    const keyOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => e instanceof RbacError ? e.key ?? e.reason : (e as Error).name);
    const base = { code: "FNC", name: "Name correction", categoryId: cat, priority: "HIGH", documentRequired: true, handlerKey: "test.counter" };
    expect(await keyOf(createType(admin, { ...base, numberPrefix: "TK-26-VERY-LONG" }))).toBe("ticket.setup.prefix");
    const typeId = await createType(admin, { ...base, numberPrefix: "TK-26" });
    expect(await keyOf(createType(admin, { ...base, numberPrefix: "TK-26" }))).toBe("ticket.setup.duplicate");
    expect(await keyOf(setTypeActive(admin, typeId, true))).toBe("ticket.setup.activate"); // no levels yet
    expect(await keyOf(setTypeLevels(admin, typeId, [{ level: 1, roleId: TK_ROLE.level1 }, { level: 3, userId: TK.l2 }]))).toBe("ticket.setup.levels");
    expect(await keyOf(setTypeLevels(admin, typeId, []))).toBe("ticket.setup.levels");
    await setTypeLevels(admin, typeId, [{ level: 1, roleId: TK_ROLE.level1 }, { level: 2, userId: TK.l2 }]);
    await setTypeViewers(admin, typeId, [{ userId: TK.viewer }]);
    await setTypeActive(admin, typeId, true);
    expect(await keyOf(updateType(admin, typeId, { ...base, handlerKey: "other.handler" }))).toBe("ticket.setup.handler"); // active
    await setTypeActive(admin, typeId, false);
    await updateType(admin, typeId, { ...base, name: "First name correction" });
    expect((await getType(admin, typeId)).levels).toHaveLength(2);
    expect((await listTypes(admin)).types.map((t) => t.code)).toEqual(["FNC"]);
    const other = await makeType({ code: "NOH", levels: [{ role: TK_ROLE.level1 }], handler: "missing.handler", active: false });
    expect(await keyOf(setTypeActive(admin, other, true))).toBe("ticket.setup.activate"); // unregistered handler
    for (const a of ["ticket.category.create", "ticket.type.create", "ticket.type.levels", "ticket.type.viewers", "ticket.type.activate",
      "ticket.type.deactivate", "ticket.type.update"]) {
      expect((await audits(a)).filter((r) => r.outcome === "OK").length, a).toBeGreaterThan(0);
    }
  });

  test("handler change is refused while the type has open tickets, even when it is off (DD-11)", async () => {
    await setStepUp(tok("admin"), 0);
    const typeId = await makeType({ code: "HCH", levels: [{ role: TK_ROLE.level1 }] });
    await raiseAt(tok("raiser"), typeId);
    await asAdmin((db) => db.query(`update app.ticket_type set active = false where id = $1`, [typeId]));
    const err = await updateType(tok("admin"), typeId, { name: "x", categoryId: 1, priority: "LOW", documentRequired: false, handlerKey: "other" })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ key: "ticket.setup.handler" });
  });

  test("failure hook: DENIED wins over FAILED, an exhausted write conflict writes no FAILED row, audit faults do not mask errors", async () => {
    const typeId = await makeType({ code: "HOOK", levels: [{ role: TK_ROLE.level1 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    await expect(approve(tok("reviewer"), id)).rejects.toBeInstanceOf(Forbidden); // no ticket.approve
    expect((await rows("ticket.approve")).map((r) => r.outcome)).toEqual(["DENIED"]);
    expect(await rows("ticket.apply_failed")).toHaveLength(0);

    let calls = 0;
    HANDLERS["test.conflict"] = { ...testCounter, key: "test.conflict",
      async apply() { calls++; throw Object.assign(new Error("write conflict"), { code: "P2034" }); } } as TicketHandler<unknown>;
    try {
      const conflictType = await makeType({ code: "CONF", levels: [{ role: TK_ROLE.level1 }], handler: "test.conflict" });
      const c = await raiseAt(tok("raiser"), conflictType);
      await expect(approve(tok("l1"), c)).rejects.toMatchObject({ code: "P2034" });
      expect(calls).toBe(4); // withScope retried it three times
      expect(await rows("ticket.apply_failed")).toHaveLength(0);
    } finally { delete HANDLERS["test.conflict"]; }

    // a lost connection inside apply is retried like a write conflict, not audited as the handler failing (C-26)
    let lostCalls = 0;
    HANDLERS["test.lost"] = { ...testCounter, key: "test.lost",
      async apply() { lostCalls++; throw new Error("Connection terminated unexpectedly"); } } as TicketHandler<unknown>;
    try {
      const lostType = await makeType({ code: "LOST", levels: [{ role: TK_ROLE.level1 }], handler: "test.lost" });
      const l = await raiseAt(tok("raiser"), lostType);
      await expect(approve(tok("l1"), l)).rejects.toThrow(/Connection terminated/);
      expect(lostCalls).toBe(4);
      expect(await rows("ticket.apply_failed")).toHaveLength(0);
    } finally { delete HANDLERS["test.lost"]; }

    await asAdmin(async (db) => {
      await db.query(fs.readFileSync("tests/sql/audit-fault.sql", "utf8"));
      await db.query(`insert into app.bakeoff_audit_fault default values`);
    });
    try {
      await expect(approve(tok("reviewer"), id)).rejects.toBeInstanceOf(Forbidden); // not the audit error
    } finally { await asAdmin((db) => db.query(`delete from app.bakeoff_audit_fault`)); }
  });

  test("404 parity: a ticket at a hidden centre looks exactly like a missing one", async () => {
    const typeId = await makeType({ code: "PAR", levels: [{ role: TK_ROLE.level1 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    for (const t of [id, randomUUID(), "not-a-uuid"]) {
      await expect(getTicket(T.uB, t), t).rejects.toBeInstanceOf(TicketNotFound);
      await expect(act(T.uB, { ticketId: t, action: "approve", seenVersion: 1 }), t).rejects.toBeInstanceOf(TicketNotFound);
      await expect(documentLink(T.uB, t, 1), t).rejects.toBeInstanceOf(TicketNotFound);
    }
  });

  test("eligibility: for every fixture user, a ticket is in the queue exactly when approving it succeeds", async () => {
    const typeId = await makeType({ code: "ELG", levels: [{ role: TK_ROLE.level1 }] });
    const tokens = [T.uA, T.uB, T.hoR1, T.hoArea, T.hoAll, ...(Object.keys(TK) as (keyof typeof TK)[]).map(tok)];
    const eligible: string[] = [];
    for (const token of tokens) {
      const id = await raiseAt(tok("raiser"), typeId);
      const inQueue = (await approvalQueue(token)).rows.some((r) => r.id === id);
      const ok = await approve(token, id).then(() => true, () => false);
      expect(ok, token).toBe(inQueue);
      if (ok) eligible.push(token);
    }
    expect(eligible.sort()).toEqual([tok("both"), tok("l1")].sort()); // not vacuous
  });

  test("other-centre callers learn nothing from the eligibility functions", async () => {
    const typeId = await makeType({ code: "LEAK", levels: [{ role: TK_ROLE.level1 }] });
    const id = await raiseAt(tok("raiser"), typeId);
    const r = await withScope(T.uB, async (tx) => ({
      receive: (await tx.$queryRaw<{ ok: boolean }[]>`select app.ticket_may_receive(${id}::uuid, ${TK.fwd}::uuid) as ok`)[0]!.ok,
      candidates: await tx.$queryRaw`select * from app.ticket_forward_candidates(${id}::uuid)`,
      people: await tx.$queryRaw`select * from app.ticket_people(${id}::uuid)`,
    }));
    expect(r).toEqual({ receive: false, candidates: [], people: [] });
    expect((await getTicket(tok("l1"), id)).candidates.map((c) => c.id).sort()).toEqual([TK.both, TK.fwd, TK.l2].sort());
  });
});

describe("load guards (DD-7)", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  test("the test handler and the fake storage driver refuse to load on a Vercel deployment", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.resetModules();
    await expect(import("../src/server/storage-fake")).rejects.toThrow(/Vercel/);
    vi.stubEnv("TICKET_TEST_HANDLER", "1");
    vi.resetModules();
    await expect(import("../src/server/tickets/handlers")).rejects.toThrow(/Vercel/);
  });
});
