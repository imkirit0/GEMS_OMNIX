// Server-component helpers: who is signed in (every page calls this; nothing is rendered without a session).
import { cookies } from "next/headers";
import { auth, CHALLENGE_COOKIE, SESSION_COOKIE } from "./http";

export async function currentUser(): Promise<{ userId: string; login: string; displayName: string } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = token ? await auth().resolve(token) : null;
  const p = s ? await auth().profile(s.userId) : null;
  return s && p ? { userId: s.userId, ...p } : null;
}

export async function pendingChallenge(): Promise<string | null> {
  return (await cookies()).get(CHALLENGE_COOKIE)?.value ?? null;
}
