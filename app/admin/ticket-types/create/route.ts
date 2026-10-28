import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createCategory, createType } from "@/server/tickets/setup";

export const POST = safeRoute(async (req: Request) => adminPost(req, "/admin/ticket-types", async (session, f) => {
  if (f["op"] === "category") {
    await createCategory(session, { name: f["name"] ?? "", ...(f["parentId"] ? { parentId: Number(f["parentId"]) } : {}) });
    return "/admin/ticket-types";
  }
  const id = await createType(session, {
    code: f["code"] ?? "", name: f["name"] ?? "", categoryId: Number(f["categoryId"]), priority: f["priority"] ?? "",
    documentRequired: f["documentRequired"] === "1", handlerKey: f["handlerKey"] ?? "", numberPrefix: f["numberPrefix"] ?? "",
  });
  return `/admin/ticket-types/${id}`;
}));
