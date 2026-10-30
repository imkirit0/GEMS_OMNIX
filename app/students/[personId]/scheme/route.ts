import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { assignScheme } from "@/server/concessions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Assign a fee scheme to one registration of this learner (docs/designs/fee-schemes G2). Another learner's or an unseen one: 404.
async function handle(req: Request, { params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  if (!UUID.test(personId)) return new Response("Not found", { status: 404 });
  const self = `/students/${personId}`;
  return adminPost(req, self, async (session, f) => {
    await assignScheme(session, personId, f["registrationId"] ?? "", Number(f["schemeId"]));
    return `${self}?saved=1`;
  });
}
export const POST = safeRoute(handle);
