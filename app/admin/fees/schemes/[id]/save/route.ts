import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { approveScheme, deleteScheme, retireScheme, setSchemeCentres, setSchemeCourses, setSchemeRule, updateScheme } from "@/server/schemes";
import { RbacError } from "@/server/rbac";
import { ID } from "../../../labels";

async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) return new Response("Not found", { status: 404 });
  const self = `/admin/fees/schemes/${id}`;
  return adminPost(req, self, async (session, f, data) => {
    const schemeId = Number(id);
    const ids = (k: string) => data.getAll(k).map((v) => Number(v));
    switch (f["op"]) {
      case "update": await updateScheme(session, schemeId, { name: f["name"], validFrom: f["validFrom"], validTo: f["validTo"] }); return `${self}?saved=1`;
      case "rule": // an empty value removes the rule
        await setSchemeRule(session, schemeId, f["value"]?.trim() ? { feeTypeId: Number(f["feeTypeId"]), kind: f["kind"] ?? "", value: f["value"] }
          : { feeTypeId: Number(f["feeTypeId"]), value: null });
        return `${self}?saved=1`;
      case "courses": await setSchemeCourses(session, schemeId, ids("courseId")); return `${self}?saved=1`;
      case "centres": await setSchemeCentres(session, schemeId, ids("centreId")); return `${self}?saved=1`;
      case "approve": await approveScheme(session, schemeId); return `${self}?saved=1`;
      case "retire": await retireScheme(session, schemeId, f["reason"] ?? ""); return `${self}?saved=1`;
      case "delete": await deleteScheme(session, schemeId); return "/admin/fees/schemes?saved=1";
      default: throw new RbacError("invalid", "op: unknown");
    }
  });
}
export const POST = safeRoute(handle);
