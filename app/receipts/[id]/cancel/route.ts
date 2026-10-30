import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { cancelReceipt } from "@/server/receipts";
import { RbacError } from "@/server/rbac";

const ID = /^\d{1,18}$/;

// Cancel a receipt on its own day (docs/designs/receipt-cancel). A resubmitted cancel lands on the cancelled receipt (D6).
async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) return new Response("Not found", { status: 404 });
  const self = `/receipts/${id}`;
  return adminPost(req, self, async (session, f) => {
    try {
      await cancelReceipt(session, id, f["reason"] ?? "");
    } catch (e) {
      if (e instanceof RbacError && e.key === "fee.receipt.cancelled") return self;
      throw e;
    }
    return `${self}?cancelled=1`;
  });
}
export const POST = safeRoute(handle);
