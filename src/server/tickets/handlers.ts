// Ticket handler contract and registry (ticket-engine design §Handler contract, DD-2, DD-7).
// A handler is the domain half of a ticket type: it checks the request at raise, re-checks it at the last-level
// approval and applies it, all inside the engine's transaction. Handlers do database work only, through tx.
import type { Tx } from "../db";
// Static on purpose: test-handler.ts imports TicketError back, which is safe because it uses it only inside
// its functions. Importing the module registers nothing; only the flag below does.
import { testCounter } from "./test-handler";

export type TicketRow<P> = {
  id: string; number: string; typeId: number; centreId: number; raisedBy: string; status: string;
  currentLevel: number; levelCount: number; assignedUserId: string | null; payload: P; reraiseOf: string | null;
  version: number; createdAt: Date;
};

export type TicketField = { name: string; label: string; kind: "text" | "number" | "date" };

export type TicketHandler<P> = {
  key: string;
  fields: TicketField[]; // what the raise form shows, as inputs named p.<name>
  parse(payload: Record<string, string>): P; // throws TicketError("invalid")
  validate(tx: Tx, t: { centreId: number; payload: P }): Promise<void>; // at raise
  revalidate?(tx: Tx, t: TicketRow<P>): Promise<void>; // at the last-level approval, after the row lock; defaults to validate
  apply(tx: Tx, t: TicketRow<P>): Promise<{ before: unknown; after: unknown }>; // the domain change, at most once
  staleMessages: Record<string, string>; // fixed texts revalidate may refuse with, by key
};

export type TicketReason = "invalid" | "stale" | "conflict" | "document" | "inactive";

export class TicketError extends Error {
  override name = "TicketError";
  constructor(readonly reason: TicketReason, message: string = reason) { super(message); }
}
/** Missing, out of scope, or not viewable: callers answer 404, the same for all three. */
export class TicketNotFound extends Error {
  override name = "TicketNotFound";
}
/** A raise whose ticket id already exists (double submit): callers redirect to it. */
export class TicketDuplicate extends Error {
  override name = "TicketDuplicate";
  constructor(readonly id: string) { super("ticket already raised"); }
}
/** handler.apply threw: audited as FAILED ticket.apply_failed. The cause's message is never audited. */
export class ApplyFailed extends Error {
  override name = "ApplyFailed";
  constructor(readonly level: number, override readonly cause: unknown) { super("ticket change failed"); }
}

// Empty in production: no ticket type can be activated until a domain module registers its handler.
export const HANDLERS: Record<string, TicketHandler<unknown>> = {};

// Manual Supabase run only (DD-7). Never on a Vercel deployment.
if (process.env["TICKET_TEST_HANDLER"] === "1") {
  if (process.env["VERCEL_ENV"]) throw new Error("TICKET_TEST_HANDLER must not be set on a Vercel deployment");
  HANDLERS[testCounter.key] = testCounter as TicketHandler<unknown>;
}
