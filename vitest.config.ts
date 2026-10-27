import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    fileParallelism: false, // tests share one database and reset fixtures
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
