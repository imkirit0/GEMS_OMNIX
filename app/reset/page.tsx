import { MESSAGES } from "../login/messages";

export default async function Reset({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;
  return (
    <main>
      <h1>Reset password</h1>
      {sent && <p role="status">If the account exists, a reset link has been sent.</p>}
      {error && <p role="alert">{MESSAGES[error] ?? "That link is invalid or expired."}</p>}
      <form method="post" action="/auth/reset/request">
        <label>Login <input name="login" autoComplete="username" required /></label>
        <button type="submit">Send reset link</button>
      </form>
      <p><a href="/login">Back to sign in</a></p>
    </main>
  );
}
