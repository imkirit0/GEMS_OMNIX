import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createPlan, deletePlan, getPlan, publishPlan, setPlanLine } from "@/server/fees";
import { RbacError } from "@/server/rbac";
import { ID } from "../../../labels";

async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) return new Response("Not found", { status: 404 });
  const self = `/admin/fees/plans/${id}`;
  return adminPost(req, self, async (session, f) => {
    const planId = Number(id);
    switch (f["op"]) {
      case "line": // "" removes the line
        await setPlanLine(session, planId, { feeTypeId: Number(f["feeTypeId"]), captionId: Number(f["captionId"]), amount: f["amount"] ? f["amount"].trim() : null });
        return `${self}?saved=1`;
      case "publish": await publishPlan(session, planId, f["reason"] ?? ""); return `${self}?saved=1`;
      case "delete": await deletePlan(session, planId); return "/admin/fees/plans?saved=1";
      case "version": { // the next version for the same key, copying this one's current published lines
        const { plan } = await getPlan(session, planId);
        const next = await createPlan(session, { academicYear: plan.academicYear, courseId: plan.courseId, centreClassId: plan.centreClassId, centreId: plan.centreId });
        return `/admin/fees/plans/${next.id}?saved=1`;
      }
      default: throw new RbacError("invalid", "op: unknown");
    }
  });
}
export const POST = safeRoute(handle);
