import { redirect } from "next/navigation";
import { safeNext } from "@/server/admin-http";
import { currentUser } from "@/server/auth/session";

// Re-enter the password before a sensitive change (valid 5 minutes).
export default async function StepUp({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const { next, error } = await searchParams;
  return (
    <main>
      <h1>Confirm it is you</h1>
      <p>This change needs your password again.</p>
      {error && <p role="alert">Password not accepted.</p>}
      <form method="post" action="/auth/stepup">
        <input type="hidden" name="next" value={safeNext(next)} />
        <label>Password <input name="password" type="password" autoComplete="current-password" required /></label>
        <button type="submit">Continue</button>
      </form>
    </main>
  );
}
