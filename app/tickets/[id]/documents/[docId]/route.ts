// Document download: a same-origin form POST, like export downloads (a cross-site GET could otherwise write
// audit rows in the victim's name). Answers 303 to a 60-second signed URL (CSP form-action allows the storage origin).
import { Forbidden } from "@/server/action";
import { forbidden, readCookie, sameOrigin, seeOther, SESSION_COOKIE } from "@/server/auth/http";
import { ScopeError } from "@/server/db";
import { safeRoute } from "@/server/safe-route";
import { documentLink } from "@/server/tickets/engine";
import { TicketNotFound } from "@/server/tickets/handlers";

async function handle(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const session = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!session) return seeOther(req, "/login");
  const { id, docId } = await params;
  try {
    return seeOther(req, await documentLink(session, id, Number(docId)));
  } catch (e) {
    if (e instanceof TicketNotFound) return new Response("Not found", { status: 404 }); // missing, hidden, or not on this ticket
    if (e instanceof Forbidden) return seeOther(req, `/tickets/${encodeURIComponent(id)}?error=forbidden`);
    if (e instanceof ScopeError) return seeOther(req, "/login?error=expired");
    throw e;
  }
}

export const POST = safeRoute(handle);
