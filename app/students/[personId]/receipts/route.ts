import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { collectFee } from "@/server/receipts";
import { bad } from "@/server/catalogue";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Collect a fee and issue a receipt (docs/designs/fee-receipts). Another person's or an unseen registration: 404 (G4).
async function handle(req: Request, { params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  if (!UUID.test(personId)) return new Response("Not found", { status: 404 });
  return adminPost(req, `/students/${personId}`, async (session, f, data) => {
    // ad-hoc rows repeat their fields; paired by position, fully empty rows dropped (adhoc-fees)
    const types = data.getAll("extraFeeType").map(String), amounts = data.getAll("extraAmount").map(String);
    const extras = [];
    for (let i = 0; i < Math.max(types.length, amounts.length); i++) {
      const t = (types[i] ?? "").trim(), a = (amounts[i] ?? "").trim();
      if (t === "" && a === "") continue;
      if (!/^\d{1,9}$/.test(t)) throw bad("extras: fee type");
      if (a === "") throw bad("extras: amount from 0.01, up to 99,99,999.99");
      extras.push({ feeTypeId: Number(t), amount: a });
    }
    const r = await collectFee(session, personId, { registrationId: f["registrationId"] ?? "", amount: f["amount"] ?? "", mode: f["mode"] ?? "",
      reference: f["reference"] ?? "", instrumentDate: f["instrumentDate"] ?? "", idempotencyKey: f["idempotencyKey"] ?? "", extras });
    return `/receipts/${r.receiptId}?${r.replay ? "replay" : "saved"}=1`;
  });
}
export const POST = safeRoute(handle);
