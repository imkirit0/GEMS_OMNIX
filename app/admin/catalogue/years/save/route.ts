import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { openAcademicYear, setAcademicYearOpen, updateAcademicYear } from "@/server/catalogue";
import { RbacError } from "@/server/rbac";
import { flag } from "../../masters/slugs";

export const POST = safeRoute(async (req: Request) => adminPost(req, "/admin/catalogue/years", async (session, f) => {
  switch (f["op"]) {
    case "create":
      await openAcademicYear(session, { code: f["code"] ?? "", startsOn: f["startsOn"] ?? "", endsOn: f["endsOn"] ?? "" });
      break;
    case "update":
      await updateAcademicYear(session, f["code"] ?? "", { startsOn: f["startsOn"], endsOn: f["endsOn"] });
      break;
    case "open":
      await setAcademicYearOpen(session, f["code"] ?? "", flag("open", f["open"]), f["reason"] ?? "");
      break;
    default:
      throw new RbacError("invalid", "unknown operation");
  }
  return "/admin/catalogue/years?saved=1";
}));
