// Ticket management view: T-TM-001…002 (audit 09; docs/designs/ticket-management/ticket-management.md). Reads only; the
// page itself is a real-server smoke check. Helpers copied from tests/tickets.test.ts (R9).
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { act, listTickets, raise, reassign, ticketFilterOptions, ticketSummary, type TicketFilter } from "../src/server/tickets/engine";
import { HANDLERS, type TicketHandler } from "../src/server/tickets/handlers";
import { TICKET_GATES } from "../src/server/tickets/policy";
import { testCounter } from "../src/server/tickets/test-handler";
import { withScope } from "../src/server/db";
import { asAdmin, C, reset, setStepUp, TK, TK_ROLE, tkToken } from "./fixtures";

const tok = tkToken;
async function makeType(code: string, priority: "LOW" | "MEDIUM" | "HIGH") {
  return asAdmin(async (db) => {
    const cat = (await db.query(`insert into app.ticket_category (name) values ('Student') returning id`)).rows[0].id as number;
    const id = (await db.query(`insert into app.ticket_type (code, name, category_id, document_required, handler_key, number_prefix, active, priority)
      values ($1, $1, $2, false, 'test.counter', 'TK-26', true, $3::app."TicketPriority") returning id`, [code, cat, priority])).rows[0].id as number;
    await db.query(`insert into app.ticket_type_level values ($1, 1, null, $2)`, [id, TK_ROLE.level1]);
    return id;
  });
}
const raiseAt = async (typeId: number, centreId: number) => {
  const ticketId = randomUUID();
  await raise(tok("raiser"), { ticketId, typeId, centreId, payload: { key: ticketId }, uploadIds: [] });
  return ticketId;
};
const grant = (user: string, role: number, centre: number) => asAdmin((db) => db.query(
  `insert into app.role_assignment (user_id, role_id, scope_kind, scope_centre_id) values ($1, $2, 'CENTRE', $3)`, [user, role, centre]));
const version = (id: string) => asAdmin((db) => db.query(`select version from app.ticket where id = $1`, [id]).then((r) => r.rows[0].version as number));
const numberOf = (id: string) => asAdmin((db) => db.query(`select number from app.ticket where id = $1`, [id]).then((r) => r.rows[0].number as string));
/** created_at is guarded (0009): backdate as the owner with triggers off, as reset() clears (R2). */
const backdate = (id: string, at: string) => asAdmin(async (db) => {
  await db.query("set session_replication_role = replica");
  try { await db.query(`update app.ticket set created_at = $2 where id = $1`, [id, at]); } finally { await db.query("set session_replication_role = origin"); }
});

beforeAll(async () => {
  await asAdmin((db) => db.query(fs.readFileSync("tests/sql/ticket-test-handler.sql", "utf8")));
  HANDLERS[testCounter.key] = testCounter as TicketHandler<unknown>;
  TICKET_GATES.numberingSigned = true; // as tests/tickets.test.ts: types switch on in tests
});
beforeEach(() => reset());

/** Fixture: ALPHA (HIGH) at A ×3 and A2 ×1, BETA (LOW) at A ×1, GAMMA (MEDIUM) only at B ×1. */
async function seed() {
  for (const c of [C.A2, C.B]) { await grant(TK.raiser, TK_ROLE.raiser, c); }
  await grant(TK.l1, TK_ROLE.level1, C.A2);
  const [alpha, beta, gamma] = [await makeType("ALPHA", "HIGH"), await makeType("BETA", "LOW"), await makeType("GAMMA", "MEDIUM")];
  const a = [await raiseAt(alpha, C.A), await raiseAt(alpha, C.A), await raiseAt(alpha, C.A)];
  const a2 = await raiseAt(alpha, C.A2), b1 = await raiseAt(beta, C.A), g = await raiseAt(gamma, C.B);
  await act(tok("l1"), { ticketId: a[0]!, action: "approve", seenVersion: await version(a[0]!) });
  await act(tok("l1"), { ticketId: a[1]!, action: "reject", seenVersion: await version(a[1]!), remarks: "no" });
  await act(tok("l1"), { ticketId: a[2]!, action: "forward", seenVersion: await version(a[2]!), forwardTo: TK.fwd }); // counts as forwarded
  await setStepUp(tok("admin"), 0);
  await reassign(tok("admin"), { ticketId: b1, seenVersion: await version(b1), toUserId: TK.fwd }); // an admin reassign: not forwarded
  return { alpha, beta, gamma, a, a2, b1, g };
}

describe("T-TM ticket management view", () => {
  test("T-TM-001 KPIs, summary and list agree under every filter; all within the tickets the user may view", async () => {
    const s = await seed();
    await grant(TK.reviewer, TK_ROLE.reviewer, C.A2); // the viewer: ticket.view at A and A2 (region 1), not B
    const V = tok("reviewer");
    const ids = async (f: TicketFilter) => (await listTickets(V, f)).rows.map((r) => r.id).sort();
    const sum = (f: TicketFilter) => ticketSummary(V, f);
    // no filter: A and A2 only
    expect(await ids({})).toEqual([...s.a, s.a2, s.b1].sort());
    expect((await sum({})).kpi).toEqual({ total: 5, open: 3, approved: 1, rejected: 1, forwarded: 1 });
    expect((await sum({})).byType.map((t) => [t.code, t.open, t.approved, t.rejected, t.forwarded, t.total]))
      .toEqual([["ALPHA", 2, 1, 1, 1, 4], ["BETA", 1, 0, 0, 0, 1]]);
    const row = (await listTickets(V, {})).rows.find((r) => r.id === s.a2)!;
    expect([row.areaName, row.regionCode]).toEqual(["A2", "R1"]);
    // each filter, with the KPIs and the list in agreement; the tiles follow the status filter too (D6)
    const cases: [TicketFilter, string[]][] = [
      [{ status: "OPEN" }, [s.a[2]!, s.a2, s.b1]], [{ status: "APPROVED" }, [s.a[0]!]], [{ priority: "LOW" }, [s.b1]],
      [{ type: String(s.alpha) }, [...s.a, s.a2]], [{ centre: String(C.A2) }, [s.a2]], [{ area: "1" }, [...s.a, s.b1]],
      [{ area: "2" }, [s.a2]], [{ region: "1" }, [...s.a, s.a2, s.b1]], [{ region: "2" }, []],
      [{ status: "OPEN", type: String(s.alpha), centre: String(C.A) }, [s.a[2]!]],
    ];
    for (const [f, want] of cases) {
      expect(await ids(f), JSON.stringify(f)).toEqual([...want].sort());
      expect((await sum(f)).kpi.total, JSON.stringify(f)).toBe(want.length);
    }
    expect((await sum({ status: "OPEN" })).kpi).toMatchObject({ approved: 0, rejected: 0, open: 3 });
    // dates are IST days: 2026-10-01 18:40 UTC is 2026-10-02 00:10 IST
    await backdate(s.a[0]!, "2026-10-01T18:40:00Z");
    await backdate(s.a[1]!, "2026-10-01T18:20:00Z"); // 23:50 IST on 2026-10-01
    expect(await ids({ from: "2026-10-02", to: "2026-10-02" })).toEqual([s.a[0]!]);
    expect(await ids({ from: "2026-10-01", to: "2026-10-01" })).toEqual([s.a[1]!]);
    expect(await ids({ to: "2026-10-01" })).toEqual([s.a[1]!]);
    expect((await sum({ from: "2026-10-01", to: "2026-10-02" })).kpi.total).toBe(2);
    // number prefix, ignoring case
    const n = await numberOf(s.a2);
    expect(await ids({ number: n.toLowerCase() })).toEqual([s.a2]);
    expect(await ids({ number: n.slice(0, 5) })).toEqual([...s.a, s.a2, s.b1].sort());
    expect(await ids({ number: n.slice(3) })).toEqual([]); // a prefix, not "contains"
    // the pickers: only the viewer's centres and types; B's centre and GAMMA are absent (R10)
    const o = await ticketFilterOptions(V);
    expect(o.centres.map((c) => c.code)).toEqual(["KL2-25", "KL3-07"]);
    expect(o.types.map((t) => t.code)).toEqual(["ALPHA", "BETA"]);
    expect(o.regions.map((r) => r.code)).toEqual(["R1"]);
    expect(o.areas.map((a) => a.label)).toEqual(["R1 / A1", "R1 / A2"]);
    // another user: TK.b (level 1 at B) sees only B's ticket and GAMMA; TK.l1's counts agree with its list
    expect((await listTickets(tok("b"))).rows.map((r) => r.id)).toEqual([s.g]);
    expect((await ticketSummary(tok("b"))).byType.map((t) => t.code)).toEqual(["GAMMA"]);
    expect((await ticketFilterOptions(tok("b"))).types.map((t) => t.code)).toEqual(["GAMMA"]);
    expect((await ticketSummary(tok("l1"))).kpi.total).toBe((await listTickets(tok("l1"))).rows.length);
    // a forward later approved no longer counts as forwarded (open only)
    await act(tok("fwd"), { ticketId: s.a[2]!, action: "approve", seenVersion: await version(s.a[2]!) });
    expect((await sum({})).kpi.forwarded).toBe(0);
  });

  test("T-TM-002 invalid filters match nothing, never error or widen", async () => {
    const s = await seed();
    const V = tok("reviewer");
    const empty = { kpi: { total: 0, open: 0, approved: 0, rejected: 0, forwarded: 0 }, byType: [] };
    const bad: TicketFilter[] = [{ status: "NOPE" }, { priority: "CRITICAL" }, { type: "abc" }, { centre: "1e3" }, { area: " 1" },
      { region: "-1" }, { from: "2026-02-30" }, { to: "28/10/2026" }, { number: "x".repeat(41) }, { status: ["OPEN", "APPROVED"] },
      { from: "2026-10-03", to: "2026-10-02" }];
    for (const f of bad) {
      expect((await listTickets(V, f)).rows, JSON.stringify(f)).toEqual([]);
      expect(await ticketSummary(V, f), JSON.stringify(f)).toEqual(empty);
    }
    expect(await listTickets(V, { cursor: "junk" })).toEqual({ rows: [], next: null });
    expect(await listTickets(V, { cursor: ["a", "b"] })).toEqual({ rows: [], next: null });
    // "" means not given (R4); wildcards in the number are literal (R12)
    expect((await listTickets(V, { status: "", type: "" })).rows).toHaveLength(4);
    expect((await listTickets(V, { number: "TK_26" })).rows).toEqual([]);
    expect((await listTickets(V, { number: "%" })).rows).toEqual([]);
    expect((await listTickets(V, { number: "TK-26" })).rows).toHaveLength(4);
    void s;
  });

  test("T-TM-003 app.visible_ticket_ids() is exactly ticket_may_view, for every kind of viewer", async () => {
    const s = await seed();
    // every branch present: a named-user and a role type viewer, a named approver, a forward target, a raiser
    await asAdmin(async (db) => {
      await db.query(`insert into app.ticket_type_viewer (type_id, user_id, role_id) values ($1, $2, null), ($3, null, $4)`,
        [s.beta, TK.viewer, s.gamma, TK_ROLE.member]);
      await db.query(`update app.ticket_level set approver_role_id = null, approver_user_id = $1 where ticket_id = $2`, [TK.l2, s.a2]);
    });
    await grant(TK.viewer, TK_ROLE.member, C.B); // member at B: the role viewer of GAMMA there
    for (const name of Object.keys(TK) as (keyof typeof TK)[]) {
      const [viaSet, viaRow] = await withScope(tok(name), async (tx) => [
        (await tx.$queryRaw<{ id: string }[]>`select id::text from app.visible_ticket_ids() id order by 1`).map((r) => r.id),
        (await tx.$queryRaw<{ id: string }[]>`select id::text from app.ticket t where app.ticket_may_view(t.id) order by 1`).map((r) => r.id),
      ]);
      expect(viaSet, name).toEqual(viaRow);
    }
    // not vacuous: the branches are hit
    const seen = async (name: keyof typeof TK) => withScope(tok(name), async (tx) =>
      (await tx.$queryRaw<{ id: string }[]>`select id::text from app.visible_ticket_ids() id`).map((r) => r.id).sort());
    expect(await seen("viewer")).toEqual([s.b1, s.g].sort()); // a named viewer at A, a role viewer at B
    expect(await seen("fwd")).toContain(s.a[2]!); // a forward target
    expect(await seen("b")).toEqual([s.g]);
  });
});
