import { safeRoute } from "@/server/safe-route";
import { auth, clearCookie, forbidden, readCookie, sameOrigin, seeOther, SESSION_COOKIE } from "@/server/auth/http";

async function handle(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (token) await auth().signOut(token);
  return seeOther(req, "/login", [clearCookie(SESSION_COOKIE)]);
}

export const POST = safeRoute(handle);
