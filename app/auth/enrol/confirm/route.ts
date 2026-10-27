import { auth, CHALLENGE_COOKIE, clearCookie, forbidden, form, readCookie, sameOrigin, seeOther } from "@/server/auth/http";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const challenge = readCookie(req.headers.get("cookie"), CHALLENGE_COOKIE);
  if (!challenge) return seeOther(req, "/login?error=expired");
  const { code = "" } = await form(req);
  const { result, recoveryCodes } = await auth().confirmTotpEnrolment(challenge, code.trim());
  if (result.kind === "locked") return seeOther(req, "/login?error=locked", [clearCookie(CHALLENGE_COOKIE)]);
  if (result.kind !== "session") return seeOther(req, "/login/enrol?error=code");
  // Recovery codes exist in plaintext only now: show them once, never store them in a cookie or URL.
  const html = `<!doctype html><meta charset="utf-8"><title>Recovery codes</title>
<main><h1>Save your recovery codes</h1><p>Each code works once if you lose your authenticator. They will not be shown again.</p>
<ul>${recoveryCodes.map((c) => `<li><code>${esc(c)}</code></li>`).join("")}</ul><p><a href="/">Continue</a></p></main>`;
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  headers.append("set-cookie", result.setCookie);
  headers.append("set-cookie", clearCookie(CHALLENGE_COOKIE));
  return new Response(html, { status: 200, headers });
}
