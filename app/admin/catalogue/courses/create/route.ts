import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createCourse } from "@/server/catalogue";
import { courseFields } from "../form-fields";

export const POST = safeRoute(async (req: Request) => adminPost(req, "/admin/catalogue/courses/new", async (session, f) => {
  const { id } = await createCourse(session, { code: f["code"] ?? "", ...courseFields(f) });
  return `/admin/catalogue/courses/${id}?saved=1`;
}));
