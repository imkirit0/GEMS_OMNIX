import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createFeeType, setFeeTypeActive, updateFeeType } from "@/server/fees";
import { RbacError } from "@/server/rbac";
import { flag } from "../../../catalogue/masters/slugs";

const BACK = "/admin/fees/types";
export const POST = safeRoute(async (req: Request) => adminPost(req, BACK, async (session, f) => {
  const fields = { name: f["name"] ?? "", sortOrder: Number(f["sortOrder"]), hsnSac: f["hsnSac"] ?? "", gstRate: f["gstRate"] ?? "",
    accountId: f["accountId"] ? Number(f["accountId"]) : null }; // "" = not mapped (fee-ledger)
  switch (f["op"]) {
    case "create": await createFeeType(session, { code: f["code"] ?? "", categoryId: Number(f["categoryId"]), ...fields }); break;
    case "update": await updateFeeType(session, Number(f["id"]), fields); break;
    case "active": await setFeeTypeActive(session, Number(f["id"]), flag("active", f["active"]), f["reason"] ?? ""); break;
    default: throw new RbacError("invalid", "op: unknown");
  }
  return `${BACK}?saved=1`;
}));
