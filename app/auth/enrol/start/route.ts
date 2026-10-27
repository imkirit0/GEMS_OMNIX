import { auth, CHALLENGE_COOKIE, forbidden, form, readCookie, sameOrigin, seeOther } from "@/server/auth/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const challenge = readCookie(req.headers.get("cookie"), CHALLENGE_COOKIE);
  if (!challenge) return seeOther(req, "/login?error=expired");
  const { password = "" } = await form(req);
  try {
    await auth().startTotpEnrolment(challenge, password);
  } catch {
    return seeOther(req, "/login/enrol?error=password");
  }
  return seeOther(req, "/login/enrol"); // the page now shows the secret (read from the encrypted pending record)
}
