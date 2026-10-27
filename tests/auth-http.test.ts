// HTTP layer of authentication: route handlers called with real Request objects (T-AUTH-016 and the cookie/redirect contract).
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { generateHOTP } from "@oslojs/otp";
import { POST as login } from "../app/auth/login/route";
import { POST as verify } from "../app/auth/verify/route";
import { POST as enrolStart } from "../app/auth/enrol/start/route";
import { POST as enrolConfirm } from "../app/auth/enrol/confirm/route";
import { POST as logout } from "../app/auth/logout/route";
import { POST as resetRequest } from "../app/auth/reset/request/route";
import { POST as resetConfirm } from "../app/auth/reset/confirm/route";
import { auth, CHALLENGE_COOKIE, readCookie, SESSION_COOKIE } from "../src/server/auth/http";
import { hashPassword, PasswordPolicyError } from "../src/server/auth";
import { asAdmin, reset } from "./fixtures";

const ORIGIN = "https://gems.test";
const UA = { id: "00000000-0000-0000-0000-00000000000a", login: "ua", password: "centre-pass-1234" };
const HO = { id: "00000000-0000-0000-0000-0000000000ff", login: "hoall", password: "ho-pass-12345678" };

function post(path: string, fields: Record<string, string>, { origin = ORIGIN as string | null, cookie = "" } = {}) {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (origin) headers.set("origin", origin);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: new URLSearchParams(fields) });
}
const setCookies = (r: Response) => r.headers.getSetCookie();
const cookieValue = (r: Response, name: string) => readCookie(setCookies(r).find((c) => c.startsWith(`${name}=`))?.split(";")[0] ?? null, name);
const location = (r: Response) => new URL(r.headers.get("location") ?? "", ORIGIN).pathname + new URL(r.headers.get("location") ?? "", ORIGIN).search;
const totpNow = (secret: string, offset = 0) => generateHOTP(decodeBase32IgnorePadding(secret), BigInt(Math.floor(Date.now() / 30_000) + offset), 6);

beforeEach(async () => {
  await reset();
  await asAdmin(async (db) => {
    await db.query("delete from app.app_session where user_id = any($1::uuid[])", [[UA.id, HO.id]]);
    await db.query("truncate app.auth_throttle, app.auth_ip_attempt, app.auth_challenge, app.auth_recovery_code, app.auth_reset");
    await db.query("update app.app_user set password_hash = $2, requires_totp = false where id = $1", [UA.id, await hashPassword(UA.password)]);
    await db.query("update app.app_user set password_hash = $2, requires_totp = true, totp_secret_enc = null where id = $1", [HO.id, await hashPassword(HO.password)]);
  });
  auth().outbox.length = 0;
});
afterAll(() => auth().close());

describe("auth route handlers", () => {
  test("T-AUTH-016 every auth POST rejects a foreign or missing Origin, with no side effects", async () => {
    const handlers = [
      [login, "/auth/login"], [verify, "/auth/verify"], [enrolStart, "/auth/enrol/start"], [enrolConfirm, "/auth/enrol/confirm"],
      [logout, "/auth/logout"], [resetRequest, "/auth/reset/request"], [resetConfirm, "/auth/reset/confirm"],
    ] as const;
    const counts = () => asAdmin((db) => db.query(`select (select count(*)::int from app.app_session) s, (select count(*)::int from app.auth_ip_attempt) a,
      (select count(*)::int from app.audit_log) l`).then((x) => x.rows[0]));
    const before = await counts();
    for (const [handler, path] of handlers) {
      for (const origin of ["https://evil.example", null]) {
        const r = await handler(post(path, { login: UA.login, password: UA.password }, { origin }));
        expect(r.status, `${path} origin=${origin}`).toBe(403);
        expect(setCookies(r)).toEqual([]);
      }
    }
    expect(await counts()).toEqual(before); // no session, no login attempt, no audit row
  });

  test("login sets a __Host- session cookie and redirects home; wrong password sets nothing", async () => {
    const ok = await login(post("/auth/login", { login: UA.login, password: UA.password }));
    expect(ok.status).toBe(303);
    expect(location(ok)).toBe("/");
    const sc = setCookies(ok).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    for (const flag of [/; HttpOnly/, /; Secure/, /; SameSite=Lax/, /; Path=\//]) expect(sc).toMatch(flag);
    expect(await auth().resolve(cookieValue(ok, SESSION_COOKIE)!)).toEqual({ userId: UA.id });

    const bad = await login(post("/auth/login", { login: UA.login, password: "wrong" }));
    expect(location(bad)).toBe("/login?error=invalid");
    expect(setCookies(bad)).toEqual([]);
  });

  test("HO first login: enrolment via handlers, recovery codes shown once, then TOTP sign-in", async () => {
    const r1 = await login(post("/auth/login", { login: HO.login, password: HO.password }));
    expect(location(r1)).toBe("/login/enrol");
    const challengeCookie = setCookies(r1).find((c) => c.startsWith(`${CHALLENGE_COOKIE}=`))!;
    expect(challengeCookie).toMatch(/Max-Age=300/);
    const cookie = challengeCookie.split(";")[0]!;
    const challenge = readCookie(cookie, CHALLENGE_COOKIE)!;

    expect(location(await enrolStart(post("/auth/enrol/start", { password: "wrong" }, { cookie })))).toBe("/login/enrol?error=password");
    expect(location(await enrolStart(post("/auth/enrol/start", { password: HO.password }, { cookie })))).toBe("/login/enrol");
    const secret = (await auth().enrolmentSecret(challenge))!;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    const done = await enrolConfirm(post("/auth/enrol/confirm", { code: totpNow(secret) }, { cookie }));
    expect(done.status).toBe(200);
    expect(done.headers.get("cache-control")).toBe("no-store");
    const html = await done.text();
    expect(html.match(/<code>[0-9a-f]{10}<\/code>/g)).toHaveLength(10);
    expect(await auth().resolve(cookieValue(done, SESSION_COOKIE)!)).toEqual({ userId: HO.id });
    expect(setCookies(done).some((c) => c.startsWith(`${CHALLENGE_COOKIE}=;`) && /Max-Age=0/.test(c))).toBe(true);

    const r2 = await login(post("/auth/login", { login: HO.login, password: HO.password }));
    expect(location(r2)).toBe("/login/verify");
    const cookie2 = setCookies(r2).find((c) => c.startsWith(`${CHALLENGE_COOKIE}=`))!.split(";")[0]!;
    expect(location(await verify(post("/auth/verify", { code: "000000" }, { cookie: cookie2 })))).toBe("/login/verify?error=code");
    const ok = await verify(post("/auth/verify", { code: totpNow(secret, 1) }, { cookie: cookie2 }));
    expect(location(ok)).toBe("/");
    expect(await auth().resolve(cookieValue(ok, SESSION_COOKIE)!)).toEqual({ userId: HO.id });
  });

  test("logout revokes the session and clears the cookie", async () => {
    const ok = await login(post("/auth/login", { login: UA.login, password: UA.password }));
    const token = cookieValue(ok, SESSION_COOKIE)!;
    const out = await logout(post("/auth/logout", {}, { cookie: `${SESSION_COOKIE}=${token}` }));
    expect(location(out)).toBe("/login");
    expect(setCookies(out).some((c) => c.startsWith(`${SESSION_COOKIE}=;`) && /Max-Age=0/.test(c))).toBe(true);
    expect(await auth().resolve(token)).toBeNull();
  });

  test("reset: identical answer for unknown login; password policy enforced in the route and in the module", async () => {
    const known = await resetRequest(post("/auth/reset/request", { login: UA.login }));
    const unknown = await resetRequest(post("/auth/reset/request", { login: "nobody" }));
    expect(location(known)).toBe("/reset?sent=1");
    expect(location(unknown)).toBe(location(known));
    const token = auth().outbox.at(-1)!.resetToken;
    expect(location(await resetConfirm(post("/auth/reset/confirm", { token, password: "short" })))).toMatch(/error=short/);
    await expect(auth().confirmReset(token, "short")).rejects.toBeInstanceOf(PasswordPolicyError);
    expect(location(await resetConfirm(post("/auth/reset/confirm", { token, password: "a-long-new-password" })))).toBe("/login?reset=ok");
  });
});
