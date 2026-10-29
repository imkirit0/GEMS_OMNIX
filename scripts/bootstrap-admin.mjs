// One-time creation of the first administrator (the admin screens need an admin to exist).
// Usage:   node scripts/bootstrap-admin.mjs <login> "<Display Name>" [origin]
// Database: ADMIN_DATABASE_URL (local values come from .env.local). This never falls back to the Supabase URLs in .env;
//           for a hosted database pass ADMIN_DATABASE_URL explicitly on the command line.
// Refuses to run if an active user already holds rbac.user.manage for all centres.
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const SETUP_LINK_HOURS = 72; // same as src/server/rbac.ts (PMC)
const ADMIN_PERMISSIONS = ["rbac.view", "rbac.user.manage", "rbac.role.manage", "catalogue.manage"]; // catalogue DD-12

export async function bootstrapAdmin(db, { login, displayName }) {
  const key = String(login ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(key) || !String(displayName ?? "").trim()) throw new Error("login (letters, digits, . _ -) and display name are required");
  await db.query("begin");
  try {
    const existing = await db.query(`select 1 from app.role_assignment ra
      join app.role_permission rp on rp.role_id = ra.role_id and rp.permission_key = 'rbac.user.manage'
      join app.app_user u on u.id = ra.user_id and u.status = 'ACTIVE'
      where ra.scope_kind = 'ALL' limit 1`);
    if (existing.rowCount) throw new Error("an administrator already exists; use the admin screens instead");
    const role = (await db.query(`insert into app.role (key, name) values ('system_admin', 'System administrator')
      on conflict (key) do update set name = app.role.name returning id`)).rows[0].id;
    for (const p of ADMIN_PERMISSIONS) await db.query(`insert into app.role_permission (role_id, permission_key) values ($1, $2) on conflict do nothing`, [role, p]);
    const user = (await db.query(`insert into app.app_user (id, login, display_name, status, requires_totp)
      values (gen_random_uuid(), $1, $2, 'ACTIVE', true) returning id`, [key, String(displayName).trim()])).rows[0].id;
    await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind) values ($1, $2, 'ALL')`, [user, role]);
    const token = randomBytes(32).toString("base64url");
    await db.query(`insert into app.auth_reset (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(hours => $3))`,
      [createHash("sha256").update(token, "utf8").digest(), user, SETUP_LINK_HOURS]);
    await db.query(`insert into app.audit_log (user_id, action, outcome, detail) values (null, 'rbac.bootstrap', 'OK', $1)`, [JSON.stringify({ login: key, userId: user })]);
    await db.query("commit");
    return { userId: user, token };
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  config({ path: ".env.local", quiet: true });
  const [login, displayName, origin = "http://localhost:3000"] = process.argv.slice(2);
  const url = process.env["ADMIN_DATABASE_URL"];
  if (!url) throw new Error("ADMIN_DATABASE_URL is not set");
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const { token } = await bootstrapAdmin(db, { login, displayName });
    console.log(`Administrator "${login.toLowerCase()}" created. Two-step verification will be required at first sign-in.`);
    console.log(`One-time set-up link (valid ${SETUP_LINK_HOURS} h, shown once):\n${new URL(`/reset/confirm?token=${encodeURIComponent(token)}`, origin)}`);
  } finally {
    await db.end();
  }
}
