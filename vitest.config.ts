import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }, // same as tsconfig paths
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    fileParallelism: false, // tests share one database and reset fixtures
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
