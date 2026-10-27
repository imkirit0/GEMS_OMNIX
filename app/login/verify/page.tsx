import { redirect } from "next/navigation";
import { pendingChallenge } from "@/server/auth/session";
import { MESSAGES } from "../messages";

export default async function Verify({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!(await pendingChallenge())) redirect("/login?error=expired");
  const { error } = await searchParams;
  return (
    <main>
      <h1>Two-step verification</h1>
      {error && <p role="alert">{MESSAGES[error] ?? MESSAGES["code"]}</p>}
      <form method="post" action="/auth/verify">
        <label>Code from your authenticator app <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></label>
        <button type="submit">Verify</button>
      </form>
      <details>
        <summary>Use a recovery code instead</summary>
        <form method="post" action="/auth/verify">
          <label>Recovery code <input name="recovery" autoComplete="off" required /></label>
          <button type="submit">Use recovery code</button>
        </form>
      </details>
    </main>
  );
}
