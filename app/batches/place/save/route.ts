import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { placeLearners } from "@/server/batches";
import { ID } from "../../labels";

// Back to the place page with its filters; "registrationId" repeats, so it is read from the form data (R8).
const back = (f: Record<string, string>) => {
  if (!ID.test(f["centreId"] ?? "")) return "/batches";
  const q = new URLSearchParams({ centre: f["centreId"]!, course: f["course"] ?? "" });
  if (ID.test(f["filterBatch"] ?? "")) q.set("batch", f["filterBatch"]!);
  return `/batches/place?${q}`;
};

export const POST = safeRoute(async (req: Request) => adminPost(req, back, async (session, f, data) => {
  const ids = data.getAll("registrationId").filter((v): v is string => typeof v === "string");
  await placeLearners(session, Number(f["centreId"]), f["batchId"] ? Number(f["batchId"]) : null, ids);
  return `${back(f)}&saved=1`;
}));
