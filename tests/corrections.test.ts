// Correction tickets acceptance tests: T-COR-001…006 (audit 09; docs/designs/correction-tickets). The engine parts use
// small test handlers; the identity handlers' cases follow. Page text is checked by scripts/smoke-security.mjs.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
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
