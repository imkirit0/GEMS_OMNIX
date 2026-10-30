import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createPlan } from "@/server/fees";

// a class plan or a centre override (the form sends one of the two)
export const POST = safeRoute(async (req: Request) => adminPost(req, "/admin/fees/plans", async (session, f) => {
  const { id } = await createPlan(session, { academicYear: f["academicYear"] ?? "", courseId: Number(f["courseId"]),
    centreClassId: f["centreClassId"] ? Number(f["centreClassId"]) : null, centreId: f["centreId"] ? Number(f["centreId"]) : null });
  return `/admin/fees/plans/${id}?saved=1`;
}));
