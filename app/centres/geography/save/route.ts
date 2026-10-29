import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createArea, createRegion, updateArea, updateRegion } from "@/server/centres";
import { unknownOp } from "../../centre-form";

export const POST = safeRoute(async (req: Request) => adminPost(req, "/centres/geography", async (session, f) => {
  switch (f["op"]) {
    case "region.create": await createRegion(session, { code: f["code"] ?? "", name: f["name"] ?? "" }); break;
    case "region.update": await updateRegion(session, Number(f["id"]), { name: f["name"] ?? "" }); break;
    case "area.create": await createArea(session, { regionId: Number(f["regionId"]), name: f["name"] ?? "" }); break;
    case "area.update": await updateArea(session, Number(f["id"]), { name: f["name"] ?? "" }); break;
    default: throw unknownOp();
  }
  return "/centres/geography?saved=1";
}));
