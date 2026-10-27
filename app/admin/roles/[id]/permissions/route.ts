import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { setRolePermissions } from "@/server/rbac";

async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminPost(req, `/admin/roles/${id}`, async (session, _fields, data) => {
    await setRolePermissions(session, Number(id), data.getAll("permission").map(String));
    return `/admin/roles/${id}?saved=1`;
  });
}

export const POST = safeRoute(handle);
