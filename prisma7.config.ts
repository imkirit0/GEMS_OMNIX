import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Local values come from .env.local. To migrate any hosted database, pass MIGRATE_URL explicitly
// on the command line: this file never falls back to the Supabase URLs in .env.
config({ path: ".env.local", quiet: true });
const url = process.env["MIGRATE_URL"];
if (!url) throw new Error("MIGRATE_URL is not set");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
