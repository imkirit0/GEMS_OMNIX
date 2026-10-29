import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createCertification, setCertificationActive, updateCertification } from "@/server/catalogue";
import { RbacError } from "@/server/rbac";
import { flag } from "../../masters/slugs";

export const POST = safeRoute(async (req: Request) => adminPost(req, "/admin/catalogue/certifications", async (session, f) => {
  switch (f["op"]) {
    case "create": // a blank description is null (ownText)
      await createCertification(session, { code: f["code"] ?? "", name: f["name"] ?? "", type: f["type"] ?? "", description: f["description"] ?? null });
      break;
    case "update":
      await updateCertification(session, Number(f["id"]), { name: f["name"] ?? "", type: f["type"] ?? "", description: f["description"] ?? null });
      break;
    case "active":
      await setCertificationActive(session, Number(f["id"]), flag("active", f["active"]), f["reason"] ?? "");
      break;
    default:
      throw new RbacError("invalid", "unknown operation");
  }
  return "/admin/catalogue/certifications?saved=1";
}));
