import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createCentre } from "@/server/centres";
import { centreFields } from "../centre-form";

export const POST = safeRoute(async (req: Request) => adminPost(req, "/centres/new", async (session, f) => {
  const { id } = await createCentre(session, { code: f["code"] ?? "", ...centreFields(f) });
  return `/centres/${id}?saved=1`;
}));
