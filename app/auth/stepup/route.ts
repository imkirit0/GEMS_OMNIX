import { safeRoute } from "@/server/safe-route";
import { auth, forbidden, form, readCookie, sameOrigin, seeOther, SESSION_COOKIE } from "@/server/auth/http";
import { safeNext } from "@/server/admin-http";

// Re-authentication for sensitive actions (T-AUTH-015). Rotates the session id (T-AUTH-014).
async function handle(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  const { password = "", next = "/" } = await form(req);
  const target = safeNext(next);
  if (!token) return seeOther(req, "/login");
  try {
    const { token: rotated } = await auth().stepUp(token, password);
    return seeOther(req, target, [`${SESSION_COOKIE}=${rotated}; Path=/; HttpOnly; Secure; SameSite=Lax`]);
  } catch {
    return seeOther(req, `/stepup?error=password&next=${encodeURIComponent(target)}`);
  }
}

export const POST = safeRoute(handle);
