import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createBatch, setBatchActive, updateBatch } from "@/server/batches";
import { flag } from "../../admin/catalogue/masters/slugs";
import { unknownOp } from "../../centres/centre-form";
import { ID } from "../labels";

const back = (f: Record<string, string>) => (ID.test(f["centreId"] ?? "") ? `/batches?centre=${f["centreId"]}` : "/batches");

export const POST = safeRoute(async (req: Request) => adminPost(req, back, async (session, f) => {
  const centreId = Number(f["centreId"]);
  const fields = { name: f["name"] ?? "", startsAt: f["startsAt"] ?? "", endsAt: f["endsAt"] ?? "", capacity: Number(f["capacity"]) };
  switch (f["op"]) {
    case "create": await createBatch(session, { centreId, code: f["code"] ?? "", ...fields }); break;
    case "update": await updateBatch(session, centreId, Number(f["id"]), fields); break;
    case "active": await setBatchActive(session, centreId, Number(f["id"]), flag("active", f["active"]), f["reason"] ?? ""); break;
    default: throw unknownOp();
  }
  return `${back(f)}&saved=1`;
}));
