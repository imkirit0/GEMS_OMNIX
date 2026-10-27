// User and role administration (WF-X13): T-E2E-X13, T-AUTH-010, no over-grant, step-up, audit, both gates.
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { Forbidden } from "../src/server/action";
import { withScope } from "../src/server/db";
import { auth } from "../src/server/auth/http";
import {
  assignRole, createRole, createUser, getUser, issueSetupToken, listUsers, RbacError, removeAssignment,
  setRolePermissions, setUserStatus, StepUpRequired,
} from "../src/server/rbac";
import { asAdmin, audits, C, reset, T } from "./fixtures";

const ROLE = { centreAdmin: 1, hoViewer: 2, rbacAdmin: 3 } as const;
const REGADMIN = "tok-regadmin"; // RBAC rights network-wide, but centre_admin rights only in region R1

const setStepUp = (token: string, ageSeconds: number) => asAdmin((db) => db.query(
  `update app.app_session set step_up_at = now() - make_interval(secs => $2) where token_hash = sha256(convert_to($1, 'UTF8'))`, [token, ageSeconds]));
const centresOf = (token: string) => withScope(token, async (tx) => (await tx.$queryRaw<{ id: number }[]>`select id from app.centre order by id`).map((r) => r.id));
const newSession = (userId: string, token: string) => asAdmin((db) => db.query(
  `insert into app.app_session (token_hash, user_id, expires_at, step_up_at) values (sha256(convert_to($1, 'UTF8')), $2, now() + interval '1 hour', now())`, [token, userId]));
const outcomes = async (action: string) => (await audits(action)).map((a) => a.outcome);

beforeEach(async () => {
  await reset();
  await asAdmin(async (db) => {
    await db.query(`insert into app.app_user (id, login, display_name) values ('00000000-0000-0000-0000-0000000000ad', 'regadmin', 'Regional admin')`);
    await db.query(`insert into app.role_assignment (user_id, role_id, scope_kind, region_id) values
      ('00000000-0000-0000-0000-0000000000ad', 3, 'ALL', null), ('00000000-0000-0000-0000-0000000000ad', 1, 'REGION', 1)`);
    await db.query("update app.role_assignment set region_id = null where scope_kind = 'ALL'");
  });
  await newSession("00000000-0000-0000-0000-0000000000ad", REGADMIN);
  await setStepUp(T.hoAll, 0);
});
afterAll(() => auth().close());

describe("user and role administration", () => {
  test("T-E2E-X13: create user, assign, set-up link, sign in; scope change revokes sessions and requires TOTP (T-AUTH-010)", async () => {
    const id = await createUser(T.hoAll, { login: "  NewBie ", displayName: "New User" });
    await assignRole(T.hoAll, { userId: id, roleId: ROLE.hoViewer, scope: { kind: "CENTRE", centreId: C.A } });
    const setup = await issueSetupToken(T.hoAll, id);
    expect(await auth().confirmReset(setup, "first-password-123")).toBe(true);
    expect(await auth().confirmReset(setup, "second-password-12")).toBe(false); // single use

    const first = await auth().signIn("newbie", "first-password-123", "10.7.0.1");
    expect(first.kind).toBe("session");
    const token = (first as { token: string }).token;
    expect(await centresOf(token)).toEqual([C.A]);
    expect((await getUser(T.hoAll, id))).toMatchObject({ login: "newbie", requiresTotp: false });

    await assignRole(T.hoAll, { userId: id, roleId: ROLE.hoViewer, scope: { kind: "REGION", regionId: 1 } });
    expect(await auth().resolve(token)).toBeNull(); // revoked on scope change
    expect((await getUser(T.hoAll, id))).toMatchObject({ requiresTotp: true }); // wider than a centre => TOTP
    expect((await auth().signIn("newbie", "first-password-123", "10.7.0.2")).kind).toBe("enrol");

    for (const a of ["rbac.user.create", "rbac.assignment.create", "rbac.user.setup_link"]) expect(await outcomes(a)).toContain("OK");
  });

  test("no over-grant: a role is granted only where the actor holds every one of its permissions", async () => {
    const target = await createUser(T.hoAll, { login: "target", displayName: "Target" });
    // hoAll lacks numbering.series.allocate, so cannot grant centre_admin anywhere
    await expect(assignRole(T.hoAll, { userId: target, roleId: ROLE.centreAdmin, scope: { kind: "CENTRE", centreId: C.A } })).rejects.toBeInstanceOf(Forbidden);
    expect(await outcomes("rbac.assignment.create")).toEqual(["DENIED"]);

    await setStepUp(REGADMIN, 0);
    const grant = (scope: Parameters<typeof assignRole>[1]["scope"]) => assignRole(REGADMIN, { userId: target, roleId: ROLE.centreAdmin, scope });
    await expect(grant({ kind: "CENTRE", centreId: C.A })).resolves.toBeTypeOf("number"); // in R1
    await expect(grant({ kind: "AREA", areaId: 1 })).resolves.toBeTypeOf("number"); // area A1 is in R1
    await expect(grant({ kind: "REGION", regionId: 1 })).resolves.toBeTypeOf("number");
    await expect(grant({ kind: "CENTRE", centreId: C.B })).rejects.toBeInstanceOf(Forbidden); // R2
    await expect(grant({ kind: "REGION", regionId: 2 })).rejects.toBeInstanceOf(Forbidden);
    await expect(grant({ kind: "ALL" })).rejects.toBeInstanceOf(Forbidden);

    // symmetric: cannot remove what you could not grant (hoAll's ALL-scope ho_viewer)
    const hoAllViewer = await asAdmin((db) => db.query(`select id from app.role_assignment where user_id = '00000000-0000-0000-0000-0000000000ff' and role_id = 2`).then((r) => r.rows[0].id));
    await expect(removeAssignment(REGADMIN, hoAllViewer)).rejects.toBeInstanceOf(Forbidden);
  });

  test("role editing: only permissions held network-wide; holders are signed out", async () => {
    const role = await createRole(T.hoAll, { key: "Auditor", name: "Auditor" });
    await setRolePermissions(T.hoAll, role, ["org.centre.view"]);
    await expect(setRolePermissions(T.hoAll, role, ["org.centre.view", "numbering.series.allocate"])).rejects.toBeInstanceOf(Forbidden);

    const holder = await createUser(T.hoAll, { login: "holder", displayName: "Holder" });
    await assignRole(T.hoAll, { userId: holder, roleId: role, scope: { kind: "CENTRE", centreId: C.B } });
    await newSession(holder, "tok-holder");
    expect(await centresOf("tok-holder")).toEqual([C.B]);
    await setRolePermissions(T.hoAll, role, []);
    await expect(centresOf("tok-holder")).rejects.toThrow(); // revoked
    const roleKey = await asAdmin((db) => db.query(`select key from app.role where id = $1`, [role]).then((r) => r.rows[0].key));
    expect(roleKey).toBe("auditor");
  });

  test("step-up older than 5 minutes blocks every admin write, with no side effects", async () => {
    await setStepUp(T.hoAll, 301);
    await expect(createUser(T.hoAll, { login: "late", displayName: "Late" })).rejects.toBeInstanceOf(StepUpRequired);
    expect(await asAdmin((db) => db.query(`select count(*)::int n from app.app_user where login = 'late'`).then((r) => r.rows[0].n))).toBe(0);
    await setStepUp(T.hoAll, 0);
    await expect(createUser(T.hoAll, { login: "late", displayName: "Late" })).resolves.toBeTypeOf("string");
  });

  test("users without RBAC rights are denied every action and read; denials audited", async () => {
    for (const tok of [T.uA, T.hoR1]) {
      await setStepUp(tok, 0);
      await expect(createUser(tok, { login: "x", displayName: "x" })).rejects.toBeInstanceOf(Forbidden);
      await expect(assignRole(tok, { userId: "00000000-0000-0000-0000-00000000000a", roleId: 2, scope: { kind: "ALL" } })).rejects.toBeInstanceOf(Forbidden);
      await expect(createRole(tok, { key: "x", name: "x" })).rejects.toBeInstanceOf(Forbidden);
      await expect(listUsers(tok)).rejects.toBeInstanceOf(Forbidden);
    }
    expect(await outcomes("rbac.user.create")).toEqual(["DENIED", "DENIED"]);
  });

  test("database gate alone: functions and row visibility enforce RBAC without the app layer", async () => {
    const app = new pg.Client({ connectionString: process.env["APP_DATABASE_URL"] });
    await app.connect();
    try {
      const as = async (tok: string, sql: string) => {
        await app.query("begin");
        await app.query("select set_config('app.session_id', $1, true)", [tok]);
        try { return await app.query(sql); } finally { await app.query("rollback"); }
      };
      await expect(as(T.uA, "select app.rbac_create_user('sneaky', 'Sneaky')")).rejects.toMatchObject({ code: "42501" });
      await expect(as(T.uA, "select app.rbac_assign('00000000-0000-0000-0000-00000000000a', 3, 'ALL', null, null, null)")).rejects.toMatchObject({ code: "42501" });
      expect((await as(T.uA, "select login from app.app_user")).rows).toEqual([{ login: "ua" }]); // own row only
      expect((await as(T.hoAll, "select count(*)::int n from app.app_user")).rows[0].n).toBeGreaterThan(5);
    } finally { await app.end(); }
  });

  test("guards: no self-disable, unique lowercase logins, disabling signs the user out", async () => {
    await expect(setUserStatus(T.hoAll, "00000000-0000-0000-0000-0000000000ff", "DISABLED")).rejects.toBeInstanceOf(Forbidden);
    await createUser(T.hoAll, { login: "Dup", displayName: "Dup" });
    await expect(createUser(T.hoAll, { login: "dup", displayName: "Dup 2" })).rejects.toMatchObject({ reason: "duplicate" });
    await expect(createUser(T.hoAll, { login: "dup", displayName: "Dup 2" })).rejects.toBeInstanceOf(RbacError);
    expect(await centresOf(T.uA)).toEqual([C.A]);
    await setUserStatus(T.hoAll, "00000000-0000-0000-0000-00000000000a", "DISABLED");
    await expect(centresOf(T.uA)).rejects.toThrow();
  });
});
