import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createDues } from "@/server/dues";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Create one registration's fee dues (docs/designs/fee-dues). Another person's or an unseen registration: 404 (G4).
async function handle(req: Request, { params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  if (!UUID.test(personId)) return new Response("Not found", { status: 404 });
  const self = `/students/${personId}`;
  return adminPost(req, self, async (session, f) => {
    await createDues(session, personId, f["registrationId"] ?? "");
    return `${self}?saved=1`;
  });
}
export const POST = safeRoute(handle);
