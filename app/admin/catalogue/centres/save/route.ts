import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { setCentreClass } from "@/server/catalogue";
import { RbacError } from "@/server/rbac";

export const POST = safeRoute(async (req: Request) => adminPost(req, "/admin/catalogue/centres", async (session, f) => {
  if (f["op"] !== "class") throw new RbacError("invalid", "unknown operation");
  const classId = f["classId"] ?? "";
  await setCentreClass(session, Number(f["centreId"]), classId === "" ? null : Number(classId), f["reason"] ?? "");
  return "/admin/catalogue/centres?saved=1";
}));
