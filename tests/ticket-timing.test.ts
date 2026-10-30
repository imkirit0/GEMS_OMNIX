// One-off timing run for the ticket management view (ticket-management design, Cost; R7). Skipped unless TICKET_TIMING=1.
// Seeds ~16.5k tickets (the legacy volume) as the owner and times ticketSummary and ticketFilterOptions for an ALL-scope
// viewer, median of 5 runs, against the 500 ms budget (PMC). Prints the plan of the summary query as gems_app.
import { beforeAll, describe, expect, test } from "vitest";
import { withScope } from "../src/server/db";
import fs from "node:fs";
import { approvalQueue, bulkAct, listTickets, queueCards, ticketFilterOptions, ticketSummary } from "../src/server/tickets/engine";
import { HANDLERS, type TicketHandler } from "../src/server/tickets/handlers";
import { testCounter } from "../src/server/tickets/test-handler";
import { asAdmin, reset, TK, TK_ROLE, tkToken } from "./fixtures";

const N = 16542;
describe.skipIf(!process.env["TICKET_TIMING"])("ticket management view timing", () => {
  beforeAll(async () => {
    await asAdmin((db) => db.query(fs.readFileSync("tests/sql/ticket-test-handler.sql", "utf8")));
    HANDLERS[testCounter.key] = testCounter as TicketHandler<unknown>;
    await reset();
    await asAdmin(async (db) => {
      await db.query("set session_replication_role = replica"); // the seed bypasses the engine's guards, as an import would
      const cat = (await db.query(`insert into app.ticket_category (name) values ('Perf') returning id`)).rows[0].id;
      const type = (await db.query(`insert into app.ticket_type (code, name, category_id, handler_key, number_prefix, active)
        values ('PRF', 'Perf', $1, 'test.counter', 'TK-26', true) returning id`, [cat])).rows[0].id;
      await db.query(`insert into app.ticket_type_level values ($1, 1, null, $2)`, [type, TK_ROLE.level1]);
      await db.query(`insert into app.ticket (id, number, type_id, centre_id, raised_by, level_count, payload, created_at)
        select gen_random_uuid(), 'TK-26/PRF/' || g, $1, (array[1, 2, 3])[1 + g % 3], $2, 1, jsonb_build_object('key', 'perf' || g), now() - g * interval '20 minutes'
        from generate_series(1, $3::int) g`, [type, TK.raiser, N]);
      await db.query(`insert into app.ticket_level (ticket_id, centre_id, level, approver_role_id) select id, centre_id, 1, $1 from app.ticket`, [TK_ROLE.level1]);
      await db.query(`insert into app.ticket_event (ticket_id, centre_id, actor_id, action, level) select id, centre_id, raised_by, 'RAISE', 1 from app.ticket`);
      await db.query(`update app.ticket set status = 'APPROVED', closed_at = now(), version = 2 where id in (select id from app.ticket order by id limit 14011)`);
      await db.query(`update app.ticket set status = 'REJECTED', closed_at = now(), version = 2 where status = 'OPEN' and id in
        (select id from app.ticket where status = 'OPEN' order by id limit 119)`);
      await db.query("set session_replication_role = origin");
      await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind) values ($1, $2, 'ALL')`, [TK.reviewer, TK_ROLE.reviewer]);
      await db.query("analyze app.ticket; analyze app.ticket_event; analyze app.ticket_level");
    });
  }, 120_000);

  test("summary and options within budget for an ALL-scope viewer", async () => {
    const V = tkToken("reviewer");
    const time = async (f: () => Promise<unknown>) => {
      const ms: number[] = [];
      for (let i = 0; i < 5; i++) { const t0 = performance.now(); await f(); ms.push(performance.now() - t0); }
      return ms.sort((a, b) => a - b)[2]!;
    };
    const s = await ticketSummary(V);
    expect(s.kpi.total).toBe(N);
    const [summary, options, list] = [await time(() => ticketSummary(V)), await time(() => ticketFilterOptions(V)), await time(() => listTickets(V))];
    const plan = await withScope(V, (tx) => tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`explain (analyze, buffers) select t.type_id, count(*)
      from app.ticket t join app.ticket_type ty on ty.id = t.type_id join app.centre c on c.id = t.centre_id
      join app.area a on a.id = c.area_id join app.region r on r.id = a.region_id where t.id in (select app.visible_ticket_ids()) group by t.type_id`));
    console.log(JSON.stringify({ tickets: N, medianMs: { summary: Math.round(summary), options: Math.round(options), list: Math.round(list) } }));
    console.log(plan.map((r) => r["QUERY PLAN"]).join("\n"));
    expect(summary).toBeLessThan(500);
    expect(options).toBeLessThan(500);
  }, 120_000);

  // the former slow path: no ticket.view (TK.viewer: no permissions at A), 13 s with the per-row definer
  test("a user without ticket.view", async () => {
    const V = tkToken("viewer");
    const ms: number[] = [];
    for (let i = 0; i < 3; i++) { const t0 = performance.now(); await ticketSummary(V); ms.push(performance.now() - t0); }
    const median = ms.sort((a, b) => a - b)[1]!;
    console.log(JSON.stringify({ perRowPath: { summaryMs: Math.round(median), rowsAtCentreA: Math.ceil(N / 3) } }));
    expect(median).toBeLessThan(500);
  }, 120_000);

  // the approver's page reads, the queue and its cards (I3), for an active approver and for one who may act on almost
  // nothing (4.1 s with the per-row ticket_may_act); then a 50-ticket bulk approve (D2)
  test("approvals page reads and a 50-ticket bulk approve", async () => {
    const page = async (t: string) => {
      const ms: number[] = [];
      for (let i = 0; i < 3; i++) { const t0 = performance.now(); await Promise.all([approvalQueue(t), queueCards(t)]); ms.push(performance.now() - t0); }
      return Math.round(ms.sort((a, b) => a - b)[1]!);
    };
    const [active, idle] = [await page(tkToken("l1")), await page(tkToken("reviewer"))];
    const { rows } = await approvalQueue(tkToken("l1"));
    const items = rows.slice(0, 50).map((r) => ({ ticketId: r.id, seenVersion: r.version }));
    const t0 = performance.now();
    const res = await bulkAct(tkToken("l1"), { action: "approve", items });
    const bulkMs = Math.round(performance.now() - t0);
    console.log(JSON.stringify({ approvalsPageMs: { activeApprover: active, idleApprover: idle }, bulk50Ms: bulkMs, bulk: res }));
    expect(res.done).toBe(50);
    expect(active).toBeLessThan(500);
    expect(idle).toBeLessThan(500);
    expect(bulkMs).toBeLessThan(10_000);
  }, 120_000);
});
