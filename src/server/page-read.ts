// Server-component helper for scoped pages: run a read with the viewer's session; anything but success is a 404,
// so non-admins cannot even learn which admin pages or users exist (no existence oracle, 06 T-SEC-001).
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SESSION_COOKIE } from "./auth/http";
import { ScopeError } from "./db";
import { Forbidden } from "./action";
import { withRequestContext } from "./request-context";

export async function pageRead<T>(fn: (session: string) => Promise<T>): Promise<T> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) redirect("/login");
  const h = await headers();
  const ip = (process.env["TRUST_PROXY_HEADERS"] === "1" ? h.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined) || "unknown";
  try {
    return await withRequestContext({ requestId: h.get("x-request-id") || randomUUID(), ip }, () => fn(session));
  } catch (e) {
    if (e instanceof ScopeError) redirect("/login?error=expired");
    if (e instanceof Forbidden) notFound();
    throw e;
  }
}
