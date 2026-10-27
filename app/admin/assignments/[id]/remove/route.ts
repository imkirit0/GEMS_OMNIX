import { safeRoute } from "@/server/safe-route";
import { adminPost, safeNext } from "@/server/admin-http";
import { removeAssignment } from "@/server/rbac";

async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = safeNext(new URL(req.url).searchParams.get("back"), "/admin/users");
  return adminPost(req, back, async (session) => `/admin/users/${await removeAssignment(session, Number(id))}`);
}

export const POST = safeRoute(handle);
