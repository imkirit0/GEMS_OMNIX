import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { RbacError } from "@/server/rbac";
import { setTypeActive, setTypeLevels, setTypeViewers, updateType } from "@/server/tickets/setup";

// "user:<uuid>" or "role:<id>" from the pickers
const subject = (v: string) => (v.startsWith("user:") ? { userId: v.slice(5) } : v.startsWith("role:") ? { roleId: Number(v.slice(5)) } : null);

async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const self = `/admin/ticket-types/${encodeURIComponent(id)}`;
  return adminPost(req, self, async (session, f, data) => {
    const typeId = Number(id);
    switch (f["op"]) {
      case "details":
        await updateType(session, typeId, { name: f["name"] ?? "", categoryId: Number(f["categoryId"]), priority: f["priority"] ?? "",
          documentRequired: f["documentRequired"] === "1", handlerKey: f["handlerKey"] ?? "" });
        break;
      case "levels": {
        // ponytail: a blank level in the middle is passed through, so setTypeLevels refuses the gap with its message
        const chosen = [1, 2, 3, 4].map((n) => f[`level${n}`] ?? "");
        const last = chosen.findLastIndex(Boolean);
        await setTypeLevels(session, typeId, chosen.slice(0, last + 1).map((v, i) => ({ level: v ? i + 1 : 0, ...subject(v) })));
        break;
      }
      case "viewers":
        await setTypeViewers(session, typeId, data.getAll("viewer").map(String).map(subject).filter((x) => x !== null));
        break;
      case "active":
        await setTypeActive(session, typeId, f["active"] === "1");
        break;
      default:
        throw new RbacError("invalid", "unknown operation");
    }
    return `${self}?saved=1`;
  });
}

export const POST = safeRoute(handle);
