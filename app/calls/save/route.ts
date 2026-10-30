import { safeRoute } from "@/server/safe-route";
import { adminPost } from "@/server/admin-http";
import { logCall, type CallType } from "@/server/call-log";
import { ID } from "../labels";

const back = (f: Record<string, string>) => (ID.test(f["centreId"] ?? "") ? `/calls?centre=${f["centreId"]}` : "/calls");

// "" is null first, then the duration is a number (C14); an absent tele-caller select keeps the default (C1)
export const POST = safeRoute(async (req: Request) => adminPost(req, back, async (session, f) => {
  const s = (k: string) => (f[k] === undefined || f[k] === "" ? null : f[k]!);
  await logCall(session, { centreId: Number(f["centreId"]), phone: f["phone"] ?? "", name: s("name"), calledOn: s("calledOn"),
    callType: (f["callType"] ?? "") as CallType, durationMin: s("durationMin") === null ? null : Number(f["durationMin"]),
    description: s("description"), note: s("note"), nextFollowUpOn: s("nextFollowUpOn"),
    teleCaller: f["teleCaller"] === undefined ? undefined : s("teleCaller") });
  return `${back(f)}&saved=1`;
}));
