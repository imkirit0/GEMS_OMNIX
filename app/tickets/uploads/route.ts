// Upload request (DD-6): same-origin JSON POST that returns a signed upload URL for one file.
// adminPost is form-only, so this follows app/export/[dataset]/route.ts. No upload is possible until a live
// ticket type needs documents (DD-16).
import { Forbidden } from "@/server/action";
import { readCookie, sameOrigin, SESSION_COOKIE } from "@/server/auth/http";
import { ScopeError } from "@/server/db";
import { safeRoute } from "@/server/safe-route";
import { requestUpload } from "@/server/tickets/engine";
import { TicketError } from "@/server/tickets/handlers";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function handle(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const session = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!session) return json({ error: "session" }, 401);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return json(await requestUpload(session, {
      typeId: Number(b["typeId"]), centreId: Number(b["centreId"]), fileName: String(b["fileName"] ?? ""),
      size: Number(b["size"]), contentType: String(b["contentType"] ?? ""),
    }));
  } catch (e) {
    if (e instanceof TicketError) return json({ error: e.reason }, 400);
    if (e instanceof Forbidden) return json({ error: "forbidden" }, 403);
    if (e instanceof ScopeError) return json({ error: "session" }, 401);
    throw e;
  }
}

export const POST = safeRoute(handle);
