// Audit trail (audit 09 §T-AUD): 001 field set, 004 tamper-proofing, 005 redaction, 009 coverage gate.
// 002 (rollback leaves no row) and 003 (denial row only) are asserted in foundation/rbac/exports tests.
import { beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createHash } from "node:crypto";
import { scopedAction } from "../src/server/action";
import { allocate } from "../src/server/numbering";
import { withRequestContext } from "../src/server/request-context";
import { redactText, safeRoute } from "../src/server/safe-route";
import { assignRole, createRole, createUser, removeAssignment, setRolePermissions, setUserStatus } from "../src/server/rbac";
import { createAuth, hashPassword } from "../src/server/auth";
import { totp } from "./auth/suite";
import { DATASETS, exportCsv } from "../src/server/exports";
import { AUDIT_CATALOGUE } from "./audit-catalogue";
import { asAdmin, C, PERIOD, reset, rows, T } from "./fixtures";

const HO = "00000000-0000-0000-0000-0000000000ff";
const ctx = { requestId: "req-aud-001", ip: "10.20.30.40" };
const files = (dir: string, ext: RegExp): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name), ext) : ext.test(e.name) ? [path.join(dir, e.name)] : []));

beforeEach(async () => {
  await reset();
  await asAdmin(async (db) => {
    await db.query(`update app.app_session set step_up_at = now() where token_hash = sha256(convert_to('tok-hoAll', 'UTF8'))`);
    await db.query(`insert into app.permission (key, description) values ('org.centre.export', 'Export centres') on conflict do nothing`);
    await db.query(`insert into app.role (id, key, name) values (91, 'centre_exporter', 'Centre exporter')`);
    await db.query(`insert into app.role_permission values (91, 'org.centre.export')`);
    await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind) values ($1, 91, 'ALL')`, [HO]);
  });
});

describe("audit trail", () => {
  test("T-AUD-001 each sensitive action writes exactly one row with the complete field set", async () => {
    // order matters: changing a role signs its holders out, so that comes last and targets a role the actor does not hold
    const alloc = await scopedAction(T.uA, { action: "numbering.allocate", permission: "numbering.series.allocate", centreId: C.A },
      (tx) => allocate(tx, { centreId: C.A, docType: "FEEREC", period: PERIOD }));
    expect(alloc).toBe(1n);
    const created = await withRequestContext(ctx, async () => {
      await new Response((await exportCsv(T.hoAll, "centres")).stream).text();
      const id = await createUser(T.hoAll, { login: "audited", displayName: "Audited" });
      await setUserStatus(T.hoAll, id, "DISABLED", "left the company");
      await setRolePermissions(T.hoAll, 1, ["org.centre.view", "numbering.series.allocate", "rbac.view"]); // centre_admin
      return id;
    });
    const sessionHash = createHash("sha256").update("tok-hoAll").digest();
    for (const action of ["rbac.user.create", "rbac.user.disable", "rbac.role.permissions", "export.centres"]) {
      const r = await rows(action);
      expect(r, action).toHaveLength(1);
      expect(r[0], action).toMatchObject({ user_id: HO, outcome: "OK", request_id: ctx.requestId, client_ip: ctx.ip, actor_kind: "user" });
      expect(Buffer.compare(r[0].session_hash, sessionHash), `${action} session`).toBe(0);
      expect(r[0].actor_roles, `${action} roles`).toEqual(["centre_exporter", "ho_viewer", "rbac_admin"]);
      expect(r[0].actor_scope, `${action} scope`).toEqual([C.A, C.A2, C.B]);
      expect(r[0].at).toBeInstanceOf(Date);
    }
    const disable = (await rows("rbac.user.disable"))[0];
    expect(disable).toMatchObject({ target_type: "app_user", target_id: created, reason: "left the company",
      before: { status: "ACTIVE" }, after: { status: "DISABLED" } });
    const perms = (await rows("rbac.role.permissions"))[0];
    expect(perms).toMatchObject({ target_type: "role", target_id: "1", before: { permissions: ["numbering.series.allocate", "org.centre.view"] },
      after: { permissions: ["numbering.series.allocate", "org.centre.view", "rbac.view"] } });
    expect((await rows("numbering.allocate"))[0]).toMatchObject({ user_id: "00000000-0000-0000-0000-00000000000a", target_centre_id: C.A,
      actor_roles: ["centre_admin"], actor_scope: [C.A], request_id: null }); // outside a request: no request id, never a fake one
  });

  test("T-AUD-001 a streamed export read after the request handler returned keeps the request id", async () => {
    // the HTTP layer reads the body outside the handler's async context; the audit must not lose the request id
    const { stream } = await withRequestContext({ requestId: "req-stream", ip: "10.9.8.7" }, () => exportCsv(T.hoAll, "centres"));
    await new Response(stream).text(); // read outside the context
    expect((await rows("export.centres")).at(-1)).toMatchObject({ request_id: "req-stream", client_ip: "10.9.8.7" });
  });

  test("T-AUD-004 no runtime role can alter, delete, truncate or forge audit rows", async () => {
    await withRequestContext(ctx, () => createUser(T.hoAll, { login: "x1", displayName: "x" }));
    const urls: Record<string, string> = { gems_app: process.env["APP_DATABASE_URL"]!, gems_job: process.env["JOB_DATABASE_URL"]!, gems_auth: process.env["AUTH_DATABASE_URL"]! };
    for (const [role, url] of Object.entries(urls)) {
      const db = new pg.Client({ connectionString: url });
      await db.connect();
      try {
        for (const sql of ["update app.audit_log set action = 'x'", "delete from app.audit_log", "truncate app.audit_log"]) {
          await expect(db.query(sql), `${role}: ${sql}`).rejects.toMatchObject({ code: "42501" });
        }
        if (role !== "gems_auth") { // app and job roles may only write through app.audit(), which takes the actor from the session
          await expect(db.query(`insert into app.audit_log (user_id, action, outcome) values ('${HO}', 'forged', 'OK')`), `${role} forge`).rejects.toMatchObject({ code: "42501" });
        }
      } finally { await db.end(); }
    }
    await asAdmin(async (db) => { // even the owner is stopped by the trigger
      await expect(db.query("update app.audit_log set action = 'x'")).rejects.toThrow(/append-only/);
    });
  });

  test("T-AUD-005 personal identifiers and secrets are masked in audit data and in logs", async () => {
    await scopedAction(T.uA, { action: "numbering.allocate", permission: "numbering.series.allocate", centreId: C.A },
      (tx) => allocate(tx, { centreId: C.A, docType: "FEEREC", period: PERIOD }),
      () => ({ before: { aadhaar_no: "1234 5678 9012", name: "Asha" }, after: { pan: "ABCDE1234F" },
        nested: { bank_account_number: "123456789012", password: "hunter2", recovery_codes: ["a1", "b2"], ok: "kept" }, key: "role.key" }));
    const r = (await rows("numbering.allocate"))[0];
    expect(r.before).toEqual({ aadhaar_no: "[redacted]", name: "Asha" });
    expect(r.after).toEqual({ pan: "[redacted]" });
    expect(r.detail).toEqual({ nested: { bank_account_number: "[redacted]", password: "[redacted]", recovery_codes: "[redacted]", ok: "kept" }, key: "role.key" });
    expect(JSON.stringify(r)).not.toMatch(/1234 5678 9012|ABCDE1234F|123456789012|hunter2/);

    expect(redactText("Aadhaar 1234 5678 9012, PAN ABCDE1234F, a/c 001234567890123, postgresql://u:pw@h/db"))
      .toBe("Aadhaar [aadhaar], PAN [pan], a/c [number], postgresql://u:[secret]@h/db");
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: unknown) => { logged.push(String(m)); });
    try {
      await safeRoute(async () => { throw new Error("insert failed for aadhaar 1234 5678 9012 pan ABCDE1234F"); })(new Request("https://gems.test/x", { method: "POST" }));
    } finally { spy.mockRestore(); }
    expect(logged.join("\n")).not.toMatch(/1234 5678 9012|ABCDE1234F/);
  });

  test("T-AUD-009 every catalogued action is really written when its event happens (paths not covered elsewhere)", async () => {
    const auth = createAuth();
    const UA = "00000000-0000-0000-0000-00000000000a";
    const pw = { ua: "centre-pass-1234", ho: "ho-pass-12345678" };
    await asAdmin(async (db) => {
      await db.query("truncate app.auth_throttle, app.auth_ip_attempt, app.auth_challenge, app.auth_recovery_code, app.auth_reset");
      await db.query("update app.app_user set password_hash = $2, requires_totp = false where id = $1", [UA, await hashPassword(pw.ua)]);
      await db.query("update app.app_user set password_hash = $2, requires_totp = true, totp_secret_enc = null where id = $1", [HO, await hashPassword(pw.ho)]);
    });
    const has = async (action: string) => (await rows(action)).length > 0;
    try {
      // lockout refusal
      for (let i = 0; i < 5; i++) await auth.signIn("ua", "wrong", `10.40.0.${i}`);
      expect((await auth.signIn("ua", pw.ua, "10.40.1.1")).kind).toBe("locked");
      expect(await has("auth.login.locked")).toBe(true);
      await asAdmin((db) => db.query("truncate app.auth_throttle"));
      // legacy rehash, step-up, step-up failure, reset completion, session revocation
      await asAdmin((db) => db.query("update app.app_user set password_hash = $2 where id = $1", [UA, `legacy-md5:${createHash("md5").update(pw.ua).digest("hex")}`]));
      const s = await auth.signIn("ua", pw.ua, "10.40.2.1");
      expect(await has("auth.password.rehash")).toBe(true);
      const token = (s as { token: string }).token;
      await expect(auth.stepUp(token, "wrong")).rejects.toThrow();
      expect(await has("auth.stepup.failure")).toBe(true);
      await auth.stepUp(token, pw.ua);
      expect(await has("auth.stepup")).toBe(true);
      await auth.requestReset("ua");
      expect(await auth.confirmReset(auth.outbox.at(-1)!.resetToken, "a-fresh-password-1")).toBe(true);
      expect(await has("auth.reset.complete")).toBe(true);
      await auth.revokeUserSessions(UA);
      expect(await has("auth.sessions.revoked")).toBe(true);
      // second factor: wrong TOTP, wrong recovery code, regeneration
      const enrol = await auth.signIn("hoall", pw.ho, "10.40.3.1");
      const ch = (enrol as { challenge: string }).challenge;
      const { secret } = await auth.startTotpEnrolment(ch, pw.ho);
      const { result } = await auth.confirmTotpEnrolment(ch, totp(secret));
      await auth.regenerateRecoveryCodes((result as { token: string }).token, pw.ho);
      expect(await has("auth.recovery.regenerate")).toBe(true);
      const ch2 = ((await auth.signIn("hoall", pw.ho, "10.40.3.2")) as { challenge: string }).challenge;
      await auth.verifyTotp(ch2, "000000");
      expect(await has("auth.totp.failure")).toBe(true);
      await auth.useRecoveryCode(ch2, "not-a-code");
      expect(await has("auth.recovery.failure")).toBe(true);
    } finally { await auth.close(); }

    // administration: role creation, assignment removal, user re-enable
    await asAdmin((db) => db.query(`insert into app.app_session (token_hash, user_id, expires_at, step_up_at) values (sha256(convert_to('tok-aud', 'UTF8')), $1, now() + interval '1 hour', now())`, [HO]));
    const role = await createRole("tok-aud", { key: "aud_role", name: "Audit role" });
    expect(await has("rbac.role.create")).toBe(true);
    const assignment = await assignRole("tok-aud", { userId: UA, roleId: 2, scope: { kind: "CENTRE", centreId: C.A } });
    await removeAssignment("tok-aud", assignment);
    expect(await has("rbac.assignment.delete")).toBe(true);
    await setUserStatus("tok-aud", UA, "DISABLED", "test");
    await setUserStatus("tok-aud", UA, "ACTIVE", "back");
    expect(await has("rbac.user.enable")).toBe(true);
    expect(role).toBeTypeOf("number");
  });

  test("T-AUD-009 coverage gate: every audited action is catalogued and asserted by a test", () => {
    const src = (f: string) => fs.readFileSync(f, "utf8");
    const found = new Set<string>();
    for (const m of src("src/server/auth/index.ts").matchAll(/"(auth\.[a-z0-9_.]+)"/g)) found.add(m[1]!);
    for (const m of src("etl/run.ts").matchAll(/"(migration\.run\.[a-z]+)"/g)) found.add(m[1]!);
    const scans = [["src/server/rbac.ts", /"(rbac\.[a-z0-9_.]+)"/g], ["src/server/tickets/engine.ts", /"(ticket\.[a-z0-9_.]+)"/g],
      ["src/server/tickets/setup.ts", /"(ticket\.[a-z0-9_.]+)"/g],
      ["src/server/people.ts", /"(person\.[a-z0-9_.]+)"/g], ["src/server/catalogue.ts", /"(catalogue\.[a-z0-9_.]+)"/g]] as const;
    for (const [file, pattern] of scans) {
      for (const line of src(file).split("\n").filter((l) => l.includes("action:"))) {
        // only the action itself, not the permission key that shares the line (action: comes first)
        const actionPart = line.slice(line.indexOf("action:"), line.includes("permission:") ? line.indexOf("permission:") : undefined);
        for (const m of actionPart.matchAll(pattern)) found.add(m[1]!);
      }
    }
    for (const m of src("scripts/bootstrap-admin.mjs").matchAll(/'(rbac\.[a-z0-9_.]+)', 'OK'/g)) found.add(m[1]!); // the audit insert only
    for (const key of Object.keys(DATASETS)) found.add(`export.${key}`);
    expect([...found].sort()).toEqual([...AUDIT_CATALOGUE].sort()); // code and catalogue agree

    const testText = files("tests", /\.ts$/).filter((f) => !f.endsWith("audit-catalogue.ts")).map(src).join("\n");
    const untested = AUDIT_CATALOGUE.filter((a) => !testText.includes(`"${a}"`) && !testText.includes(`'${a}'`));
    expect(untested, "catalogued actions that no test asserts").toEqual([]);
  });
});
