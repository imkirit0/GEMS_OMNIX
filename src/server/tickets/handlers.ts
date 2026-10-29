// Ticket handler contract and registry (ticket-engine design §Handler contract, DD-2, DD-7).
// A handler is the domain half of a ticket type: it checks the request at raise, re-checks it at the last-level
// approval and applies it, all inside the engine's transaction. Handlers do database work only, through tx.
import type { Tx } from "../db";
// Handler modules import their errors from errors.ts (no imports), so there is no cycle with this registry.
import { IDENTITY_HANDLERS } from "./identity-handlers";
import { testCounter } from "./test-handler";

export type TicketRow<P> = {
  id: string; number: string; typeId: number; centreId: number; raisedBy: string; status: string;
  currentLevel: number; levelCount: number; assignedUserId: string | null; payload: P; reraiseOf: string | null;
  version: number; createdAt: Date;
};

export type TicketField =
  | { name: string; label: string; kind: "text" | "number" | "date" }
  | { name: string; label: string; kind: "select"; options: [string, string][] }; // <select name="p.<name>" required>

export type TicketHandler<P, R = P> = {
  key: string;
  fields: TicketField[]; // what the raise form shows, as inputs named p.<name>
  parse(payload: Record<string, string>): R; // throws TicketError("invalid", key)
  // correction-tickets DD-4: resolves and enriches the parsed request in the raise transaction; its result is stored
  prepare?(tx: Tx, t: { centreId: number; payload: R; source?: P }): Promise<P>;
  validate(tx: Tx, t: { centreId: number; payload: P }): Promise<void>; // at raise
  revalidate?(tx: Tx, t: TicketRow<P>): Promise<void>; // at the last-level approval, after the row lock; defaults to validate
  apply(tx: Tx, t: TicketRow<P>): Promise<{ before: unknown; after: unknown }>; // the domain change, at most once
  // DD-6: lines shown to those who may act (audited by ticketReview), and the request as label/value rows
  review?(tx: Tx, t: { centreId: number; payload: P }): Promise<{ lines: string[]; matches: string[] }>;
  describe?(payload: P): [string, string][];
  invalidMessages?: Record<string, string>; // DD-12: user texts for TicketError("invalid", key)
  valuesPermission?: string; // DD-16: who does not act needs this at the ticket's centre to see the payload
  staleMessages: Record<string, string>; // fixed texts revalidate may refuse with, by key
};

export * from "./errors";

// The registered domain handlers, in every environment: the identity corrections (docs/designs/correction-tickets).
// A type still cannot be switched on before the go-live gates open (policy.ts TICKET_GATES).
export const HANDLERS: Record<string, TicketHandler<unknown>> = {};
for (const h of IDENTITY_HANDLERS) HANDLERS[h.key] = h as unknown as TicketHandler<unknown>;

// Manual Supabase run only (DD-7). Never on a Vercel deployment.
if (process.env["TICKET_TEST_HANDLER"] === "1") {
  if (process.env["VERCEL_ENV"]) throw new Error("TICKET_TEST_HANDLER must not be set on a Vercel deployment");
  HANDLERS[testCounter.key] = testCounter as TicketHandler<unknown>;
}
