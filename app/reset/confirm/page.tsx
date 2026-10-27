import { POLICY } from "@/server/auth/policy";
import { MESSAGES } from "../../login/messages";

export default async function ResetConfirm({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token = "", error } = await searchParams;
  return (
    <main>
      <h1>Choose a new password</h1>
      {error && <p role="alert">{MESSAGES[error] ?? MESSAGES["password"]}</p>}
      <form method="post" action="/auth/reset/confirm">
        <input type="hidden" name="token" value={token} />
        <label>New password <input name="password" type="password" autoComplete="new-password" minLength={POLICY.minPasswordLength} required /></label>
        <button type="submit">Set password</button>
      </form>
    </main>
  );
}
