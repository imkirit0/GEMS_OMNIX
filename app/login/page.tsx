import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/session";
import { MESSAGES } from "./messages";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  if (await currentUser()) redirect("/");
  const { error, reset } = await searchParams;
  return (
    <main>
      <h1>Sign in to GEMS OMNIX</h1>
      {reset === "ok" && <p role="status">Password changed. Please sign in.</p>}
      {error && <p role="alert">{MESSAGES[error] ?? MESSAGES["invalid"]}</p>}
      <form method="post" action="/auth/login">
        <label>Login <input name="login" autoComplete="username" required /></label>
        <label>Password <input name="password" type="password" autoComplete="current-password" required /></label>
        <button type="submit">Sign in</button>
      </form>
      <p><a href="/reset">Forgot password?</a></p>
    </main>
  );
}
