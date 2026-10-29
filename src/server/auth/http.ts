// HTTP glue for the auth module: same-origin check, cookies, client IP, the shared instance.
// Route handlers here are plain (Request) => Response so they can be tested without a running server.
import { createAuth, type AuthService } from "./index";

export const SESSION_COOKIE = "__Host-gems_session";
export const CHALLENGE_COOKIE = "__Host-gems_challenge"; // pending second factor, 5 minutes

const cache = globalThis as unknown as { __gemsAuth?: AuthService };
export const auth = (): AuthService => (cache.__gemsAuth ??= createAuth());

/** T-AUTH-016: route handlers get no automatic CSRF protection in Next.js, so every POST must be same-origin. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin !== null && origin === new URL(req.url).origin;
}

/**
 * For Server Actions (admission-screens design): Next has already matched the Origin host and refuses a mismatch, but it
 * lets a request with no Origin through; this closes that gap. Route handlers use sameOrigin(req).
 */
export const hasOrigin = (h: Headers): boolean => {
  const o = h.get("origin");
  return o !== null && o !== "null";
};

/** Client IP for rate limiting. Only trust the proxy header where the platform sets it (Vercel: TRUST_PROXY_HEADERS=1). */
export function clientIp(req: Request): string {
  const forwarded = process.env["TRUST_PROXY_HEADERS"] === "1" ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return forwarded || "unknown"; // ponytail: without a trusted proxy all clients share one IP bucket; fine locally, set the env on Vercel
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export const cookie = (name: string, value: string, maxAgeSeconds?: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAgeSeconds === undefined ? "" : `; Max-Age=${maxAgeSeconds}`}`;
export const clearCookie = (name: string) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** 303 so the browser follows with GET after a form POST. */
export function seeOther(req: Request, path: string, cookies: string[] = []): Response {
  const headers = new Headers({ location: new URL(path, req.url).toString() });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}

export const forbidden = () => new Response("Forbidden", { status: 403 });

export async function form(req: Request): Promise<Record<string, string>> {
  const data = await req.formData();
  return Object.fromEntries([...data.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
}
