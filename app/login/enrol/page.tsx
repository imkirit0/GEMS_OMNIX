import { redirect } from "next/navigation";
import { auth } from "@/server/auth/http";
import { pendingChallenge } from "@/server/auth/session";
import { MESSAGES } from "../messages";

// Head-office accounts must set up an authenticator before any data is reachable (T-AUTH-005).
export default async function Enrol({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const challenge = await pendingChallenge();
  if (!challenge) redirect("/login?error=expired");
  const { error } = await searchParams;
  const secret = await auth().enrolmentSecret(challenge);
  return (
    <main>
      <h1>Set up two-step verification</h1>
      {error && <p role="alert">{MESSAGES[error] ?? MESSAGES["code"]}</p>}
      {!secret ? (
        <form method="post" action="/auth/enrol/start">
          <p>Your account requires an authenticator app. Confirm your password to begin.</p>
          <label>Password <input name="password" type="password" autoComplete="current-password" required /></label>
          <button type="submit">Continue</button>
        </form>
      ) : (
        <>
          <p>Add this key to your authenticator app (Google Authenticator, Microsoft Authenticator, etc.), then enter the 6-digit code.</p>
          <p><code>{secret.match(/.{1,4}/g)?.join(" ")}</code></p>
          <p><small>Or open: <code>{`otpauth://totp/GEMS%20OMNIX?secret=${secret}&issuer=GEMS%20OMNIX`}</code></small></p>
          <form method="post" action="/auth/enrol/confirm">
            <label>Code <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></label>
            <button type="submit">Confirm</button>
          </form>
        </>
      )}
    </main>
  );
}
