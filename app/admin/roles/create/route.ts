import { adminPost } from "@/server/admin-http";
import { createRole } from "@/server/rbac";

export const POST = (req: Request) => adminPost(req, "/admin/roles", async (session, f) =>
  `/admin/roles/${await createRole(session, { key: f["key"] ?? "", name: f["name"] ?? "" })}`);
