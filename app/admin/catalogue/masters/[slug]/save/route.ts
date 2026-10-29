import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { createMaster, setMasterActive, updateMaster } from "@/server/catalogue";
import { RbacError } from "@/server/rbac";
import { flag, slugOf } from "../../slugs";

async function handle(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = slugOf(slug);
  if (!m) return new Response("Not found", { status: 404 }); // before adminPost: 404 whatever the Origin (C3)
  const self = `/admin/catalogue/masters/${slug}`;
  return adminPost(req, self, async (session, f) => {
    switch (f["op"]) {
      case "create":
        await createMaster(session, m.kind, { code: f["code"] ?? "", name: f["name"] ?? "" });
        break;
      case "update":
        await updateMaster(session, m.kind, Number(f["id"]), { name: f["name"] ?? "" });
        break;
      case "active":
        await setMasterActive(session, m.kind, Number(f["id"]), flag("active", f["active"]), f["reason"] ?? "");
        break;
      default:
        throw new RbacError("invalid", "unknown operation");
    }
    return `${self}?saved=1`;
  });
}

export const POST = safeRoute(handle);
