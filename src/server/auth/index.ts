// Authentication (ADR-001, accepted 2026-10-27): first-party module, carried over from bake-off candidate B.
// argon2id (@node-rs/argon2), TOTP (@oslojs/otp) with replay protection, opaque sessions stored as SHA-256
// in app.app_session (the table RLS trusts). Each auth event and its audit row commit in one transaction.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { decodeBase32IgnorePadding, encodeBase32NoPadding } from "@oslojs/encoding";
import { generateHOTP } from "@oslojs/otp";
import { GENERIC_INVALID, POLICY, type SignIn } from "./policy";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();
const newToken = () => randomBytes(32).toString("base64url");
const ARGON = { algorithm: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 }; // argon2id, OWASP minimum

export const hashPassword = (password: string) => argonHash(password, ARGON);

export class PasswordPolicyError extends Error {
  override name = "PasswordPolicyError";
}
function assertPasswordPolicy(password: string) {
  if (password.length < POLICY.minPasswordLength) throw new PasswordPolicyError(`password must be at least ${POLICY.minPasswordLength} characters`);
}
const COOKIE = (t: string) => `__Host-gems_session=${t}; Path=/; HttpOnly; Secure; SameSite=Lax`;
const RESET_RESPONSE = { ok: true, message: "If the account exists, a reset link has been sent." };

function encKey(): Buffer {
  const k = Buffer.from(process.env["AUTH_ENC_KEY"] ?? "", "base64");
  if (k.length !== 32) throw new Error("AUTH_ENC_KEY must be 32 bytes, base64");
  return k;
}
function encrypt(plain: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}
function decrypt(box: string): Buffer {
  const [, iv, tag, body] = box.split(".");
  const d = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv!, "base64"));
  d.setAuthTag(Buffer.from(tag!, "base64"));
  return Buffer.concat([d.update(Buffer.from(body!, "base64")), d.final()]);
}

// Returns the matched 30 s step if the code is valid for now-1..now+1 and newer than lastStep (no replay).
function matchTotp(secret: Buffer, code: string, lastStep: bigint | null): bigint | null {
  const now = BigInt(Math.floor(Date.now() / 30_000));
  for (const step of [now - 1n, now, now + 1n]) {
    const expected = Buffer.from(generateHOTP(secret, step, 6));
    const given = Buffer.from(code.padEnd(6).slice(0, 6));
    if (timingSafeEqual(expected, given) && (lastStep == null || step > lastStep)) return step;
  }
  return null;
}

type Client = pg.PoolClient;

export type AuthService = ReturnType<typeof createAuth>;

export function createAuth() {
  const pool = new pg.Pool({ connectionString: process.env["AUTH_DATABASE_URL"], max: 10 });
  const dummyHash = argonHash(randomBytes(16).toString("hex"), ARGON); // equalises timing for unknown logins
  // ponytail: reset links are collected here until the e-mail adapter exists (D-COMM-1); swap for the adapter then
  const outbox: { to: string; resetToken: string }[] = [];

  async function tx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally { c.release(); }
  }
  const audit = (c: Client, userId: string | null, action: string, outcome: "OK" | "DENIED", detail: object = {}) =>
    c.query(`insert into app.audit_log (user_id, action, outcome, detail) values ($1, $2, $3::app."AuditOutcome", $4)`,
      [userId, action, outcome, JSON.stringify(detail)]);

  async function createSession(c: Client, userId: string, keep?: { createdAt: Date; expiresAt: Date }): Promise<SignIn> {
    const token = newToken();
    await c.query(`insert into app.app_session (token_hash, user_id, created_at, expires_at, step_up_at, last_seen_at)
      values ($1, $2, coalesce($3, now()), coalesce($4, now() + make_interval(hours => $5)), now(), now())`,
      [sha256(token), userId, keep?.createdAt ?? null, keep?.expiresAt ?? null, POLICY.absoluteHours]);
    return { kind: "session", token, setCookie: COOKIE(token) };
  }

  async function newChallenge(c: Client, userId: string, kind: "enrol" | "totp"): Promise<SignIn> {
    const challenge = newToken();
    await c.query(`insert into app.auth_challenge (token_hash, user_id, kind, expires_at) values ($1, $2, $3, now() + interval '5 minutes')`,
      [sha256(challenge), userId, kind]);
    return { kind, challenge };
  }

  async function takeChallenge(c: Client, challenge: string, kind: "enrol" | "totp") {
    const { rows } = await c.query(`select ch.user_id, ch.pending_secret_enc, u.totp_secret_enc, u.totp_last_step,
        coalesce(u.second_factor_locked_until > now(), false) as sf_locked
      from app.auth_challenge ch join app.app_user u on u.id = ch.user_id and app.account_usable(u.id)
      where ch.token_hash = $1 and ch.kind = $2 and ch.used_at is null and ch.expires_at > now() for update of ch`,
      [sha256(challenge), kind]);
    return rows[0] as { user_id: string; pending_secret_enc: string | null; totp_secret_enc: string | null; totp_last_step: string | null; sf_locked: boolean } | undefined;
  }

  // Second-factor guesses count per user across challenges, so re-entering the password cannot reset them.
  const SF_LOCKED: SignIn = { kind: "locked", message: "Too many attempts. Try again later." };
  async function secondFactorFailed(c: Client, userId: string, action: "auth.totp.failure" | "auth.recovery.failure"): Promise<SignIn> {
    const { rows } = await c.query(`update app.app_user set second_factor_failures = second_factor_failures + 1
      where id = $1 returning second_factor_failures`, [userId]);
    await audit(c, userId, action, "DENIED");
    if (rows[0].second_factor_failures < POLICY.secondFactorMaxFailures) return { kind: "invalid", message: "Code not accepted." };
    await c.query(`update app.app_user set second_factor_failures = 0, second_factor_locked_until = now() + make_interval(mins => $2) where id = $1`,
      [userId, POLICY.lockoutMinutes]);
    await audit(c, userId, "auth.2fa.lockout", "DENIED");
    return SF_LOCKED;
  }
  const secondFactorOk = (c: Client, userId: string) =>
    c.query(`update app.app_user set second_factor_failures = 0, second_factor_locked_until = null where id = $1`, [userId]);
  const useChallenge = (c: Client, challenge: string) => c.query(`update app.auth_challenge set used_at = now() where token_hash = $1`, [sha256(challenge)]);

  async function sessionUser(c: Client, token: string, { touch = true } = {}) {
    const { rows } = await c.query(`select s.user_id, s.created_at, s.expires_at, s.step_up_at,
        s.last_seen_at < now() - make_interval(mins => $2) as idle
      from app.app_session s join app.app_user u on u.id = s.user_id and app.account_usable(u.id)
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`, [sha256(token), POLICY.idleMinutes]);
    const r = rows[0];
    if (!r) return null;
    if (r.idle) {
      await c.query(`update app.app_session set revoked_at = now() where token_hash = $1`, [sha256(token)]);
      return null;
    }
    if (touch) await c.query(`update app.app_session set last_seen_at = now() where token_hash = $1`, [sha256(token)]);
    return r as { user_id: string; created_at: Date; expires_at: Date; step_up_at: Date | null };
  }

  async function checkPassword(c: Client, userId: string | null, stored: string | null, password: string): Promise<boolean> {
    if (userId && stored?.startsWith("legacy-md5:")) { // D-MIG-6 stand-in: verify once, then rehash
      const want = Buffer.from(stored.slice(11), "hex");
      const got = createHash("md5").update(password).digest();
      if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
      await c.query(`update app.app_user set password_hash = $2 where id = $1`, [userId, await argonHash(password, ARGON)]);
      await audit(c, userId, "auth.password.rehash", "OK");
      return true;
    }
    return argonVerify(stored ?? (await dummyHash), password).catch(() => false).then((ok) => ok && stored != null);
  }

  const revokeAll = (c: Client, userId: string) =>
    c.query(`update app.app_session set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);

  async function issueRecoveryCodes(c: Client, userId: string): Promise<string[]> {
    await c.query(`delete from app.auth_recovery_code where user_id = $1`, [userId]);
    const codes = Array.from({ length: POLICY.recoveryCodeCount }, () => randomBytes(5).toString("hex"));
    for (const code of codes) await c.query(`insert into app.auth_recovery_code (user_id, code_hash) values ($1, $2)`, [userId, sha256(code)]);
    return codes;
  }

  return {
    close: () => pool.end(),
    outbox,

    async signIn(login: string, password: string, ip: string): Promise<SignIn> {
      const limited = await tx(async (c) => {
        const { rows } = await c.query(`select count(*)::int n from app.auth_ip_attempt where ip = $1 and at > now() - make_interval(mins => $2)`, [ip, POLICY.ipWindowMinutes]);
        await c.query(`insert into app.auth_ip_attempt (ip) values ($1)`, [ip]);
        return rows[0].n >= POLICY.ipLimit;
      });
      if (limited) return { kind: "rate_limited" };
      const key = login.trim().toLowerCase();
      return tx(async (c) => {
        const throttle = (await c.query(`select failures, locked_until > now() as locked from app.auth_throttle where login_key = $1 for update`, [key])).rows[0];
        if (throttle?.locked) {
          await audit(c, null, "auth.login.locked", "DENIED", { login: key });
          return { kind: "locked", message: "Too many attempts. Try again later." };
        }
        const user = (await c.query(`select id, password_hash, requires_totp, totp_secret_enc from app.app_user where lower(login) = $1 and app.account_usable(id)`, [key])).rows[0];
        // always run the (dummy) hash check, or an unknown login answers measurably faster (T-AUTH-002b)
        const passwordOk = await checkPassword(c, user?.id ?? null, user?.password_hash ?? null, password);
        if (!user || !passwordOk) {
          const failures = (throttle?.failures ?? 0) + 1;
          const lock = failures >= POLICY.lockoutThreshold;
          await c.query(`insert into app.auth_throttle (login_key, failures, locked_until) values ($1, $2, $3)
            on conflict (login_key) do update set failures = excluded.failures, locked_until = excluded.locked_until`,
            [key, lock ? 0 : failures, lock ? new Date(Date.now() + POLICY.lockoutMinutes * 60_000) : null]);
          await audit(c, user?.id ?? null, "auth.login.failure", "DENIED", { login: key, ip });
          if (lock) await audit(c, user?.id ?? null, "auth.lockout", "DENIED", { login: key });
          return { kind: "invalid", message: GENERIC_INVALID };
        }
        await c.query(`delete from app.auth_throttle where login_key = $1`, [key]);
        if (user.requires_totp) return newChallenge(c, user.id, user.totp_secret_enc ? "totp" : "enrol");
        const s = await createSession(c, user.id);
        await audit(c, user.id, "auth.login.success", "OK", { ip });
        return s;
      });
    },

    async startTotpEnrolment(challenge: string, password: string) {
      return tx(async (c) => {
        const ch = await takeChallenge(c, challenge, "enrol");
        const stored = ch && (await c.query(`select password_hash from app.app_user where id = $1`, [ch.user_id])).rows[0]?.password_hash;
        if (!ch || !(await checkPassword(c, ch.user_id, stored, password))) throw new Error("invalid challenge or password");
        const secret = randomBytes(20);
        await c.query(`update app.auth_challenge set pending_secret_enc = $2 where token_hash = $1`, [sha256(challenge), encrypt(secret)]);
        return { secret: encodeBase32NoPadding(secret) };
      });
    },
    async confirmTotpEnrolment(challenge: string, code: string): Promise<{ result: SignIn; recoveryCodes: string[] }> {
      return tx(async (c) => {
        const ch = await takeChallenge(c, challenge, "enrol");
        if (!ch?.pending_secret_enc) return { result: { kind: "invalid", message: GENERIC_INVALID }, recoveryCodes: [] };
        if (ch.sf_locked) return { result: SF_LOCKED, recoveryCodes: [] };
        const step = matchTotp(decrypt(ch.pending_secret_enc), code, null);
        if (step == null) return { result: await secondFactorFailed(c, ch.user_id, "auth.totp.failure"), recoveryCodes: [] };
        await secondFactorOk(c, ch.user_id);
        await c.query(`update app.app_user set totp_secret_enc = $2, totp_last_step = $3 where id = $1`, [ch.user_id, ch.pending_secret_enc, step.toString()]);
        await useChallenge(c, challenge);
        const recoveryCodes = await issueRecoveryCodes(c, ch.user_id);
        const result = await createSession(c, ch.user_id);
        await audit(c, ch.user_id, "auth.totp.enrol", "OK");
        await audit(c, ch.user_id, "auth.login.success", "OK", { factor: "totp-enrol" });
        return { result, recoveryCodes };
      });
    },
    async verifyTotp(challenge: string, code: string): Promise<SignIn> {
      return tx(async (c) => {
        const ch = await takeChallenge(c, challenge, "totp");
        if (!ch?.totp_secret_enc) return { kind: "invalid", message: GENERIC_INVALID };
        if (ch.sf_locked) return SF_LOCKED;
        const step = matchTotp(decrypt(ch.totp_secret_enc), code, ch.totp_last_step == null ? null : BigInt(ch.totp_last_step));
        if (step == null) return secondFactorFailed(c, ch.user_id, "auth.totp.failure");
        await secondFactorOk(c, ch.user_id);
        await c.query(`update app.app_user set totp_last_step = $2 where id = $1`, [ch.user_id, step.toString()]);
        await useChallenge(c, challenge);
        const s = await createSession(c, ch.user_id);
        await audit(c, ch.user_id, "auth.login.success", "OK", { factor: "totp" });
        return s;
      });
    },
    async useRecoveryCode(challenge: string, code: string): Promise<SignIn> {
      return tx(async (c) => {
        const ch = await takeChallenge(c, challenge, "totp");
        if (!ch) return { kind: "invalid", message: GENERIC_INVALID };
        if (ch.sf_locked) return SF_LOCKED;
        const used = await c.query(`update app.auth_recovery_code set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null`, [ch.user_id, sha256(code)]);
        if (used.rowCount !== 1) return secondFactorFailed(c, ch.user_id, "auth.recovery.failure");
        await secondFactorOk(c, ch.user_id);
        await useChallenge(c, challenge);
        const s = await createSession(c, ch.user_id);
        await audit(c, ch.user_id, "auth.login.success", "OK", { factor: "recovery-code" });
        return s;
      });
    },
    /** Secret of an enrolment already started on this challenge (shown once, so the user can add it to an app). */
    async enrolmentSecret(challenge: string): Promise<string | null> {
      return tx(async (c) => {
        const ch = await takeChallenge(c, challenge, "enrol");
        return ch?.pending_secret_enc ? encodeBase32NoPadding(decrypt(ch.pending_secret_enc)) : null;
      });
    },
    async profile(userId: string): Promise<{ login: string; displayName: string } | null> {
      const { rows } = await pool.query(`select login, display_name from app.app_user where id = $1`, [userId]);
      return rows[0] ? { login: rows[0].login, displayName: rows[0].display_name } : null;
    },
    async regenerateRecoveryCodes(token: string, password: string) {
      return tx(async (c) => {
        const s = await sessionUser(c, token);
        const stored = s && (await c.query(`select password_hash from app.app_user where id = $1`, [s.user_id])).rows[0]?.password_hash;
        if (!s || !(await checkPassword(c, s.user_id, stored, password))) throw new Error("re-authentication failed");
        const codes = await issueRecoveryCodes(c, s.user_id);
        await audit(c, s.user_id, "auth.recovery.regenerate", "OK");
        return codes;
      });
    },

    async resolve(token: string): Promise<{ userId: string } | null> {
      return tx(async (c) => {
        const s = await sessionUser(c, token);
        return s ? { userId: s.user_id } : null;
      });
    },
    async signOut(token: string) {
      await tx(async (c) => {
        const s = await sessionUser(c, token, { touch: false });
        await c.query(`update app.app_session set revoked_at = now() where token_hash = $1 and revoked_at is null`, [sha256(token)]);
        if (s) await audit(c, s.user_id, "auth.logout", "OK");
      });
    },
    async changePassword(token: string, oldPassword: string, newPassword: string) {
      return tx(async (c) => {
        const s = await sessionUser(c, token);
        const stored = s && (await c.query(`select password_hash from app.app_user where id = $1`, [s.user_id])).rows[0]?.password_hash;
        if (!s || !(await checkPassword(c, s.user_id, stored, oldPassword))) throw new Error("password not accepted");
        assertPasswordPolicy(newPassword);
        await c.query(`update app.app_user set password_hash = $2 where id = $1`, [s.user_id, await argonHash(newPassword, ARGON)]);
        await revokeAll(c, s.user_id);
        const fresh = await createSession(c, s.user_id);
        await audit(c, s.user_id, "auth.password.change", "OK");
        return { token: (fresh as { token: string }).token };
      });
    },
    async requestReset(login: string) {
      await tx(async (c) => {
        const user = (await c.query(`select id, login from app.app_user where lower(login) = $1 and app.account_usable(id)`, [login.trim().toLowerCase()])).rows[0];
        await audit(c, user?.id ?? null, "auth.reset.request", "OK", { login: login.trim().toLowerCase() });
        if (!user) return;
        const resetToken = newToken();
        await c.query(`insert into app.auth_reset (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(mins => $3))`,
          [sha256(resetToken), user.id, POLICY.resetMinutes]);
        outbox.push({ to: user.login, resetToken }); // stands in for the e-mail adapter
      });
      return { response: RESET_RESPONSE };
    },
    async confirmReset(resetToken: string, newPassword: string) {
      assertPasswordPolicy(newPassword);
      return tx(async (c) => {
        const { rows } = await c.query(`update app.auth_reset set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id`, [sha256(resetToken)]);
        const userId = rows[0]?.user_id as string | undefined;
        if (!userId) return false;
        await c.query(`update app.app_user set password_hash = $2 where id = $1`, [userId, await argonHash(newPassword, ARGON)]);
        await revokeAll(c, userId);
        await audit(c, userId, "auth.reset.complete", "OK");
        return true;
      });
    },
    async stepUp(token: string, password: string) {
      const r = await tx(async (c) => {
        const s = await sessionUser(c, token);
        const stored = s && (await c.query(`select password_hash from app.app_user where id = $1`, [s.user_id])).rows[0]?.password_hash;
        if (!s || !(await checkPassword(c, s.user_id, stored, password))) {
          if (s) await audit(c, s.user_id, "auth.stepup.failure", "DENIED");
          return null;
        }
        // rotate: new id, same absolute window (T-AUTH-014)
        await c.query(`update app.app_session set revoked_at = now() where token_hash = $1`, [sha256(token)]);
        const fresh = await createSession(c, s.user_id, { createdAt: s.created_at, expiresAt: s.expires_at });
        await audit(c, s.user_id, "auth.stepup", "OK");
        return { token: (fresh as { token: string }).token };
      });
      if (!r) throw new Error("re-authentication failed");
      return r;
    },
    async hasFreshStepUp(token: string, maxAgeSeconds: number) {
      return tx(async (c) => {
        const s = await sessionUser(c, token, { touch: false });
        return !!s?.step_up_at && Date.now() - s.step_up_at.getTime() <= maxAgeSeconds * 1000;
      });
    },
    async revokeUserSessions(userId: string) {
      await tx(async (c) => {
        await revokeAll(c, userId);
        await audit(c, userId, "auth.sessions.revoked", "OK");
      });
    },

  };
}
