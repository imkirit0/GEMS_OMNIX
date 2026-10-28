import type { NextConfig } from "next";

// Static security headers for every response (audit 06 §3 "Web"). The CSP is per-request, in proxy.ts.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }, // ignored by browsers on plain http
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // the pg driver and Prisma's adapter are server-only and must not be bundled
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  poweredByHeader: false,
  // `next dev` only: let the dev server be opened from any IPv4 address (LAN, WSL, VM). Next refuses a bare "*",
  // so four single-label wildcards are the widest pattern; they also match any four-label host name.
  // No effect on `next build` / `next start`.
  allowedDevOrigins: ["*.*.*.*"],
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
};

export default nextConfig;
