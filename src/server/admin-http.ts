// Shared plumbing for admin form POSTs: same-origin, session cookie, and one error mapping.
import { Forbidden } from "./action";
import { ScopeError } from "./db";
import { forbidden, readCookie, sameOrigin, seeOther, SESSION_COOKIE } from "./auth/http";
import { RbacError, StepUpRequired } from "./rbac";

/** Only same-site relative paths: blocks open redirects such as //evil.example or /\evil.example. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  return typeof next === "string" && /^\/(?![\/\\])/.test(next) ? next : fallback;
}

const withError = (path: string, code: string) => `${path}${path.includes("?") ? "&" : "?"}error=${code}`;

/**
 * Runs an admin action for a form POST. `back` is where to return (and where errors are shown);
 * the action returns the path to go to on success.
 */
export async function adminPost(req: Request, back: string,
  action: (session: string, fields: Record<string, string>, data: FormData) => Promise<string>): Promise<Response> {
  if (!sameOrigin(req)) return forbidden();
  const session = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!session) return seeOther(req, "/login");
  const data = await req.formData();
  const fields = Object.fromEntries([...data.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  try {
    return seeOther(req, await action(session, fields, data));
  } catch (e) {
    if (e instanceof StepUpRequired) return seeOther(req, `/stepup?next=${encodeURIComponent(back)}`);
    if (e instanceof Forbidden) return seeOther(req, withError(back, "forbidden"));
    if (e instanceof RbacError) return seeOther(req, withError(back, e.reason));
    if (e instanceof ScopeError) return seeOther(req, "/login?error=expired");
    throw e;
  }
}

export const ADMIN_MESSAGES: Record<string, string> = {
  forbidden: "You are not allowed to do that. You can only grant roles where you hold every one of their permissions.",
  duplicate: "That login or key already exists.",
  notfound: "Not found.",
  invalid: "Some values were invalid. Check the scope fields.",
};
