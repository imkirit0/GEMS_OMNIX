import { adminPost } from "@/server/admin-http";
import { createUser } from "@/server/rbac";

export const POST = (req: Request) => adminPost(req, "/admin/users", async (session, f) =>
  `/admin/users/${await createUser(session, { login: f["login"] ?? "", displayName: f["displayName"] ?? "" })}?created=1`);
