import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the pg driver and Prisma's adapter are server-only and must not be bundled
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
};

export default nextConfig;
