import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { setCentreActive, updateCentre } from "@/server/centres";
import { flag } from "../../../admin/catalogue/masters/slugs";
import { centreFields, unknownOp } from "../../centre-form";

async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) return new Response("Not found", { status: 404 });
  return adminPost(req, `/centres/${id}`, async (session, f) => {
    switch (f["op"]) {
      case "details":
        await updateCentre(session, Number(id), centreFields(f));
        break;
      case "active":
        await setCentreActive(session, Number(id), flag("active", f["active"]), f["reason"] ?? "");
        break;
      default:
        throw unknownOp();
    }
    return `/centres/${id}?saved=1`;
  });
}
export const POST = safeRoute(handle);
