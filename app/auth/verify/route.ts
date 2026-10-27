import { safeRoute } from "@/server/safe-route";
import { auth, CHALLENGE_COOKIE, clearCookie, forbidden, form, readCookie, sameOrigin, seeOther } from "@/server/auth/http";

async function handle(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const challenge = readCookie(req.headers.get("cookie"), CHALLENGE_COOKIE);
  if (!challenge) return seeOther(req, "/login?error=expired");
  const { code = "", recovery = "" } = await form(req);
  const r = recovery ? await auth().useRecoveryCode(challenge, recovery.trim()) : await auth().verifyTotp(challenge, code.trim());
  if (r.kind === "session") return seeOther(req, "/", [r.setCookie, clearCookie(CHALLENGE_COOKIE)]);
  if (r.kind === "locked") return seeOther(req, "/login?error=locked", [clearCookie(CHALLENGE_COOKIE)]);
  return seeOther(req, "/login/verify?error=code");
}

export const POST = safeRoute(handle);
