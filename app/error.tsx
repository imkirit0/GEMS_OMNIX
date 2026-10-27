"use client";

// T-SEC-012: pages never show error details. In production Next.js replaces the message with a digest,
// which also appears in the server log, so support can find the cause without the user seeing it.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p>Please try again. If it keeps happening, quote this reference: <code>{error.digest ?? "unavailable"}</code></p>
      <button type="button" onClick={reset}>Try again</button>
    </main>
  );
}
