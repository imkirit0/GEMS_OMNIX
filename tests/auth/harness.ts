// Test harness: the production auth module plus admin-side hooks the T-AUTH suite needs (time travel, provisioning).
import { createHash } from "node:crypto";
import pg from "pg";
import { createAuth, hashPassword } from "../../src/server/auth";
import type { Candidate, NewUser } from "./contract";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

export function authHarness(): Candidate {
  const auth = createAuth();
  const { outbox } = auth;
  return {
    ...auth,
    name: "first-party",
    async setup() {},
    async reset() {
      outbox.length = 0;
      await admin((c) => c.query(`truncate app.auth_throttle, app.auth_ip_attempt, app.auth_challenge, app.auth_recovery_code, app.auth_reset`));
    },
    async createUser(u: NewUser) {
      await admin(async (c) => c.query(`update app.app_user set password_hash = $2, requires_totp = $3, totp_secret_enc = null, totp_last_step = null where id = $1`,
        [u.id, await hashPassword(u.password), u.requiresTotp]));
    },
    test: {
      outbox,
      async ageSession(token, { idleSeconds = 0, absoluteSeconds = 0, stepUpSeconds = 0 }) {
        const admin = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
        await admin.connect();
        try {
          await admin.query(`update app.app_session set last_seen_at = last_seen_at - make_interval(secs => $2),
            created_at = created_at - make_interval(secs => $3), expires_at = expires_at - make_interval(secs => $3),
            step_up_at = step_up_at - make_interval(secs => $4) where token_hash = $1`, [sha256(token), idleSeconds, absoluteSeconds, stepUpSeconds]);
        } finally { await admin.end(); }
      },
      async setLegacyPassword(userId, md5Hex) {
        const admin = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
        await admin.connect();
        try { await admin.query(`update app.app_user set password_hash = $2 where id = $1`, [userId, `legacy-md5:${md5Hex}`]); } finally { await admin.end(); }
      },
      async storedHash(userId) {
        const admin = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
        await admin.connect();
        try { return (await admin.query(`select password_hash from app.app_user where id = $1`, [userId])).rows[0].password_hash; } finally { await admin.end(); }
      },
      async expireLockouts() {
        const admin = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
        await admin.connect();
        try { await admin.query(`update app.auth_throttle set locked_until = now() - interval '1 second'`);
          await admin.query(`update app.app_user set second_factor_locked_until = now() - interval '1 second'`); } finally { await admin.end(); }
      },
      async ageResetTokens(seconds) {
        const admin = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
        await admin.connect();
        try { await admin.query(`update app.auth_reset set expires_at = expires_at - make_interval(secs => $1)`, [seconds]); } finally { await admin.end(); }
      },
      async clearRateLimits() {
        const admin = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
        await admin.connect();
        try { await admin.query(`truncate app.auth_ip_attempt`); } finally { await admin.end(); }
      },
      async liveSessionCount(userId) {
        const admin = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"] });
        await admin.connect();
        try { return (await admin.query(`select count(*)::int n from app.app_session where user_id = $1 and revoked_at is null and expires_at > now()`, [userId])).rows[0].n; }
        finally { await admin.end(); }
      },
    },
  };
}
