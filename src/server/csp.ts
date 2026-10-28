// Per-request Content-Security-Policy (audit 06 §3 "Web"; T-SEC-014). Built here, not inline in proxy.ts,
// so the storage-origin rule can be unit-tested (CI never sets SUPABASE_URL).
// With a storage origin, it is allowed in connect-src (the browser PUTs files to it) and in form-action
// (the document download is a form POST answered by a redirect to it, and browsers apply form-action to that redirect).
export function buildCsp(nonce: string, dev: boolean, storageUrl?: string): string {
  const storage = storageUrl ? ` ${new URL(storageUrl).origin}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`, // React needs eval only in dev
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${storage}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self'${storage}`,
    "frame-ancestors 'none'",
  ].join("; ");
}
