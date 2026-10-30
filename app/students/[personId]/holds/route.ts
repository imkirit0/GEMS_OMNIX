import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { bad } from "@/server/catalogue";
import { setHold } from "@/server/holds";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hold or release one fee due of this learner (docs/designs/fee-holds). Another learner's or an unseen due: 404.
async function handle(req: Request, { params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  if (!UUID.test(personId)) return new Response("Not found", { status: 404 });
  const self = `/students/${personId}`;
  return adminPost(req, self, async (session, f) => {
    const action = f["action"];
    if (action !== "hold" && action !== "release") throw bad("action: hold or release");
    await setHold(session, personId, f["dueId"] ?? "", action === "hold", f["reason"] ?? "");
    return `${self}?saved=1`;
  });
}
export const POST = safeRoute(handle);
