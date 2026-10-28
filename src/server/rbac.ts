// User and role administration (WF-X13). Every write goes through scopedAction (authorize + audit, one transaction)
// AND a SECURITY DEFINER function that re-checks permission and the no-over-grant rule in the database (0005_rbac).
import { createHash, randomBytes } from "node:crypto";
import { authorize, Forbidden, scopedAction, type AuditExtra } from "./action";
import { withScope, type Tx } from "./db";
import { Prisma } from "../../generated/prisma/client";
import { POLICY } from "./auth/policy";

export class StepUpRequired extends Error {
  override name = "StepUpRequired";
}
export class RbacError extends Error {
  override name = "RbacError";
  /** key: a more specific message key for the page (e.g. ticket.setup.levels); defaults to the reason */
  constructor(readonly reason: "duplicate" | "notfound" | "invalid", message: string, readonly key?: string) { super(message); }
}

export type ScopeInput = { kind: "ALL" | "REGION" | "AREA" | "CENTRE"; regionId?: number; areaId?: number; centreId?: number };

const SETUP_LINK_HOURS = 72; // ponytail: PMC with D-SEC-3; move into POLICY once signed

// Map errors raised by the database functions onto domain errors (shape probed for Prisma 7 + adapter-pg).
async function db<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const cause = (e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } }).meta?.driverAdapterError?.cause;
    const code = cause?.originalCode; // Postgres SQLSTATE
    if (code === "42501") throw new Forbidden(cause?.originalMessage ?? "forbidden"); // audited as DENIED by scopedAction
    if (code === "23505") throw new RbacError("duplicate", "that login or key already exists");
    if (code === "P0002") throw new RbacError("notfound", cause?.originalMessage ?? "not found");
    if (code === "23514" || code === "22P02" || code === "23503" || code === "23502") throw new RbacError("invalid", "invalid value");
    throw e;
  }
}

async function requireFreshStepUp(tx: Tx) {
  const [r] = await tx.$queryRaw<{ ok: boolean }[]>`select app.session_step_up_fresh(${POLICY.stepUpMaxAgeSeconds}) as ok`;
  if (!r?.ok) throw new StepUpRequired("re-enter your password to continue");
}

// Admin write = permission check + fresh step-up + the DB function, audited in the same transaction.
export function adminWrite<T>(session: string | undefined, meta: { action: string; permission: string; targetType: string; targetId?: string; reason?: string },
  fn: (tx: Tx) => Promise<T>, detail: (r: T) => AuditExtra = () => ({})) {
  return scopedAction(session, meta, async (tx) => {
    await requireFreshStepUp(tx);
    return db(() => fn(tx));
  }, detail);
}

export const createUser = (session: string | undefined, u: { login: string; displayName: string }) =>
  adminWrite(session, { action: "rbac.user.create", permission: "rbac.user.manage", targetType: "app_user" },
    async (tx) => (await tx.$queryRaw<{ id: string }[]>`select app.rbac_create_user(${u.login}, ${u.displayName})::text as id`)[0]!.id,
    (id) => ({ userId: id, login: u.login.trim().toLowerCase() }));

export const setUserStatus = (session: string | undefined, userId: string, status: "ACTIVE" | "DISABLED", reason?: string) =>
  adminWrite(session, { action: status === "ACTIVE" ? "rbac.user.enable" : "rbac.user.disable", permission: "rbac.user.manage", targetType: "app_user", targetId: userId, reason },
    async (tx) => {
      const [prev] = await tx.$queryRaw<{ status: string }[]>`select status::text from app.app_user where id = ${userId}::uuid`;
      await tx.$executeRaw`select app.rbac_set_user_status(${userId}::uuid, ${status}::app."UserStatus")`;
      return prev?.status ?? null;
    },
    (before) => ({ before: { status: before }, after: { status } }));

export const assignRole = (session: string | undefined, a: { userId: string; roleId: number; scope: ScopeInput }) =>
  adminWrite(session, { action: "rbac.assignment.create", permission: "rbac.user.manage", targetType: "app_user", targetId: a.userId },
    async (tx) => (await tx.$queryRaw<{ id: number }[]>`select app.rbac_assign(${a.userId}::uuid, ${a.roleId}::int, ${a.scope.kind}::app."ScopeKind",
      ${a.scope.regionId ?? null}::int, ${a.scope.areaId ?? null}::int, ${a.scope.centreId ?? null}::int) as id`)[0]!.id,
    (id) => ({ assignmentId: id, roleId: a.roleId, scope: a.scope }));

export const removeAssignment = (session: string | undefined, assignmentId: number) =>
  adminWrite(session, { action: "rbac.assignment.delete", permission: "rbac.user.manage", targetType: "role_assignment", targetId: String(assignmentId) },
    async (tx) => (await tx.$queryRaw<{ user_id: string }[]>`select app.rbac_unassign(${assignmentId}::int)::text as user_id`)[0]!.user_id);

export const createRole = (session: string | undefined, r: { key: string; name: string }) =>
  adminWrite(session, { action: "rbac.role.create", permission: "rbac.role.manage", targetType: "role" },
    async (tx) => (await tx.$queryRaw<{ id: number }[]>`select app.rbac_create_role(${r.key}, ${r.name}) as id`)[0]!.id,
    (id) => ({ roleId: id, key: r.key }));

export const setRolePermissions = (session: string | undefined, roleId: number, permissions: string[]) =>
  adminWrite(session, { action: "rbac.role.permissions", permission: "rbac.role.manage", targetType: "role", targetId: String(roleId) },
    async (tx) => {
      const before = (await tx.$queryRaw<{ k: string }[]>`select permission_key as k from app.role_permission where role_id = ${roleId}::int order by 1`).map((r) => r.k);
      await tx.$executeRaw`select app.rbac_set_role_permissions(${roleId}::int, ${permissions}::text[])`;
      return before;
    },
    (before) => ({ before: { permissions: before }, after: { permissions: [...new Set(permissions)].sort() } }));

/** One-time set-up link token (PR-12). Only its hash is stored; the caller shows the link once. */
export async function issueSetupToken(session: string | undefined, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token, "utf8").digest();
  await adminWrite(session, { action: "rbac.user.setup_link", permission: "rbac.user.manage", targetType: "app_user", targetId: userId },
    (tx) => tx.$executeRaw`select app.rbac_issue_setup_token(${userId}::uuid, ${hash}, ${SETUP_LINK_HOURS}::int)`);
  return token;
}

// ---------- reads (rbac.view; also filtered by RLS) ----------

export type UserRow = { id: string; login: string; displayName: string; status: string; requiresTotp: boolean; roles: string[] };
export type AssignmentRow = { id: number; roleId: number; roleName: string; scope: string };

const scopeLabel = Prisma.raw(`case ra.scope_kind
  when 'ALL' then 'All centres'
  when 'REGION' then 'Region ' || (select code from app.region where id = ra.region_id)
  when 'AREA' then 'Area ' || (select name from app.area where id = ra.area_id)
  else 'Centre ' || coalesce((select code from app.centre where id = ra.scope_centre_id), '#' || ra.scope_centre_id) end`); // constant SQL, no input

function readAs<T>(session: string | undefined, fn: (tx: Tx) => Promise<T>) {
  return withScope(session, async (tx) => {
    await authorize(tx, "rbac.view");
    return fn(tx);
  });
}

export const listUsers = (session: string | undefined) => readAs(session, (tx) => tx.$queryRaw<UserRow[]>`
  select u.id::text, u.login, u.display_name as "displayName", u.status::text, u.requires_totp as "requiresTotp",
         coalesce(array_agg(r.name || ' · ' || ${scopeLabel} order by r.name) filter (where r.id is not null), '{}') as roles
  from app.app_user u
  left join app.role_assignment ra on ra.user_id = u.id
  left join app.role r on r.id = ra.role_id
  group by u.id order by u.login`);

export const getUser = (session: string | undefined, userId: string) => readAs(session, async (tx) => {
  const [user] = await tx.$queryRaw<Omit<UserRow, "roles">[]>`select id::text, login, display_name as "displayName", status::text,
    requires_totp as "requiresTotp" from app.app_user where id = ${userId}::uuid`;
  if (!user) return null;
  const assignments = await tx.$queryRaw<AssignmentRow[]>`select ra.id, ra.role_id as "roleId", r.name as "roleName", ${scopeLabel} as scope
    from app.role_assignment ra join app.role r on r.id = ra.role_id where ra.user_id = ${userId}::uuid order by r.name`;
  return { ...user, assignments };
});

export type RoleRow = { id: number; key: string; name: string; permissions: string[]; holders: number };
export const listRoles = (session: string | undefined) => readAs(session, (tx) => tx.$queryRaw<RoleRow[]>`
  select r.id, r.key, r.name,
         coalesce((select array_agg(permission_key order by permission_key) from app.role_permission where role_id = r.id), '{}') as permissions,
         (select count(distinct user_id)::int from app.role_assignment where role_id = r.id) as holders
  from app.role r order by r.name`);

export const listPermissions = (session: string | undefined) => readAs(session, (tx) =>
  tx.$queryRaw<{ key: string; description: string; sensitive: boolean }[]>`select key, description, sensitive from app.permission order by key`);

export const scopeOptions = (session: string | undefined) => readAs(session, async (tx) => ({
  regions: await tx.$queryRaw<{ id: number; label: string }[]>`select id, code || ' ' || name as label from app.region order by code`,
  areas: await tx.$queryRaw<{ id: number; label: string }[]>`select a.id, r.code || ' / ' || a.name as label from app.area a join app.region r on r.id = a.region_id order by 2`,
  centres: await tx.$queryRaw<{ id: number; label: string }[]>`select id, code || ' ' || name as label from app.centre order by code`,
}));

/** For showing admin links: does this session hold rbac.view? */
export const canAdminister = (session: string | undefined) => withScope(session, async (tx) =>
  (await tx.$queryRaw<{ ok: boolean }[]>`select app.has_permission('rbac.view', null) as ok`)[0]!.ok);
