import { auth, CHALLENGE_COOKIE, clientIp, cookie, forbidden, form, sameOrigin, seeOther } from "@/server/auth/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const { login = "", password = "" } = await form(req);
  const r = await auth().signIn(login, password, clientIp(req));
  switch (r.kind) {
    case "session": return seeOther(req, "/", [r.setCookie]);
    case "totp": return seeOther(req, "/login/verify", [cookie(CHALLENGE_COOKIE, r.challenge, 300)]);
    case "enrol": return seeOther(req, "/login/enrol", [cookie(CHALLENGE_COOKIE, r.challenge, 300)]);
    case "locked": return seeOther(req, "/login?error=locked");
    case "rate_limited": return seeOther(req, "/login?error=rate");
    default: return seeOther(req, "/login?error=invalid");
  }
}
