import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { collectFee } from "@/server/receipts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Collect a fee and issue a receipt (docs/designs/fee-receipts). Another person's or an unseen registration: 404 (G4).
async function handle(req: Request, { params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  if (!UUID.test(personId)) return new Response("Not found", { status: 404 });
  return adminPost(req, `/students/${personId}`, async (session, f) => {
    const r = await collectFee(session, personId, { registrationId: f["registrationId"] ?? "", amount: f["amount"] ?? "", mode: f["mode"] ?? "",
      reference: f["reference"] ?? "", instrumentDate: f["instrumentDate"] ?? "", idempotencyKey: f["idempotencyKey"] ?? "" });
    return `/receipts/${r.receiptId}?${r.replay ? "replay" : "saved"}=1`;
  });
}
export const POST = safeRoute(handle);
