import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createRole } from "@/server/rbac";

export const POST = safeRoute(async (req: Request) => adminPost(req, "/admin/roles", async (session, f) =>
  `/admin/roles/${await createRole(session, { key: f["key"] ?? "", name: f["name"] ?? "" })}`));
