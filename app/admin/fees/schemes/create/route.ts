import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createScheme } from "@/server/schemes";

export const POST = safeRoute(async (req: Request) => adminPost(req, "/admin/fees/schemes", async (session, f) => {
  const { id } = await createScheme(session, { code: f["code"] ?? "", name: f["name"] ?? "", validFrom: f["validFrom"] ?? "", validTo: f["validTo"] ?? "" });
  return `/admin/fees/schemes/${id}?saved=1`;
}));
