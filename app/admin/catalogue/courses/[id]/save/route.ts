import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { setCourseActive, setCourseClasses, updateCourse } from "@/server/catalogue";
import { RbacError } from "@/server/rbac";
import { courseFields } from "../../form-fields";

async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const self = `/admin/catalogue/courses/${encodeURIComponent(id)}`;
  return adminPost(req, self, async (session, f, data) => {
    const courseId = Number(id);
    switch (f["op"]) {
      case "details":
        await updateCourse(session, courseId, courseFields(f));
        break;
      case "classes":
        await setCourseClasses(session, courseId, data.getAll("classId").map(Number));
        break;
      case "active":
        await setCourseActive(session, courseId, f["active"] === "1", f["reason"] ?? "");
        break;
      default:
        throw new RbacError("invalid", "unknown operation");
    }
    return `${self}?saved=1`;
  });
}

export const POST = safeRoute(handle);
