import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createEnquiryStatus, setEnquiryStatusActive, updateEnquiryStatus } from "@/server/enquiry";
import { RbacError } from "@/server/rbac";
import { flag } from "../../../admin/catalogue/masters/slugs";

// Order: 0-1000 digits only, else NaN so the server gives "sortOrder: 0-1000" (R13).
const order = (s: string | undefined) => (/^\d{1,4}$/.test(s ?? "") ? Number(s) : NaN);

export const POST = safeRoute(async (req: Request) => adminPost(req, "/enquiries/statuses", async (session, f) => {
  switch (f["op"]) {
    case "create":
      await createEnquiryStatus(session, { code: f["code"] ?? "", name: f["name"] ?? "", kind: f["kind"] ?? "", colour: f["colour"] ?? "",
        sortOrder: order(f["sortOrder"]) });
      break;
    case "update":
      await updateEnquiryStatus(session, Number(f["id"]), { name: f["name"] ?? "", colour: f["colour"] ?? "", sortOrder: order(f["sortOrder"]) });
      break;
    case "active":
      await setEnquiryStatusActive(session, Number(f["id"]), flag("active", f["active"]), f["reason"] ?? "");
      break;
    default:
      throw new RbacError("invalid", "unknown operation");
  }
  return "/enquiries/statuses?saved=1";
}));
