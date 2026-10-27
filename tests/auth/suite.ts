// T-AUTH suite (audit 09 §T-AUTH). Born in the ADR-001 bake-off; now the permanent acceptance suite for auth.
// Tests not in this suite (platform-level, still to be written) are listed in PLATFORM_TESTS and docs/STATUS.md.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { generateHOTP } from "@oslojs/otp";
import { ScopeError, withScope } from "../../src/server/db";
import { asAdmin, C, reset as resetFixtures } from "../fixtures";
import { GENERIC_INVALID, POLICY, type SignIn } from "../../src/server/auth/policy";
import type { Candidate } from "./contract";

export const PLATFORM_TESTS = {
  "T-AUTH-012": "centre deactivation: scope function (platform), identical for every candidate",
  "T-AUTH-016": "foreign Origin on server actions: enforced by Next.js itself",
  "T-AUTH-017": "API bearer tokens: separate machine-auth module, not a mandatory criterion",
};

const CENTRE_USER = { id: "00000000-0000-0000-0000-00000000000a", login: "uA", password: "centre-pass-1234", requiresTotp: false };
const HO_USER = { id: "00000000-0000-0000-0000-0000000000ff", login: "hoAll", password: "ho-pass-12345678", requiresTotp: true };

// TOTP code for the current 30 s step plus an offset (codes are single use, so tests move forward in steps)
export function totp(secret: string, offsetSteps = 0): string {
  const step = BigInt(Math.floor(Date.now() / 30_000) + offsetSteps);
  return generateHOTP(decodeBase32IgnorePadding(secret), step, 6);
}

const auditActions = () => asAdmin((db) => db.query("select action from app.audit_log order by id").then((r) => r.rows.map((x) => x.action as string)));

async function tokenStoredInPlaintext(token: string): Promise<string[]> {
  return asAdmin(async (db) => {
    const tables = (await db.query(`select table_schema s, table_name t from information_schema.tables
      where table_schema in ('app', 'ba') and table_type = 'BASE TABLE'`)).rows;
    const hits: string[] = [];
    for (const { s, t } of tables) {
      const n = (await db.query(`select count(*)::int n from "${s}"."${t}" x where x::text like $1`, [`%${token}%`])).rows[0].n;
      if (n) hits.push(`${s}.${t}`);
    }
    return hits;
  });
}

function session(r: SignIn): string {
  if (r.kind !== "session") throw new Error(`expected a session, got ${JSON.stringify(r)}`);
  return r.token;
}

export function defineSuite(make: () => Candidate) {
  const c = make();

  describe(`authentication (${c.name})`, () => {
    beforeAll(async () => {
      await asAdmin((db) => db.query(fs.readFileSync(new URL("../sql/audit-fault.sql", import.meta.url), "utf8")));
      await c.setup();
    });
    afterAll(() => c.close());
    beforeEach(async () => {
      await resetFixtures();
      await asAdmin(async (db) => {
        await db.query("delete from app.bakeoff_audit_fault");
        // the foundation fixtures seed sessions for these users; auth tests start without any
        await db.query("delete from app.app_session where user_id = any($1::uuid[])", [[CENTRE_USER.id, HO_USER.id]]);
      });
      await c.reset();
      await c.createUser(CENTRE_USER);
      await c.createUser(HO_USER);
    });

    const t = (id: string, name: string, fn: () => Promise<void>) =>
      test(`${id} ${name}`, fn);

    // HO user end to end: password, then enrol TOTP. Returns the secret and a live session.
    async function enrolHo(): Promise<{ secret: string; token: string; recoveryCodes: string[] }> {
      const r = await c.signIn(HO_USER.login, HO_USER.password, "10.0.0.1");
      expect(r.kind).toBe("enrol");
      const challenge = (r as { challenge: string }).challenge;
      const { secret } = await c.startTotpEnrolment(challenge, HO_USER.password);
      const { result, recoveryCodes } = await c.confirmTotpEnrolment(challenge, totp(secret));
      return { secret, token: session(result), recoveryCodes };
    }

    t("T-AUTH-001", "valid login: DB session, hardened cookie, token hashed at rest, audited, trusted by RLS", async () => {
      const r = await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1");
      const token = session(r);
      const cookie = (r as { setCookie: string }).setCookie;
      expect(cookie).toMatch(/^__Host-/);
      for (const flag of [/;\s*HttpOnly/i, /;\s*Secure/i, /;\s*SameSite=Lax/i, /;\s*Path=\//i]) expect(cookie).toMatch(flag);
      expect(cookie).not.toMatch(/;\s*Domain=/i);
      expect(await tokenStoredInPlaintext(token)).toEqual([]);
      expect(await c.resolve(token)).toEqual({ userId: CENTRE_USER.id });
      expect(await withScope(token, async (tx) => (await tx.$queryRaw<{ id: number }[]>`select id from app.centre`).map((x) => x.id))).toEqual([C.A]);
      expect(await auditActions()).toContain("auth.login.success");
    });

    t("T-AUTH-002", "wrong password and unknown login look identical; failure audited", async () => {
      const wrong = await c.signIn(CENTRE_USER.login, "nope", "10.0.0.2");
      const unknown = await c.signIn("no-such-user", "nope", "10.0.0.3");
      expect(wrong).toEqual({ kind: "invalid", message: GENERIC_INVALID });
      expect(unknown).toEqual(wrong);
      expect(await auditActions()).toContain("auth.login.failure");
    });

    t("T-AUTH-003", "lockout after N failures across IPs, same for unknown logins, unlocks after the window", async () => {
      for (let i = 0; i < POLICY.lockoutThreshold; i++) await c.signIn(CENTRE_USER.login, "nope", `10.1.0.${i}`);
      expect((await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.1.1.1")).kind).toBe("locked");
      for (let i = 0; i < POLICY.lockoutThreshold; i++) await c.signIn("ghost", "nope", `10.2.0.${i}`);
      expect((await c.signIn("ghost", "nope", "10.2.1.1")).kind).toBe("locked"); // no enumeration via lockout
      expect(await auditActions()).toContain("auth.lockout");
      await c.test.expireLockouts();
      expect((await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.1.1.2")).kind).toBe("session");
    });

    t("T-AUTH-004", "per-IP rate limit", async () => {
      const kinds: string[] = [];
      for (let i = 0; i <= POLICY.ipLimit; i++) kinds.push((await c.signIn(`user${i}`, "nope", "10.9.9.9")).kind);
      expect(kinds.at(-1)).toBe("rate_limited");
      expect((await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.9.9.10")).kind).toBe("session"); // other IPs unaffected
    });

    t("T-AUTH-005", "HO user without TOTP: forced enrolment, zero data access before it", async () => {
      const r = await c.signIn(HO_USER.login, HO_USER.password, "10.0.0.1");
      expect(r.kind).toBe("enrol");
      const challenge = (r as { challenge: string }).challenge;
      expect(await c.resolve(challenge)).toBeNull();
      await expect(withScope(challenge, async () => 1)).rejects.toBeInstanceOf(ScopeError);
      const { secret } = await c.startTotpEnrolment(challenge, HO_USER.password);
      const { result } = await c.confirmTotpEnrolment(challenge, totp(secret));
      expect(await c.resolve(session(result))).toEqual({ userId: HO_USER.id });
      expect(await auditActions()).toContain("auth.totp.enrol");
    });

    t("T-AUTH-006", "TOTP wrong or replayed is rejected", async () => {
      const { secret } = await enrolHo();
      const r = await c.signIn(HO_USER.login, HO_USER.password, "10.0.0.1");
      expect(r.kind).toBe("totp");
      const ch = (r as { challenge: string }).challenge;
      expect((await c.verifyTotp(ch, "000000")).kind).not.toBe("session");
      expect((await c.verifyTotp(ch, totp(secret))).kind).not.toBe("session"); // same step as enrolment: replay
      const r2 = await c.signIn(HO_USER.login, HO_USER.password, "10.0.0.1");
      const ch2 = (r2 as { challenge: string }).challenge;
      const next = totp(secret, 1);
      expect((await c.verifyTotp(ch2, next)).kind).toBe("session");
      const r3 = await c.signIn(HO_USER.login, HO_USER.password, "10.0.0.1");
      expect((await c.verifyTotp((r3 as { challenge: string }).challenge, next)).kind).not.toBe("session"); // replay of a used code
    });

    t("T-AUTH-007", "recovery codes: single use; regenerating invalidates old ones", async () => {
      const { token, recoveryCodes } = await enrolHo();
      expect(recoveryCodes.length).toBeGreaterThanOrEqual(8);
      const login = async () => ((await c.signIn(HO_USER.login, HO_USER.password, "10.0.0.1")) as { challenge: string }).challenge;
      expect((await c.useRecoveryCode(await login(), recoveryCodes[0]!)).kind).toBe("session");
      expect((await c.useRecoveryCode(await login(), recoveryCodes[0]!)).kind).not.toBe("session");
      const fresh = await c.regenerateRecoveryCodes(token, HO_USER.password);
      expect((await c.useRecoveryCode(await login(), recoveryCodes[1]!)).kind).not.toBe("session");
      await c.test.clearRateLimits(); // a burst of 4 attempts in a few ms trips sensible throttles (noted per candidate)
      expect((await c.useRecoveryCode(await login(), fresh[0]!)).kind).toBe("session");
    });

    t("T-AUTH-008", "password reset: single use, 30 min, identical response for unknown login", async () => {
      const known = await c.requestReset(CENTRE_USER.login);
      const unknown = await c.requestReset("no-such-user");
      expect(unknown.response).toEqual(known.response);
      expect(c.test.outbox.map((m) => m.to)).toEqual([CENTRE_USER.login]);
      const resetToken = c.test.outbox[0]!.resetToken;
      expect(await c.confirmReset(resetToken, "brand-new-pass-1")).toBe(true);
      expect(await c.confirmReset(resetToken, "brand-new-pass-2")).toBe(false);
      expect((await c.signIn(CENTRE_USER.login, "brand-new-pass-1", "10.0.0.1")).kind).toBe("session");
      await c.requestReset(CENTRE_USER.login);
      await c.test.ageResetTokens(POLICY.resetMinutes * 60 + 1);
      expect(await c.confirmReset(c.test.outbox.at(-1)!.resetToken, "too-late-pass-1")).toBe(false);
      expect(await auditActions()).toContain("auth.reset.request");
    });

    t("T-AUTH-009", "password change revokes all other sessions", async () => {
      const s1 = session(await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1"));
      const s2 = session(await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.2"));
      const { token } = await c.changePassword(s1, CENTRE_USER.password, "changed-pass-123");
      expect(await c.resolve(s2)).toBeNull();
      await expect(withScope(s2, async () => 1)).rejects.toBeInstanceOf(ScopeError);
      expect(await c.resolve(token)).toEqual({ userId: CENTRE_USER.id });
      expect(await auditActions()).toContain("auth.password.change");
    });

    t("T-AUTH-010", "role/scope change: revocation hook kills sessions at the app and RLS layers", async () => {
      const s = session(await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1"));
      await c.revokeUserSessions(CENTRE_USER.id);
      expect(await c.resolve(s)).toBeNull();
      await expect(withScope(s, async () => 1)).rejects.toBeInstanceOf(ScopeError);
    });

    t("T-AUTH-011", "deactivated user rejected on the next request", async () => {
      const s = session(await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1"));
      await asAdmin((db) => db.query(`update app.app_user set status = 'DISABLED' where id = $1`, [CENTRE_USER.id]));
      expect(await c.resolve(s)).toBeNull();
      await expect(withScope(s, async () => 1)).rejects.toBeInstanceOf(ScopeError);
      expect((await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1")).kind).not.toBe("session");
    });

    t("T-AUTH-013", "idle and absolute timeouts", async () => {
      const idle = session(await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1"));
      await c.test.ageSession(idle, { idleSeconds: POLICY.idleMinutes * 60 + 1 });
      expect(await c.resolve(idle)).toBeNull();
      await expect(withScope(idle, async () => 1)).rejects.toBeInstanceOf(ScopeError);
      const old = session(await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1"));
      await c.test.ageSession(old, { absoluteSeconds: POLICY.absoluteHours * 3600 + 1, idleSeconds: 0 });
      expect(await c.resolve(old)).toBeNull();
      await expect(withScope(old, async () => 1)).rejects.toBeInstanceOf(ScopeError);
    });

    t("T-AUTH-014", "session id rotated on login and on privilege change (step-up)", async () => {
      const a = session(await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1"));
      const b = session(await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1"));
      expect(a).not.toBe(b);
      const { token } = await c.stepUp(a, CENTRE_USER.password);
      expect(token).not.toBe(a);
      expect(await c.resolve(a)).toBeNull();
      expect(await c.resolve(token)).toEqual({ userId: CENTRE_USER.id });
    });

    t("T-AUTH-015", "step-up re-auth must be at most 5 minutes old", async () => {
      const s = session(await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1"));
      await expect(c.stepUp(s, "wrong-password")).rejects.toThrow();
      const { token } = await c.stepUp(s, CENTRE_USER.password);
      expect(await c.hasFreshStepUp(token, POLICY.stepUpMaxAgeSeconds)).toBe(true);
      await c.test.ageSession(token, { stepUpSeconds: POLICY.stepUpMaxAgeSeconds + 1, idleSeconds: 0 });
      expect(await c.hasFreshStepUp(token, POLICY.stepUpMaxAgeSeconds)).toBe(false);
    });

    t("T-AUTH-018", "legacy password hash: accepted once, rehashed to argon2id", async () => {
      const md5 = createHash("md5").update("legacy-pass-1").digest("hex");
      await c.test.setLegacyPassword(CENTRE_USER.id, md5);
      expect((await c.signIn(CENTRE_USER.login, "wrong", "10.0.0.1")).kind).toBe("invalid");
      expect((await c.signIn(CENTRE_USER.login, "legacy-pass-1", "10.0.0.1")).kind).toBe("session");
      expect(await c.test.storedHash(CENTRE_USER.id)).toMatch(/^\$argon2id\$/);
      expect((await c.signIn(CENTRE_USER.login, "legacy-pass-1", "10.0.0.1")).kind).toBe("session");
    });

    t("T-AUTH-019", "argon2id with at least OWASP minimum cost", async () => {
      const h = await c.test.storedHash(CENTRE_USER.id);
      const m = h.match(/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/);
      expect(m, h.slice(0, 40)).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(19456);
      expect(Number(m![2])).toBeGreaterThanOrEqual(2);
    });

    t("T-AUTH-020", "audit coverage, and the audit row is in the same transaction as the auth event", async () => {
      const s = session(await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1"));
      await c.signOut(s);
      expect(await c.resolve(s)).toBeNull();
      expect(await auditActions()).toEqual(expect.arrayContaining(["auth.login.success", "auth.logout"]));
      // fault injection: if the audit row cannot be written, the login must not happen
      await asAdmin((db) => db.query("insert into app.bakeoff_audit_fault default values"));
      const r = await c.signIn(CENTRE_USER.login, CENTRE_USER.password, "10.0.0.1").catch(() => ({ kind: "error" as const }));
      await asAdmin((db) => db.query("delete from app.bakeoff_audit_fault"));
      expect(r.kind).not.toBe("session");
      expect(await c.test.liveSessionCount(CENTRE_USER.id)).toBe(0);
    });
  });
}
