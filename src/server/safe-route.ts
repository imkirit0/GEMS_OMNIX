// T-SEC-012: an unexpected error never reaches the client. The response carries a reference id only;
// the details go to the server log under the same id (legacy GEMS leaks raw SQL, FR-005.01).
import { randomUUID } from "node:crypto";
import { withRequestContext } from "./request-context";

type Handler<A extends unknown[]> = (req: Request, ...rest: A) => Promise<Response>;

// Only trust the proxy header where the platform sets it (same rule as auth rate limiting).
const clientIpOf = (req: Request) =>
  (process.env["TRUST_PROXY_HEADERS"] === "1" ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined) || "unknown";

/** T-AUD-005 for logs: mask Aadhaar numbers, PAN, long digit runs (accounts, cards) and credentials in URLs. */
export function redactText(s: string): string {
  return s
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[aadhaar]")
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[pan]")
    .replace(/\b\d{9,18}\b/g, "[number]")
    .replace(/(postgres(ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, "$1[secret]@");
}

export function safeRoute<A extends unknown[]>(handler: Handler<A>): Handler<A> {
  return async (req, ...rest) => {
    const ref = req.headers.get("x-request-id") || randomUUID(); // proxy.ts sets one per request
    try {
      const res = await withRequestContext({ requestId: ref, ip: clientIpOf(req) }, () => handler(req, ...rest));
      try { res.headers.set("x-request-id", ref); } catch { /* immutable headers (redirects): proxy already sets it */ }
      return res;
    } catch (e) {
      console.error(JSON.stringify({ level: "error", ref, path: new URL(req.url).pathname, error: redactText(e instanceof Error ? `${e.name}: ${e.message}` : String(e)) }));
      return new Response(`Something went wrong. Reference: ${ref}`, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-request-id": ref },
      });
    }
  };
}
