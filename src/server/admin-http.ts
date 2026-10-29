// Shared plumbing for admin form POSTs: same-origin, session cookie, and one error mapping.
import { Forbidden } from "./action";
import { ScopeError } from "./db";
import { forbidden, readCookie, sameOrigin, seeOther, SESSION_COOKIE } from "./auth/http";
import { RbacError, StepUpRequired } from "./rbac";
import { TicketDuplicate, TicketError, TicketNotFound } from "./tickets/handlers";

/** Only same-site relative paths: blocks open redirects such as //evil.example or /\evil.example. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  return typeof next === "string" && /^\/(?![\/\\])/.test(next) ? next : fallback;
}

const withError = (path: string, code: string) => `${path}${path.includes("?") ? "&" : "?"}error=${code}`;

/**
 * Runs an admin action for a form POST. `back` is where to return (and where errors are shown), or a function of
 * the posted fields when that path depends on them (the request body can be read only once);
 * the action returns the path to go to on success.
 */
export async function adminPost(req: Request, backTo: string | ((fields: Record<string, string>) => string),
  action: (session: string, fields: Record<string, string>, data: FormData) => Promise<string>): Promise<Response> {
  if (!sameOrigin(req)) return forbidden();
  const session = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!session) return seeOther(req, "/login");
  const data = await req.formData();
  const fields = Object.fromEntries([...data.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  const back = typeof backTo === "string" ? backTo : safeNext(backTo(fields));
  try {
    return seeOther(req, await action(session, fields, data));
  } catch (e) {
    if (e instanceof StepUpRequired) return seeOther(req, `/stepup?next=${encodeURIComponent(back)}`);
    if (e instanceof Forbidden) return seeOther(req, withError(back, "forbidden"));
    if (e instanceof RbacError) {
      // "<field>: <rule>" names the field, which a page may label (course-master I8); never the rule text itself
      const field = e.reason === "invalid" ? /^([A-Za-z]+):/.exec(e.message)?.[1] : undefined;
      return seeOther(req, withError(back, e.key ?? e.reason) + (field ? `&detail=${field}` : ""));
    }
    if (e instanceof TicketError) {
      const to = withError(back, `ticket.${e.reason}`);
      // the page looks a detail up in the handlers' fixed lists only, never shows it as such (DD-12)
      return seeOther(req, e.reason === "stale" || e.reason === "invalid" ? `${to}&detail=${encodeURIComponent(e.message)}` : to);
    }
    if (e instanceof TicketNotFound) return new Response("Not found", { status: 404 }); // same as a missing ticket
    if (e instanceof TicketDuplicate) return seeOther(req, `/tickets/${e.id}`);
    if (e instanceof ScopeError) return seeOther(req, "/login?error=expired");
    throw e;
  }
}

export const ADMIN_MESSAGES: Record<string, string> = {
  forbidden: "You are not allowed to do that.",
  "rbac.forbidden": "You can only grant roles where you hold every one of their permissions.",
  "ticket.invalid": "Some values were missing or not allowed. Check the form and try again.",
  "ticket.document": "A document is missing, too large, of a type that is not allowed, or already used.",
  "ticket.inactive": "This ticket type is switched off.",
  "ticket.stale": "The request no longer matches the current data.",
  "ticket.conflict": "This ticket changed since you opened it.",
  "ticket.setup.handler": "The handler can change only while the type is off and has no open tickets.",
  "ticket.setup.prefix": "The prefix and code would make ticket numbers too long.",
  "ticket.setup.levels": "Levels must run 1, 2, 3… with no gaps, at most 4.",
  "ticket.setup.activate": "The type needs a registered handler and valid levels before it can be switched on.",
  "ticket.setup.duplicate": "A ticket type with that code already exists.",
  "ticket.setup.numbering": "Ticket types cannot be switched on until the ticket numbering policy is signed and its counter is set.",
  "ticket.setup.storage": "A type that needs documents cannot be switched on until document storage is approved (ADR-002) and its safeguards are in place.",
  "catalogue.duplicate": "A course with that code already exists.",
  duplicate: "That login or key already exists.",
  notfound: "Not found.",
  invalid: "Some values were invalid. Check the scope fields.",
};
