// Shared plumbing for admin form POSTs: same-origin, session cookie, and one error mapping.
import { Forbidden } from "./action";
import { ScopeError } from "./db";
import { PersonError } from "./person-rules";
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
    if (e instanceof PersonError && e.reason === "notfound") return new Response("Not found", { status: 404 }); // fee dues R1
    if (e instanceof TicketDuplicate) return seeOther(req, `/tickets/${e.id}`);
    if (e instanceof ScopeError) return seeOther(req, "/login?error=expired");
    throw e;
  }
}

export const ADMIN_MESSAGES: Record<string, string> = {
  forbidden: "You are not allowed to do that.",
  "fee.dues.exists": "This course already has its dues.",
  "fee.dues.noplan": "No published fee plan prices this course at this centre for that year.",
  "fee.dues.mismatch": "The dues did not match the fee plan; nothing was saved.",
  "fee.receipt.closed": "Fee collection is not switched on yet.",
  "fee.receipt.nothing": "Nothing is outstanding for this course.",
  "fee.receipt.over": "The amount is more than what is outstanding.",
  "fee.receipt.noseries": "The receipt series is not set up for this centre; ask head office.",
  "fee.receipt.gst": "The centre's GST details are incomplete; ask head office.",
  "fee.receipt.mismatch": "The receipt did not match the dues; nothing was saved.",
  "fee.receipt.late": "This receipt is not from today; ask for a cancellation ticket.",
  "fee.receipt.cancelled": "This receipt is cancelled.",
  "fee.receipt.held": "Some dues are on hold; only the amount shown as Collectable now can be collected.",
  "fee.hold.state": "This due is already on hold, or is not on hold.",
  "fee.hold.paid": "Nothing is owed on this due.",
  "fee.hold.mismatch": "The due did not match; nothing was saved.",
  "fee.receipt.noaccount": "A fee type on this receipt has no ledger account; ask head office.",
  "fee.account": "That account cannot take fees (it must be an active income or liability account).",
  "fee.receipt.adhocplan": "That fee type is on the learner's fee plan; collect it against the dues.",
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
  "catalogue.duplicate": "A record with that code already exists.",
  "org.centre.duplicate": "A centre with that code already exists.",
  "org.region.duplicate": "A region with that code already exists.",
  "org.area.duplicate": "That region already has an area with that name.",
  "org.centre.checklist": "Set the centre's class and complete its GST details before activating it.",
  "fee.duplicate": "A record with that code or name already exists.",
  "fee.plan.locked": "This plan is published and cannot change; create a new version.",
  "fee.caption.locked": "This instalment is used by a published plan; its due date cannot change.",
  "fee.plan.empty": "Add at least one line before publishing.",
  "fee.plan.inactive": "A line uses an inactive fee type or instalment.",
  "fee.plan.offering": "This course is not offered for that class or centre.",
  "batch.duplicate": "That centre already has a batch with that code.",
  "enquiry.setup.keep": "This status cannot be switched off: it is the enrolled status or the last active one of its kind.",
  duplicate: "That login or key already exists.",
  notfound: "Not found.",
  invalid: "Some values were invalid. Check the scope fields.",
};
