import { safeRoute } from "@/server/safe-route";
import { auth, forbidden, form, sameOrigin, seeOther } from "@/server/auth/http";

async function handle(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const { login = "" } = await form(req);
  await auth().requestReset(login); // same answer whether or not the account exists (T-AUTH-008)
  return seeOther(req, "/reset?sent=1");
}

export const POST = safeRoute(handle);
