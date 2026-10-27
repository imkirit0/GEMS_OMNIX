import { Forbidden } from "@/server/action";
import { forbidden, readCookie, sameOrigin, seeOther, SESSION_COOKIE } from "@/server/auth/http";
import { issueSetupToken, RbacError, StepUpRequired } from "@/server/rbac";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// PR-12: no password is ever chosen or seen by the admin. The user sets their own via this one-time link.
// ponytail: shown to the admin until the e-mail adapter exists (D-COMM-1); then it is mailed instead.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sameOrigin(req)) return forbidden();
  const session = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!session) return seeOther(req, "/login");
  let token: string;
  try {
    token = await issueSetupToken(session, id);
  } catch (e) {
    if (e instanceof StepUpRequired) return seeOther(req, `/stepup?next=${encodeURIComponent(`/admin/users/${id}`)}`);
    if (e instanceof Forbidden) return seeOther(req, `/admin/users/${id}?error=forbidden`);
    if (e instanceof RbacError) return seeOther(req, `/admin/users/${id}?error=${e.reason}`);
    throw e;
  }
  const link = new URL(`/reset/confirm?token=${encodeURIComponent(token)}`, req.url).toString();
  const html = `<!doctype html><meta charset="utf-8"><title>Set-up link</title>
<main><h1>One-time set-up link</h1><p>Give this link to the user over a trusted channel. It works once and expires in 72 hours. It will not be shown again.</p>
<p><code>${esc(link)}</code></p><p><a href="/admin/users/${esc(id)}">Back to user</a></p></main>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
