import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { bulkAct } from "@/server/tickets/engine";
import { TicketError } from "@/server/tickets/errors";

const ITEM = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{1,9})$/i;
// back to the queue with its filters (C9, R5); the filters are only passed through, the page validates them
const back = (f: Record<string, string>) => {
  const q = new URLSearchParams(["type", "centre", "from", "to"].flatMap((k) => (f[k] ? [[k, f[k]!]] : [])));
  return `/tickets/approvals${q.size ? `?${q}` : ""}`;
};

// Bulk approve or reject (approvals-workbench DD-3): items repeat, so they come from the form data, "<ticketId>:<version>"
// each; a blank or malformed one refuses the whole batch before anything is touched (C1, C2).
export const POST = safeRoute(async (req: Request) => adminPost(req, back, async (session, f, data) => {
  const items = data.getAll("item").map((v) => (typeof v === "string" ? ITEM.exec(v) : null));
  if (items.some((m) => !m)) throw new TicketError("invalid", "a ticket was malformed");
  const r = await bulkAct(session, { action: f["action"] as "approve" | "reject", remarks: f["remarks"],
    items: items.map((m) => ({ ticketId: m![1]!.toLowerCase(), seenVersion: Number(m![2]) })) });
  const b = back(f);
  return `${b}${b.includes("?") ? "&" : "?"}${new URLSearchParams(Object.entries(r).map(([k, v]) => [k, String(v)]))}`;
}));
