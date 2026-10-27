import { adminPost } from "@/server/admin-http";
import { setUserStatus } from "@/server/rbac";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminPost(req, `/admin/users/${id}`, async (session, f) => {
    await setUserStatus(session, id, f["status"] === "ACTIVE" ? "ACTIVE" : "DISABLED");
    return `/admin/users/${id}`;
  });
}
