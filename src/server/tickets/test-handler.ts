// The test-only ticket handler (DD-2). Its domain table is app.test_ticket_counter (tests/sql/ticket-test-handler.sql).
// Used by tests/tickets.test.ts and by the manual Supabase run; never registered in production.
import { TicketError, type TicketHandler } from "./handlers";

export type CounterPayload = { key: string; failApply: boolean; failRevalidate: boolean };

const refuseIfStale = (p: CounterPayload) => {
  if (p.failRevalidate) throw new TicketError("stale", "test");
};

export const testCounter: TicketHandler<CounterPayload> = {
  key: "test.counter",
  fields: [
    { name: "key", label: "Counter key", kind: "text" },
    { name: "failApply", label: "Fail in apply (1 = yes)", kind: "text" },
    { name: "failRevalidate", label: "Refuse at final approval (1 = yes)", kind: "text" },
  ],
  parse(p) {
    const key = (p["key"] ?? "").trim();
    if (key.length < 1 || key.length > 40) throw new TicketError("invalid", "key must be 1 to 40 characters");
    return { key, failApply: p["failApply"] === "1", failRevalidate: p["failRevalidate"] === "1" };
  },
  async validate() {},
  async revalidate(_tx, t) { refuseIfStale(t.payload); },
  async apply(tx, t) {
    const [row] = await tx.$queryRaw<{ value: number }[]>`
      insert into app.test_ticket_counter (key, value) values (${t.payload.key}, 1)
      on conflict (key) do update set value = test_ticket_counter.value + 1 returning value`;
    if (t.payload.failApply) throw new Error("test.counter was told to fail");
    return { before: { value: row!.value - 1 }, after: { value: row!.value } };
  },
  staleMessages: { test: "Test refusal" },
};
