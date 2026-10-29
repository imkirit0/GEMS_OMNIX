// Ticket error classes (correction-tickets design, C10). No imports, so handler modules import this file and
// never handlers.ts at runtime (no import cycle with the registry). handlers.ts re-exports everything here.

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
