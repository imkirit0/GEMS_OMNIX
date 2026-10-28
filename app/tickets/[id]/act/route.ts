import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { act } from "@/server/tickets/engine";

async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const self = `/tickets/${encodeURIComponent(id)}`;
  return adminPost(req, self, async (session, f) => {
    await act(session, {
      ticketId: id, action: f["action"] as "approve" | "reject" | "forward", seenVersion: Number(f["seenVersion"]),
      remarks: f["remarks"] || undefined, forwardTo: f["forwardTo"] || undefined,
    });
    return self;
  });
}

export const POST = safeRoute(handle);
