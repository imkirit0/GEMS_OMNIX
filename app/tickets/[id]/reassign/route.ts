import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { reassign } from "@/server/tickets/engine";

// Administrator reassign (DD-13): ticket.type.manage network-wide and a fresh step-up (adminPost sends to /stepup).
async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const self = `/tickets/${encodeURIComponent(id)}`;
  return adminPost(req, self, async (session, f) => {
    await reassign(session, { ticketId: id, seenVersion: Number(f["seenVersion"]), toUserId: f["toUserId"] ?? "" });
    return self;
  });
}

export const POST = safeRoute(handle);
