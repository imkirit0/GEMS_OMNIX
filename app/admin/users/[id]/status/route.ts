import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { setUserStatus } from "@/server/rbac";

async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminPost(req, `/admin/users/${id}`, async (session, f) => {
    await setUserStatus(session, id, f["status"] === "ACTIVE" ? "ACTIVE" : "DISABLED");
    return `/admin/users/${id}`;
  });
}

export const POST = safeRoute(handle);
