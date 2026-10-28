// Migration framework setup (docs/designs/migration-framework/migration-framework.md, "Where It Runs").
// Usage:   node scripts/etl/setup.mjs
// Database: MIGRATE_URL, the schema owner (local values come from .env.local). Never falls back to the Supabase
//           URLs in .env. Runs once on a fresh database in a migration environment; ETL_DB_PASSWORD sets the role password.
import fs from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
const url = process.env["MIGRATE_URL"];
const password = process.env["ETL_DB_PASSWORD"];
if (!url) throw new Error("MIGRATE_URL is not set");
if (!password) throw new Error("ETL_DB_PASSWORD is not set");

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  // 1. create with the defaults (a non-superuser cannot create a superuser; naming nosuperuser would need superuser)
  const exists = (await db.query(`select 1 from pg_roles where rolname = 'gems_etl'`)).rowCount === 1;
  if (!exists) await db.query(`create role gems_etl login bypassrls noinherit`);
  // 2. check, never alter, the attributes
  const [r] = (await db.query(`select rolcanlogin, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole, rolinherit
    from pg_roles where rolname = 'gems_etl'`)).rows;
  if (!(r.rolcanlogin && r.rolbypassrls && !r.rolsuper && !r.rolcreatedb && !r.rolcreaterole && !r.rolinherit)) {
    throw new Error(`gems_etl has unexpected attributes: ${JSON.stringify(r)}`);
  }
  // 3. password, quoted by the server
  const [{ sql }] = (await db.query(`select format('alter role gems_etl password %L', $1::text) as sql`, [password])).rows;
  await db.query(sql);
  // 4. schemas, tables, revokes, grants; then CONNECT (docker/initdb revokes it from public)
  await db.query(fs.readFileSync(new URL("./setup.sql", import.meta.url), "utf8"));
  const [{ grant }] = (await db.query(`select format('grant connect on database %I to gems_etl', current_database()) as grant`)).rows;
  await db.query(grant);
  console.log("etl setup done");
} finally {
  await db.end();
}
