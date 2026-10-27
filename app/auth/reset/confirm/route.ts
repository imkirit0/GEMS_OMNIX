import { auth, forbidden, form, sameOrigin, seeOther } from "@/server/auth/http";
import { POLICY } from "@/server/auth/policy";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const { token = "", password = "" } = await form(req);
  if (password.length < POLICY.minPasswordLength) return seeOther(req, `/reset/confirm?token=${encodeURIComponent(token)}&error=short`);
  const ok = await auth().confirmReset(token, password);
  return seeOther(req, ok ? "/login?reset=ok" : "/reset?error=expired");
}
