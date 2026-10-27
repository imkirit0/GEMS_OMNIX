// Server-component helper for admin pages: run a read with the viewer's session; anything but success is a 404,
// so non-admins cannot even learn which admin pages or users exist (no existence oracle, 06 T-SEC-001).
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SESSION_COOKIE } from "./auth/http";
import { ScopeError } from "./db";
import { Forbidden } from "./action";

export async function adminRead<T>(fn: (session: string) => Promise<T>): Promise<T> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) redirect("/login");
  try {
    return await fn(session);
  } catch (e) {
    if (e instanceof ScopeError) redirect("/login?error=expired");
    if (e instanceof Forbidden) notFound();
    throw e;
  }
}
