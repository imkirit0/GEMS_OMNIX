// Per-request Content-Security-Policy with a fresh nonce (audit 06 §3 "Web"; T-SEC-014).
// Next.js reads the nonce from the request's CSP header and applies it to its own scripts.
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "./src/server/csp";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = buildCsp(nonce, dev, process.env["SUPABASE_URL"]);

  const requestHeaders = new Headers(request.headers);
  const requestId = crypto.randomUUID(); // ties audit rows and error references to one request
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  // static assets do not need a CSP; prefetches would otherwise get a nonce they cannot use
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};
