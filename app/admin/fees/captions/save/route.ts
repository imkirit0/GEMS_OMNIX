import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createCaption, setCaptionActive, updateCaption } from "@/server/fees";
import { RbacError } from "@/server/rbac";
import { flag } from "../../../catalogue/masters/slugs";

const back = (f: Record<string, string>) => (/^\d{4}-\d{2}$/.test(f["academicYear"] ?? "") ? `/admin/fees/captions?year=${f["academicYear"]}` : "/admin/fees/captions");
export const POST = safeRoute(async (req: Request) => adminPost(req, back, async (session, f) => {
  const fields = { name: f["name"] ?? "", dueOn: f["dueOn"] ?? "", sortOrder: Number(f["sortOrder"]) };
  switch (f["op"]) {
    case "create": await createCaption(session, { academicYear: f["academicYear"] ?? "", ...fields }); break;
    case "update": await updateCaption(session, Number(f["id"]), fields); break;
    case "active": await setCaptionActive(session, Number(f["id"]), flag("active", f["active"]), f["reason"] ?? ""); break;
    default: throw new RbacError("invalid", "op: unknown");
  }
  const b = back(f);
  return `${b}${b.includes("?") ? "&" : "?"}saved=1`;
}));
