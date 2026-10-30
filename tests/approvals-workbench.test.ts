// Approvals workbench: T-AW-001…003 (audit 09; docs/designs/approvals-workbench/approvals-workbench.md). The page is a
// real-server smoke check. Helpers copied from tests/ticket-management.test.ts.
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { POST as bulkRoute } from "../app/tickets/approvals/bulk/route";
import { SESSION_COOKIE } from "../src/server/auth/http";
import { ScopeError, withScope } from "../src/server/db";
import { withRequestContext } from "../src/server/request-context";
import { act, approvalQueue, bulkAct, queueCards, raise } from "../src/server/tickets/engine";
import { TicketError } from "../src/server/tickets/errors";
import { HANDLERS, type TicketHandler } from "../src/server/tickets/handlers";
import { TICKET_GATES } from "../src/server/tickets/policy";
import { testCounter, type CounterPayload } from "../src/server/tickets/test-handler";
import { asAdmin, C, reset, TK, TK_ROLE, tkToken } from "./fixtures";

const tok = tkToken;
const L1 = tok("l1");
type Level = { user?: string; role?: number };
async function makeType(code: string, levels: Level[] = [{ role: TK_ROLE.level1 }], handler = "test.counter") {
  return asAdmin(async (db) => {
    const cat = (await db.query(`insert into app.ticket_category (name) values ('Student') returning id`)).rows[0].id as number;
    const id = (await db.query(`insert into app.ticket_type (code, name, category_id, document_required, handler_key, number_prefix, active)
      values ($1, $1, $2, false, $3, 'TK-26', true) returning id`, [code, cat, handler])).rows[0].id as number;
    for (const [i, l] of levels.entries()) await db.query(`insert into app.ticket_type_level values ($1, $2, $3, $4)`, [id, i + 1, l.user ?? null, l.role ?? null]);
    return id;
  });
}
const raiseAt = async (typeId: number, centreId: number = C.A, extra: Record<string, string> = {}) => {
  const ticketId = randomUUID();
  await raise(tok("raiser"), { ticketId, typeId, centreId, payload: { key: ticketId.slice(0, 30), ...extra }, uploadIds: [] });
  return ticketId;
};
const grant = (user: string, role: number, centre: number) => asAdmin((db) => db.query(
  `insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, $2, 'CENTRE', $3)`, [user, role, centre]));
const version = (id: string) => asAdmin((db) => db.query(`select version from app.ticket where id = $1`, [id]).then((r) => r.rows[0].version as number));
const status = (id: string) => asAdmin((db) => db.query(`select status::text s from app.ticket where id = $1`, [id]).then((r) => r.rows[0].s as string));
const backdate = (id: string, at: string) => asAdmin(async (db) => {
  await db.query("set session_replication_role = replica");
  try { await db.query(`update app.ticket set created_at = $2 where id = $1`, [id, at]); } finally { await db.query("set session_replication_role = origin"); }
});
const auditOf = (id: string) => asAdmin((db) => db.query(`select action, outcome::text, request_id from app.audit_log where target_id = $1 order by id`, [id])
  .then((r) => r.rows as { action: string; outcome: string; request_id: string | null }[]));

// test-local handlers (I1, R3): a final-level refusal as "invalid", and one that expires the acting session
const awInvalid: TicketHandler<CounterPayload> = { ...testCounter, key: "aw.invalid",
  async revalidate() { throw new TicketError("invalid", "test"); } };
let expireToken = "";
const awExpire: TicketHandler<CounterPayload> = { ...testCounter, key: "aw.expire",
  async revalidate() {
    await asAdmin((db) => db.query(`update app.app_session set expires_at = now() - interval '1 minute' where token_hash = sha256(convert_to($1, 'UTF8'))`, [expireToken]));
    throw new TicketError("invalid", "test");
  } };

beforeAll(async () => {
  await asAdmin((db) => db.query(fs.readFileSync("tests/sql/ticket-test-handler.sql", "utf8")));
  for (const h of [testCounter, awInvalid, awExpire]) HANDLERS[h.key] = h as TicketHandler<unknown>;
  TICKET_GATES.numberingSigned = true;
});
beforeEach(() => reset());

describe("T-AW approvals workbench", () => {
  test("T-AW-001 app.actable_ticket_ids() is exactly ticket_may_act, branch by branch", async () => {
    // branches: role approver (l1 at A), named approver (l2), earlier approver excluded at level 2 (both), assigned (fwd),
    // a role approver whose ticket.approve comes from another role (fwd as member), raiser, closed, other centre
    await grant(TK.raiser, TK_ROLE.raiser, C.B);
    await grant(TK.fwd, TK_ROLE.member, C.A);
    await grant(TK.raiser, TK_ROLE.level1, C.A); // the raiser also approves: its own tickets stay excluded (raised_by)
    await grant(TK.both, TK_ROLE.member, C.B); // both has the member role only at B: the MEMBER ticket at A is not its
    const role = await makeType("ROLE");
    const named = await makeType("NAMED", [{ user: TK.l2 }]);
    const two = await makeType("TWO", [{ role: TK_ROLE.level1 }, { user: TK.l2 }]); // level 2 differs from level 1
    const rev = await makeType("REV", [{ user: TK.reviewer }]);
    const same = await makeType("SAME", [{ role: TK_ROLE.level1 }, { role: TK_ROLE.level1 }]); // both levels by one role // a named approver without ticket.approve
    const member = await makeType("MEMBER", [{ role: TK_ROLE.member }]);
    const t = { role: await raiseAt(role), named: await raiseAt(named), two: await raiseAt(two), member: await raiseAt(member),
      assigned: await raiseAt(role), closed: await raiseAt(role), atB: await raiseAt(role, C.B), rev: await raiseAt(rev), same: await raiseAt(same) };
    await act(tok("both"), { ticketId: t.two, action: "approve", seenVersion: await version(t.two) }); // both approved level 1
    await act(tok("both"), { ticketId: t.same, action: "approve", seenVersion: await version(t.same) }); // only "already approved" excludes it now
    await act(L1, { ticketId: t.assigned, action: "forward", seenVersion: await version(t.assigned), forwardTo: TK.fwd });
    await act(L1, { ticketId: t.closed, action: "reject", seenVersion: await version(t.closed), remarks: "no" });
    const users = [...(Object.keys(TK) as (keyof typeof TK)[]).map((n) => tok(n))];
    for (const u of users) {
      const [viaSet, viaRow] = await withScope(u, async (tx) => [
        (await tx.$queryRaw<{ id: string }[]>`select id::text from app.actable_ticket_ids() id order by 1`).map((r) => r.id),
        (await tx.$queryRaw<{ id: string }[]>`select t.id::text from app.ticket t where t.status = 'OPEN' and app.ticket_may_act(t.id) order by 1`).map((r) => r.id),
      ]);
      expect(viaSet, u).toEqual(viaRow); // no distinct: a duplicate row would fail (D7)
    }
    const set = async (u: string) => withScope(u, async (tx) =>
      (await tx.$queryRaw<{ id: string }[]>`select id::text from app.actable_ticket_ids() id`).map((r) => r.id).sort());
    expect(await set(L1)).toEqual([t.role, t.same].sort()); // not named, not at level 2, not assigned away, not closed, not B
    expect(await set(tok("l2"))).toEqual([t.named, t.two].sort()); // two is at level 2 now
    expect(await set(tok("both"))).toEqual([t.role]); // not MEMBER (its member role is at B)
    expect(await set(tok("fwd"))).toEqual([t.assigned, t.member].sort());
    expect(await set(tok("raiser"))).toEqual([]);
    expect(await set(tok("reviewer"))).toEqual([]); // no ticket.approve
    expect(await set(tok("b"))).toEqual([t.atB]);
    expect((await asAdmin((db) => db.query(`select has_function_privilege('public', 'app.actable_ticket_ids()', 'execute') p`))).rows[0].p).toBe(false);
  });

  test("T-AW-002 queue filters and cards; invalid input matches nothing", async () => {
    await grant(TK.raiser, TK_ROLE.raiser, C.A2); await grant(TK.l1, TK_ROLE.level1, C.A2);
    const [x, y] = [await makeType("XRAY"), await makeType("YANK")];
    const ids = { xa: await raiseAt(x), xa2: await raiseAt(x, C.A2), ya: await raiseAt(y) };
    const q = async (f: Parameters<typeof approvalQueue>[1] = {}) => (await approvalQueue(L1, f)).rows.map((r) => r.id).sort();
    expect(await q()).toEqual(Object.values(ids).sort());
    expect((await approvalQueue(L1)).rows.find((r) => r.id === ids.xa)!.version).toBe(1);
    expect(await q({ type: String(x) })).toEqual([ids.xa, ids.xa2].sort());
    expect(await q({ centre: String(C.A2) })).toEqual([ids.xa2]);
    await backdate(ids.ya, "2026-10-01T18:40:00Z"); // 2026-10-02 00:10 IST
    expect(await q({ from: "2026-10-02", to: "2026-10-02" })).toEqual([ids.ya]);
    // cards: byType ignores the type filter, byCentre the centre filter; total matches the list
    const k = await queueCards(L1, { type: String(x) });
    expect(k.byType.map((t) => [t.code, t.count])).toEqual([["XRAY", 2], ["YANK", 1]]);
    expect(k.total).toBe(2);
    const kc = await queueCards(L1, { centre: String(C.A2) });
    expect(kc.byCentre.map((c) => [c.code, c.count])).toEqual([["KL2-25", 2], ["KL3-07", 1]]);
    expect(kc.total).toBe(1);
    expect((await queueCards(L1)).total).toBe(3);
    // invalid input: empty, never an error or a wider result
    for (const f of [{ type: "abc" }, { centre: ["1", "2"] }, { from: "2026-02-30" }, { status: "OPEN" } as never, { number: "TK" } as never]) {
      expect(await q(f), JSON.stringify(f)).toEqual([]);
      expect(await queueCards(L1, f), JSON.stringify(f)).toEqual({ total: 0, byType: [], byCentre: [] });
    }
    expect(await approvalQueue(L1, { cursor: "junk" })).toEqual({ rows: [], next: null });
    expect(await approvalQueue(L1, { cursor: ["a", "b"] })).toEqual({ rows: [], next: null });
    expect(await approvalQueue(L1, { cursor: Buffer.from(`1|${ids.xa}`).toString("base64url") })).toEqual({ rows: [], next: null }); // JS-parseable, not a timestamptz
    // the queue is what the user may ACT on, not all they may see: a ticket only TK.l2 may approve is absent for l1
    const onlyL2 = await raiseAt(await makeType("ONLYL2", [{ user: TK.l2 }]));
    expect(await q()).not.toContain(onlyL2);
    expect((await queueCards(L1)).byType.map((t) => t.code)).not.toContain("ONLYL2");
    // the row's version is the ticket's: a forwarded ticket is at version 2 in the receiver's queue
    await act(L1, { ticketId: ids.ya, action: "forward", seenVersion: await version(ids.ya), forwardTo: TK.fwd });
    expect((await approvalQueue(tok("fwd"))).rows.find((r) => r.id === ids.ya)!.version).toBe(2);
    // paging: oldest first, the second page continues after the first (51 tickets, pages of 50)
    for (let i = 0; i < 49; i++) await raiseAt(x);
    const p1 = await approvalQueue(L1);
    expect([p1.rows.length, typeof p1.next]).toEqual([50, "string"]);
    const p2 = await approvalQueue(L1, { cursor: p1.next! });
    expect(p2.rows).toHaveLength((await queueCards(L1)).total - 50);
    expect(p2.rows.length).toBeGreaterThan(0);
    expect(p1.rows.map((r) => r.id)).not.toContain(p2.rows[0]!.id);
    expect(p2.rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(p1.rows.at(-1)!.createdAt.getTime());
  });

  test("T-AW-003 bulk approve and reject: per ticket, counted by reason, audited per ticket; the route", async () => {
    await grant(TK.raiser, TK_ROLE.raiser, C.B);
    const ok = await makeType("OKAY"), named = await makeType("ONLYL2", [{ user: TK.l2 }]);
    const bad = await makeType("BAD", undefined, "aw.invalid");
    const t = { done: await raiseAt(ok), stale: await raiseAt(ok), notMine: await raiseAt(named), unseen: await raiseAt(ok, C.B),
      invalid: await raiseAt(bad), failed: await raiseAt(ok, C.A, { failApply: "1" }) };
    const item = async (id: string) => ({ ticketId: id, seenVersion: await version(id) });
    const items = [await item(t.done), { ticketId: t.stale, seenVersion: 99 }, await item(t.notMine), { ticketId: t.unseen, seenVersion: 1 },
      await item(t.invalid), await item(t.failed)];
    const r = await withRequestContext({ requestId: "req-aw-003", ip: "10.0.0.9" }, () => bulkAct(L1, { action: "approve", items }));
    expect(r).toEqual({ done: 1, conflict: 1, forbidden: 2, invalid: 1, failed: 1 });
    expect(await status(t.done)).toBe("APPROVED");
    // audit per ticket, one request id: OK, DENIED (viewable, not actable), FAILED; none for the conflict, the unseen, the invalid
    expect(await auditOf(t.done)).toEqual([expect.objectContaining({ action: "ticket.raise" }),
      { action: "ticket.approve", outcome: "OK", request_id: "req-aw-003" }]);
    expect((await auditOf(t.notMine)).at(-1)).toEqual({ action: "ticket.approve", outcome: "DENIED", request_id: "req-aw-003" });
    expect((await auditOf(t.failed)).at(-1)).toEqual({ action: "ticket.apply_failed", outcome: "FAILED", request_id: "req-aw-003" });
    for (const id of [t.stale, t.unseen, t.invalid]) expect((await auditOf(id)).map((a) => a.action), id).not.toContain("ticket.approve");
    // a resubmit of the same form is safe: what was done is now a conflict
    expect((await bulkAct(L1, { action: "approve", items: [items[0]!] }))).toEqual({ done: 0, conflict: 1, forbidden: 0, invalid: 0, failed: 0 });
    // the batch itself: reject needs remarks, 1-50 items, a known action; nothing is touched
    expect(await bulkAct(L1, { action: "reject", items: [await item(t.stale)] }).catch((e: TicketError) => e.reason)).toBe("invalid");
    expect(await bulkAct(L1, { action: "approve", items: Array.from({ length: 51 }, () => ({ ticketId: t.stale, seenVersion: 1 })) }).catch((e: TicketError) => e.reason)).toBe("invalid");
    expect(await bulkAct(L1, { action: "forward" as never, items: [await item(t.stale)] }).catch((e: TicketError) => e.reason)).toBe("invalid");
    expect(await status(t.stale)).toBe("OPEN");
    await bulkAct(L1, { action: "reject", remarks: " duplicate ", items: [await item(t.stale)] });
    expect(await status(t.stale)).toBe("REJECTED");
    // a session that expires mid-batch stops it; what was done stays done (R3)
    await asAdmin((db) => db.query(`insert into app.app_session (token_hash, user_id, expires_at) values (sha256(convert_to('tok-awExp', 'UTF8')), $1, now() + interval '1 hour')`, [TK.l1]));
    expireToken = "tok-awExp";
    const exp = await makeType("EXP", undefined, "aw.expire");
    const [first, expiring, third] = [await raiseAt(ok), await raiseAt(exp), await raiseAt(ok)];
    await expect(bulkAct("tok-awExp", { action: "approve", items: [await item(first), await item(expiring), await item(third)] })).rejects.toBeInstanceOf(ScopeError);
    expect([await status(first), await status(third)]).toEqual(["APPROVED", "OPEN"]);

    // the route: repeated items, blank versions refused, counts in the redirect, filters kept, origin
    const ORIGIN = "https://gems.test";
    const post = (pairs: [string, string][], origin = ORIGIN) => bulkRoute(new Request(`${ORIGIN}/tickets/approvals/bulk`, {
      method: "POST", body: new URLSearchParams(pairs), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${L1}`, origin } }));
    const where = (res: Response) => { const u = new URL(res.headers.get("location") ?? "/", ORIGIN); return u.pathname + u.search; };
    const [p1, p2, p3] = [await raiseAt(ok), await raiseAt(ok), await raiseAt(ok)];
    const res = await post([["action", "approve"], ["type", String(ok)], ["item", `${p1}:${await version(p1)}`], ["item", `${p2}:${await version(p2)}`], ["item", `${p3}:99`]]);
    expect(where(res)).toBe(`/tickets/approvals?type=${ok}&done=2&conflict=1&forbidden=0&invalid=0&failed=0`);
    expect(where(await post([["action", "approve"], ["item", `${p3}:`]]))).toMatch(/^\/tickets\/approvals\?error=ticket\.invalid/);
    expect(where(await post([["action", "approve"], ["item", `not-a-uuid:1`]]))).toMatch(/^\/tickets\/approvals\?error=ticket\.invalid/);
    expect(where(await post([["action", "approve"]]))).toMatch(/^\/tickets\/approvals\?error=ticket\.invalid/);
    expect((await post([["action", "approve"], ["item", `${p3}:1`]], "https://evil.example")).status).toBe(403);
  });
});
