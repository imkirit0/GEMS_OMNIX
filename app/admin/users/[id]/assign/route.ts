import { adminPost } from "@/server/admin-http";
import { assignRole, type ScopeInput } from "@/server/rbac";

const int = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminPost(req, `/admin/users/${id}`, async (session, f) => {
    const kind = (["ALL", "REGION", "AREA", "CENTRE"] as const).find((k) => k === f["scopeKind"]) ?? "CENTRE";
    // only the field the scope kind needs is sent on; the DB CHECK rejects any other shape
    const scope: ScopeInput = kind === "ALL" ? { kind } : kind === "REGION" ? { kind, regionId: int(f["regionId"]) }
      : kind === "AREA" ? { kind, areaId: int(f["areaId"]) } : { kind, centreId: int(f["centreId"]) };
    await assignRole(session, { userId: id, roleId: int(f["roleId"]) ?? 0, scope });
    return `/admin/users/${id}`;
  });
}
