import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { raise } from "@/server/tickets/engine";

// Errors return to the form for the same type and centre (or re-raise); the typed values are lost (Stage 2).
const back = (f: Record<string, string>) => f["reraiseOf"]
  ? `/tickets/new?reraise=${encodeURIComponent(f["reraiseOf"])}`
  : `/tickets/new?type=${encodeURIComponent(f["typeId"] ?? "")}&centre=${encodeURIComponent(f["centreId"] ?? "")}`;

export const POST = safeRoute(async (req: Request) => adminPost(req, back, async (session, f, data) => {
  const payload = Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith("p.")).map(([k, v]) => [k.slice(2), v]));
  const { id } = await raise(session, {
    ticketId: f["ticketId"] ?? "", typeId: Number(f["typeId"]), centreId: Number(f["centreId"]), payload,
    uploadIds: data.getAll("uploadId").map(String).filter(Boolean), // fields keeps only the last value of a repeated name
    ...(f["reraiseOf"] ? { reraiseOf: f["reraiseOf"] } : {}),
  });
  return `/tickets/${id}`;
}));
