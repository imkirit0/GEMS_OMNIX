// ADR-001 candidate A: Better Auth 1.7.12 (username + twoFactor plugins), configured as favourably as its
// options allow. Everything Better Auth does not do natively is marked GLUE so the surface can be measured.
import fs from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { betterAuth } from "better-auth";
import { twoFactor, username } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { serializeSignedCookie } from "better-call";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { GENERIC_INVALID, POLICY, type Candidate, type NewUser, type SignIn } from "../contract";

const ARGON = { algorithm: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const BASE = "https://gems.local";
const COOKIE_NAME = "__Host-gems_session";
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();
const emailOf = (login: string) => `${login.trim().toLowerCase()}@gems.local`; // GLUE: BA resets by e-mail

export function betterAuthCandidate(): Candidate {
  const secret = randomBytes(32).toString("base64");
  const pool = new pg.Pool({ connectionString: process.env["AUTH_DATABASE_URL"], max: 10, options: "-c search_path=ba" });
  const outbox: { to: string; resetToken: string }[] = [];
  const pendingCodes = new Map<string, string[]>(); // backup codes shown at enrolment, keyed by challenge
  const admin = async <T>(fn: (c: pg.Client) => Promise<T>) => {
    const c = new pg.Client({ connectionString: process.env["ADMIN_DATABASE_URL"], options: "-c search_path=ba" });
    await c.connect();
    try { return await fn(c); } finally { await c.end(); }
  };
  // GLUE: audit rows are written by us, on our own connection (Better Auth has no transaction hook for this)
  const audit = (userId: string | null, action: string, outcome: "OK" | "DENIED", detail: object = {}) =>
    pool.query(`insert into app.audit_log (user_id, action, outcome, detail) values ($1, $2, $3::app."AuditOutcome", $4)`,
      [userId, action, outcome, JSON.stringify(detail)]);
  // GLUE: policy facts Better Auth does not hold (status, TOTP requirement)
  const userFacts = async (userId: string) =>
    (await pool.query(`select u.status, u.requires_totp, coalesce(b."twoFactorEnabled", false) as tfa
      from app.app_user u left join ba."user" b on b.id = u.id::text where u.id = $1`, [userId])).rows[0] as
      { status: string; requires_totp: boolean; tfa: boolean } | undefined;
  const gated = (f?: { status: string; requires_totp: boolean; tfa: boolean }) => !f || f.status !== "ACTIVE" || (f.requires_totp && !f.tfa);

  const options = {
    database: pool,
    secret,
    baseURL: BASE,
    basePath: "/api/auth",
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // users are provisioned by HO
      resetPasswordTokenExpiresIn: POLICY.resetMinutes * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }: { user: { id: string }; token: string }) => {
        const login = (await pool.query(`select login from app.app_user where id = $1`, [user.id])).rows[0]?.login;
        outbox.push({ to: login, resetToken: token });
      },
      password: {
        hash: (p: string) => argonHash(p, ARGON),
        verify: async ({ hash, password }: { hash: string; password: string }) => {
          if (hash.startsWith("legacy-md5:")) { // GLUE: legacy scheme (rehash happens in the after-hook)
            const want = Buffer.from(hash.slice(11), "hex");
            const got = createHash("md5").update(password).digest();
            return want.length === got.length && timingSafeEqual(want, got);
          }
          return argonVerify(hash, password).catch(() => false);
        },
      },
    },
    session: { expiresIn: POLICY.idleMinutes * 60, updateAge: 0, freshAge: POLICY.stepUpMaxAgeSeconds }, // sliding idle window
    rateLimit: { enabled: true, storage: "database" as const, window: 600, max: 100_000,
      customRules: { "/sign-in/username": { window: POLICY.ipWindowMinutes * 60, max: POLICY.ipLimit } } },
    advanced: {
      useSecureCookies: false, // otherwise BA forces a "__Secure-" prefix and __Host- is impossible
      cookies: { session_token: { name: COOKIE_NAME, attributes: { secure: true } } },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    plugins: [username({ minUsernameLength: 1 }), twoFactor({ issuer: "GEMS OMNIX", backupCodeOptions: { storeBackupCodes: "encrypted" } })], // legacy logins can be short
    databaseHooks: {
      session: {
        create: {
          // GLUE: login audit placed before the session insert so an audit failure blocks the login
          before: async (s: { userId: string }) => { await audit(s.userId, "auth.login.success", "OK"); },
          // GLUE: mirror the session into app.app_session (hashed) so RLS can trust it, unless gated
          after: async (s: { token: string; userId: string; expiresAt: Date }) => {
            if (gated(await userFacts(s.userId))) return;
            await pool.query(`insert into app.app_session (token_hash, user_id, expires_at, step_up_at, last_seen_at)
              values ($1, $2, $3, now(), now()) on conflict (token_hash) do nothing`, [sha256(s.token), s.userId, s.expiresAt]);
          },
        },
        update: { after: async (s: { token?: string; expiresAt?: Date }) => {
          if (s.token && s.expiresAt) await pool.query(`update app.app_session set expires_at = $2, last_seen_at = now() where token_hash = $1`, [sha256(s.token), s.expiresAt]);
        } },
        delete: { after: async (s: { token: string }) => {
          await pool.query(`update app.app_session set revoked_at = now() where token_hash = $1 and revoked_at is null`, [sha256(s.token)]);
        } },
      },
    },
    hooks: {
      // GLUE: account lockout and disabled users (Better Auth has neither for passwords)
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/username") return;
        const key = String(ctx.body?.username ?? "").trim().toLowerCase();
        const t = (await pool.query(`select locked_until > now() as locked from app.auth_throttle where login_key = $1`, [key])).rows[0];
        if (t?.locked) {
          await audit(null, "auth.login.locked", "DENIED", { login: key });
          throw new APIError("FORBIDDEN", { message: "LOCKED", code: "ACCOUNT_LOCKED" });
        }
        const u = (await pool.query(`select status from app.app_user where lower(login) = $1`, [key])).rows[0];
        if (u && u.status !== "ACTIVE") throw new APIError("UNAUTHORIZED", { message: GENERIC_INVALID, code: "INVALID_USERNAME_OR_PASSWORD" });
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/username") return;
        const key = String(ctx.body?.username ?? "").trim().toLowerCase();
        const returned = ctx.context.returned;
        if (returned instanceof APIError) {
          if ((returned.body as { code?: string } | undefined)?.code === "ACCOUNT_LOCKED") return;
          const row = (await pool.query(`insert into app.auth_throttle (login_key, failures) values ($1, 1)
            on conflict (login_key) do update set failures = app.auth_throttle.failures + 1 returning failures`, [key])).rows[0];
          await audit(null, "auth.login.failure", "DENIED", { login: key });
          if (row.failures >= POLICY.lockoutThreshold) {
            await pool.query(`update app.auth_throttle set failures = 0, locked_until = now() + make_interval(mins => $2) where login_key = $1`, [key, POLICY.lockoutMinutes]);
            await audit(null, "auth.lockout", "DENIED", { login: key });
          }
          return;
        }
        await pool.query(`delete from app.auth_throttle where login_key = $1`, [key]);
        // GLUE: legacy rehash on successful password login
        const userId = (ctx.context.newSession as { user?: { id: string } } | null)?.user?.id
          ?? (await pool.query(`select id::text from app.app_user where lower(login) = $1`, [key])).rows[0]?.id;
        const acct = userId && (await pool.query(`select password from ba.account where "userId" = $1 and "providerId" = 'credential'`, [userId])).rows[0];
        if (acct?.password?.startsWith("legacy-md5:")) {
          await pool.query(`update ba.account set password = $2 where "userId" = $1 and "providerId" = 'credential'`, [userId, await argonHash(String(ctx.body.password), ARGON)]);
          await audit(userId, "auth.password.rehash", "OK");
        }
      }),
    },
  };
  // Built lazily: Better Auth checks the DB schema at construction, so it must exist first (setup()).
  let built: { handler: (r: Request) => Promise<Response>; api: unknown } | undefined;
  const auth = () => (built ??= betterAuth(options as never) as unknown as NonNullable<typeof built>);
  // the plugin endpoints are not visible on the inferred type when options are built dynamically
  type Endpoint = (a: unknown) => Promise<any>;
  type Api = Record<"getSession" | "enableTwoFactor" | "verifyTOTP" | "generateBackupCodes" | "revokeSession"
    | "signOut" | "changePassword" | "requestPasswordReset" | "resetPassword" | "verifyPassword", Endpoint>;
  const api = new Proxy({} as Api, { get: (_, k: string) => (a: unknown) => (auth().api as Record<string, Endpoint>)[k]!(a) });

  const signedCookie = async (raw: string) => (await serializeSignedCookie(COOKIE_NAME, raw, secret)).split(";")[0]!;
  const headersFor = async (raw: string) => new Headers({ cookie: await signedCookie(raw), origin: BASE });
  const rawFromSetCookie = (setCookie: string | null): string | null => {
    const m = setCookie?.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    return m ? decodeURIComponent(m[1]!).split(".")[0]! : null;
  };
  const sessionResult = (headers: Headers): SignIn => {
    const all = headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
    const cookie = all.findLast((c) => c.startsWith(`${COOKIE_NAME}=`)) ?? ""; // BA may set an intermediate cookie first
    const raw = rawFromSetCookie(cookie);
    if (!raw) return { kind: "invalid", message: GENERIC_INVALID };
    return { kind: "session", token: raw, setCookie: cookie };
  };
  const post = (path: string, body: object, extra: Record<string, string> = {}) =>
    auth().handler(new Request(`${BASE}/api/auth${path}`, { method: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: BASE, ...extra } }));
  const twoFactorCookie = (res: Response) => (res.headers.getSetCookie() ?? []).filter((c) => /two_factor/.test(c)).map((c) => c.split(";")[0]).join("; ");

  // GLUE: mirror an existing session once its user is no longer gated (after TOTP enrolment)
  const mirror = async (raw: string, userId: string) => {
    await pool.query(`insert into app.app_session (token_hash, user_id, expires_at, step_up_at, last_seen_at)
      select $1, $2, "expiresAt", now(), now() from ba.session where token = $3 on conflict (token_hash) do nothing`, [sha256(raw), userId, raw]);
  };
  const sessionOf = async (raw: string) =>
    (await pool.query(`select "userId" as user_id, "createdAt" as created_at from ba.session where token = $1 and "expiresAt" > now()`, [raw])).rows[0] as
      { user_id: string; created_at: Date } | undefined;

  return {
    name: "A-better-auth",
    async setup() {
      await admin(async (c) => {
        await c.query(`create schema if not exists ba`);
        await c.query(`alter table app.app_user add column if not exists requires_totp boolean not null default false`);
        await c.query(`alter table app.app_session add column if not exists last_seen_at timestamptz not null default now()`);
        await c.query(`create table if not exists app.auth_throttle (login_key text primary key, failures int not null default 0, locked_until timestamptz)`);
        await c.query(`grant select, insert, update, delete on app.auth_throttle to gems_auth`);
      });
      const migPool = new pg.Pool({ connectionString: process.env["ADMIN_DATABASE_URL"], options: "-c search_path=ba" });
      try {
        const { runMigrations } = await getMigrations({ ...options, database: migPool } as never);
        await runMigrations();
      } finally { await migPool.end(); }
      await admin((c) => c.query(`grant usage on schema ba to gems_auth; grant select, insert, update, delete on all tables in schema ba to gems_auth`));
    },
    async reset() {
      outbox.length = 0;
      await admin((c) => c.query(`truncate ba."twoFactor", ba.verification, ba.session, ba.account, ba."user", ba."rateLimit" cascade; truncate app.auth_throttle`));
    },
    close: () => pool.end(),
    async createUser(u: NewUser) {
      await admin(async (c) => {
        await c.query(`update app.app_user set requires_totp = $2 where id = $1`, [u.id, u.requiresTotp]);
        await c.query(`insert into ba."user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername", "twoFactorEnabled")
          values ($1, $2, $3, true, now(), now(), $4, $2, false)`, [u.id, u.login, emailOf(u.login), u.login.toLowerCase()]);
        await c.query(`insert into ba.account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
          values ($1, $2, 'credential', $2, $3, now(), now())`, [randomBytes(12).toString("hex"), u.id, await argonHash(u.password, ARGON)]);
      });
    },

    async signIn(login, password, ip) {
      const res = await post("/sign-in/username", { username: login, password }, { "x-forwarded-for": ip });
      if (res.status === 429) return { kind: "rate_limited" };
      const body = await res.json().catch(() => ({}));
      if (body?.code === "ACCOUNT_LOCKED") return { kind: "locked", message: "Too many attempts. Try again later." };
      if (!res.ok) return { kind: "invalid", message: GENERIC_INVALID };
      if (body?.twoFactorRedirect) return { kind: "totp", challenge: twoFactorCookie(res) };
      const r = sessionResult(res.headers);
      if (r.kind === "session" && gated(await userFacts(body.user.id))) return { kind: "enrol", challenge: r.token }; // GLUE
      return r;
    },
    async startTotpEnrolment(challenge, password) {
      const r = await api.enableTwoFactor({ body: { password }, headers: await headersFor(challenge) });
      pendingCodes.set(challenge, r.backupCodes);
      return { secret: new URL(r.totpURI).searchParams.get("secret")! };
    },
    async confirmTotpEnrolment(challenge, code) {
      const s = await sessionOf(challenge);
      const codes = pendingCodes.get(challenge) ?? [];
      pendingCodes.delete(challenge);
      const ok = await api.verifyTOTP({ body: { code }, headers: await headersFor(challenge), returnHeaders: true }).catch(() => null);
      if (!ok || !s) return { result: { kind: "invalid", message: "Code not accepted." }, recoveryCodes: [] };
      const fromHeaders = sessionResult(ok.headers);
      const token = fromHeaders.kind === "session" ? fromHeaders.token : challenge;
      await mirror(token, s.user_id); // GLUE
      await audit(s.user_id, "auth.totp.enrol", "OK"); // GLUE
      return { result: { kind: "session", token, setCookie: `${COOKIE_NAME}=…` }, recoveryCodes: codes };
    },
    async verifyTotp(challenge, code) {
      const res = await post("/two-factor/verify-totp", { code }, { cookie: challenge });
      return res.ok ? sessionResult(res.headers) : { kind: "invalid", message: "Code not accepted." };
    },
    async useRecoveryCode(challenge, code) {
      const res = await post("/two-factor/verify-backup-code", { code }, { cookie: challenge });
      return res.ok ? sessionResult(res.headers) : { kind: "invalid", message: "Code not accepted." };
    },
    async regenerateRecoveryCodes(token, password) {
      const r = await api.generateBackupCodes({ body: { password }, headers: await headersFor(token) });
      return r.backupCodes;
    },

    async resolve(token) {
      const r = await api.getSession({ headers: await headersFor(token) }).catch(() => null);
      if (!r) return null;
      const f = await userFacts(r.user.id);
      // GLUE: absolute timeout, user status and the TOTP gate are ours
      const tooOld = Date.now() - new Date(r.session.createdAt).getTime() > POLICY.absoluteHours * 3_600_000;
      if (tooOld || gated(f)) {
        if (tooOld) await api.revokeSession({ body: { token }, headers: await headersFor(token) }).catch(() => {});
        return null;
      }
      return { userId: r.user.id };
    },
    async signOut(token) {
      const s = await sessionOf(token);
      await api.signOut({ headers: await headersFor(token) });
      if (s) await audit(s.user_id, "auth.logout", "OK"); // GLUE
    },
    async changePassword(token, oldPassword, newPassword) {
      const s = await sessionOf(token);
      const r = await api.changePassword({ body: { currentPassword: oldPassword, newPassword, revokeOtherSessions: true },
        headers: await headersFor(token), returnHeaders: true });
      const fresh = sessionResult(r.headers);
      if (s) await audit(s.user_id, "auth.password.change", "OK"); // GLUE
      return { token: fresh.kind === "session" ? fresh.token : token };
    },
    async requestReset(login) {
      const response = await api.requestPasswordReset({ body: { email: emailOf(login), redirectTo: `${BASE}/reset` } }).catch((e: unknown) => ({ error: String(e) }));
      await audit(null, "auth.reset.request", "OK", { login: login.trim().toLowerCase() }); // GLUE
      return { response };
    },
    async confirmReset(resetToken, newPassword) {
      return api.resetPassword({ body: { token: resetToken, newPassword } }).then(() => true, () => false);
    },
    async stepUp(token, password) {
      const s = await sessionOf(token);
      await api.verifyPassword({ body: { password }, headers: await headersFor(token) }); // throws on failure
      // GLUE: Better Auth has no rotation on privilege change; create a new session and drop the old one
      const ctx = await (auth() as unknown as { $context: Promise<{ internalAdapter: any }> }).$context;
      const fresh = await ctx.internalAdapter.createSession(s!.user_id);
      await ctx.internalAdapter.deleteSession(token);
      await audit(s!.user_id, "auth.stepup", "OK");
      return { token: fresh.token };
    },
    async hasFreshStepUp(token, maxAgeSeconds) {
      const r = (await pool.query(`select step_up_at from app.app_session where token_hash = $1 and revoked_at is null`, [sha256(token)])).rows[0];
      return !!r?.step_up_at && Date.now() - new Date(r.step_up_at).getTime() <= maxAgeSeconds * 1000;
    },
    async revokeUserSessions(userId) {
      const ctx = await (auth() as unknown as { $context: Promise<{ internalAdapter: any }> }).$context;
      await ctx.internalAdapter.deleteUserSessions(userId);
      // GLUE: bulk deletes do not report individual sessions to hooks, so revoke the RLS mirror ourselves
      await pool.query(`update app.app_session set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
      await audit(userId, "auth.sessions.revoked", "OK");
    },

    test: {
      outbox,
      async ageSession(token, { idleSeconds = 0, absoluteSeconds = 0, stepUpSeconds = 0 }) {
        await admin(async (c) => {
          await c.query(`update ba.session set "expiresAt" = "expiresAt" - make_interval(secs => $2), "createdAt" = "createdAt" - make_interval(secs => $3) where token = $1`,
            [token, idleSeconds, absoluteSeconds]);
          await c.query(`update app.app_session set expires_at = expires_at - make_interval(secs => $2), step_up_at = step_up_at - make_interval(secs => $3) where token_hash = $1`,
            [sha256(token), idleSeconds, stepUpSeconds]);
        });
      },
      setLegacyPassword: (userId, md5Hex) => admin((c) => c.query(`update ba.account set password = $2 where "userId" = $1`, [userId, `legacy-md5:${md5Hex}`])).then(() => {}),
      storedHash: (userId) => admin((c) => c.query(`select password from ba.account where "userId" = $1`, [userId])).then((r) => r.rows[0].password),
      expireLockouts: () => admin((c) => c.query(`update app.auth_throttle set locked_until = now() - interval '1 second'`)).then(() => {}),
      ageResetTokens: (seconds) => admin((c) => c.query(`update ba.verification set "expiresAt" = "expiresAt" - make_interval(secs => $1)`, [seconds])).then(() => {}),
      clearRateLimits: () => admin((c) => c.query(`truncate ba."rateLimit"`)).then(() => {}),
      liveSessionCount: (userId) => admin((c) => c.query(`select count(*)::int n from ba.session where "userId" = $1 and "expiresAt" > now()`, [userId])).then((r) => r.rows[0].n),
    },
  };
}
