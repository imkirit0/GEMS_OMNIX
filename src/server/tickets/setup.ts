// Ticket type setup (design item 8; G8, DD-11). Every write goes through adminWrite: ticket.type.manage at ALL
// scope, fresh step-up, database errors mapped by db(), before/after audited. The setup tables' RLS write policy
// re-checks ticket.type.manage in the database (0009).
import { authorize } from "../action";
import { withScope, type Tx } from "../db";
import { adminWrite, RbacError } from "../rbac";
import { HANDLERS } from "./handlers";
import { gateRefusal, TICKET_GATES, TICKET_POLICY } from "./policy";

type Level = { level: number; userId?: string; roleId?: number };
type Viewer = { userId?: string; roleId?: number };
export type TypeInput = { code: string; name: string; categoryId: number; priority: string; documentRequired: boolean; handlerKey: string };

const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const refuse = (key: string, message: string) => new RbacError("invalid", message, key);

// The page shows "A ticket type with that code already exists", not db()'s login-or-key text.
async function typeCode<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) {
    if (e instanceof RbacError && e.reason === "duplicate") throw new RbacError("duplicate", e.message, "ticket.setup.duplicate");
    throw e;
  }
}

function checkDetails(t: Omit<TypeInput, "code">) {
  if (!t.name.trim() || !Number.isSafeInteger(t.categoryId) || !PRIORITIES.includes(t.priority) || !t.handlerKey.trim()) {
    throw new RbacError("invalid", "name, category, priority and handler are required");
  }
}

// A 10-digit sequence must still fit (DD-10), so the type can never produce an over-length number.
function checkPrefix(prefix: string, code: string) {
  if (!/^[A-Z0-9-]{1,12}$/.test(prefix) || !/^[A-Z0-9]{1,10}$/.test(code)
    || `${prefix}/${code}/${"9".repeat(10)}`.length > TICKET_POLICY.numberMaxLength) {
    throw refuse("ticket.setup.prefix", "prefix and code would make ticket numbers too long, or contain other characters");
  }
}

function checkLevels(levels: Level[]) {
  if (levels.length < 1 || levels.length > 4 || levels.some((l, i) => l.level !== i + 1 || (l.userId == null) === (l.roleId == null))) {
    throw refuse("ticket.setup.levels", "levels must run 1, 2, 3 with no gaps, at most 4, each a user or a role");
  }
}

const typeRow = (tx: Tx, typeId: number) => tx.$queryRaw<{ id: number; code: string; name: string; category_id: number; priority: string;
  document_required: boolean; handler_key: string; number_prefix: string; active: boolean }[]>`
  select id, code, name, category_id, priority::text, document_required, handler_key, number_prefix, active
  from app.ticket_type where id = ${typeId} for update`.then((r) => {
  if (!r[0]) throw new RbacError("notfound", "no such ticket type");
  return r[0];
});
const levelsOf = (tx: Tx, typeId: number) => tx.$queryRaw<{ level: number; user_id: string | null; role_id: number | null }[]>`
  select level, approver_user_id::text as user_id, approver_role_id as role_id from app.ticket_type_level where type_id = ${typeId} order by level`;
const viewersOf = (tx: Tx, typeId: number) => tx.$queryRaw<{ user_id: string | null; role_id: number | null }[]>`
  select user_id::text, role_id from app.ticket_type_viewer where type_id = ${typeId} order by id`;

export const createCategory = async (session: string | undefined, c: { name: string; parentId?: number }) => {
  if (!c.name.trim() || (c.parentId !== undefined && !Number.isSafeInteger(c.parentId))) throw new RbacError("invalid", "category name is required");
  return adminWrite(session, { action: "ticket.category.create", permission: "ticket.type.manage", targetType: "ticket_category" },
    async (tx) => (await tx.$queryRaw<{ id: number }[]>`
      insert into app.ticket_category (parent_id, name) values (${c.parentId ?? null}, ${c.name.trim()}) returning id`)[0]!.id,
    (id) => ({ after: { id, name: c.name.trim(), parentId: c.parentId ?? null } }));
};

export const createType = async (session: string | undefined, t: TypeInput & { numberPrefix: string }) => {
  checkDetails(t);
  checkPrefix(t.numberPrefix, t.code);
  return typeCode(() => adminWrite(session, { action: "ticket.type.create", permission: "ticket.type.manage", targetType: "ticket_type" },
    async (tx) => (await tx.$queryRaw<{ id: number }[]>`
      insert into app.ticket_type (code, name, category_id, priority, document_required, handler_key, number_prefix)
      values (${t.code}, ${t.name.trim()}, ${t.categoryId}, ${t.priority}::app."TicketPriority", ${t.documentRequired},
              ${t.handlerKey.trim()}, ${t.numberPrefix}) returning id`)[0]!.id, // created inactive
    (id) => ({ after: { id, ...t } })));
};

export const updateType = async (session: string | undefined, typeId: number, u: Omit<TypeInput, "code">) => {
  checkDetails(u);
  return adminWrite(session, { action: "ticket.type.update", permission: "ticket.type.manage", targetType: "ticket_type", targetId: String(typeId) },
    async (tx) => {
      const before = await typeRow(tx, typeId);
      if (u.handlerKey.trim() !== before.handler_key) {
        // the handler decides what apply does with payloads written for the old one (DD-11)
        const [open] = await tx.$queryRaw<{ n: number }[]>`select count(*)::int as n from app.ticket where type_id = ${typeId} and status = 'OPEN'`;
        if (before.active || open!.n > 0) throw refuse("ticket.setup.handler", "the handler can change only while the type is off and has no open tickets");
      }
      // DD-14: documents cannot become required on a live type while document storage is not live
      if (before.active && u.documentRequired && !before.document_required && !TICKET_GATES.documentsLive) {
        throw refuse("ticket.setup.storage", "documents cannot be required on an active type yet");
      }
      await tx.$executeRaw`update app.ticket_type set name = ${u.name.trim()}, category_id = ${u.categoryId},
        priority = ${u.priority}::app."TicketPriority", document_required = ${u.documentRequired}, handler_key = ${u.handlerKey.trim()}
        where id = ${typeId}`;
      return { before, after: { ...before, name: u.name.trim(), category_id: u.categoryId, priority: u.priority,
        document_required: u.documentRequired, handler_key: u.handlerKey.trim() } };
    }, (r) => r);
};

// Levels are copied onto each ticket at raise, so they may change on an active type (DD-11).
export const setTypeLevels = async (session: string | undefined, typeId: number, levels: Level[]) => {
  checkLevels(levels);
  return adminWrite(session, { action: "ticket.type.levels", permission: "ticket.type.manage", targetType: "ticket_type", targetId: String(typeId) },
    async (tx) => {
      await typeRow(tx, typeId);
      const before = await levelsOf(tx, typeId);
      await tx.$executeRaw`delete from app.ticket_type_level where type_id = ${typeId}`;
      for (const l of levels) await tx.$executeRaw`insert into app.ticket_type_level (type_id, level, approver_user_id, approver_role_id)
        values (${typeId}, ${l.level}, ${l.userId ?? null}::uuid, ${l.roleId ?? null})`;
      return { before, after: levels };
    }, (r) => r);
};

export const setTypeViewers = async (session: string | undefined, typeId: number, viewers: Viewer[]) => {
  if (viewers.some((v) => (v.userId == null) === (v.roleId == null))) throw new RbacError("invalid", "each viewer is a user or a role");
  return adminWrite(session, { action: "ticket.type.viewers", permission: "ticket.type.manage", targetType: "ticket_type", targetId: String(typeId) },
    async (tx) => {
      await typeRow(tx, typeId);
      const before = await viewersOf(tx, typeId);
      await tx.$executeRaw`delete from app.ticket_type_viewer where type_id = ${typeId}`;
      for (const v of viewers) await tx.$executeRaw`insert into app.ticket_type_viewer (type_id, user_id, role_id)
        values (${typeId}, ${v.userId ?? null}::uuid, ${v.roleId ?? null})`;
      return { before, after: viewers };
    }, (r) => r);
};

// Two calls, not one with a computed action name, so the audit catalogue gate can read both names.
export const setTypeActive = (session: string | undefined, typeId: number, active: boolean) => active
  ? adminWrite(session, { action: "ticket.type.activate", permission: "ticket.type.manage", targetType: "ticket_type", targetId: String(typeId) },
    async (tx) => {
      const t = await typeRow(tx, typeId);
      const levels = await levelsOf(tx, typeId);
      if (!HANDLERS[t.handler_key] || levels.length === 0 || levels.some((l, i) => l.level !== i + 1)) {
        throw refuse("ticket.setup.activate", "the type needs a registered handler and valid levels before it can be switched on");
      }
      const gate = gateRefusal({ documentRequired: t.document_required }); // DD-14, DD-18
      if (gate) throw refuse(gate, "go-live gate closed");
      await tx.$executeRaw`update app.ticket_type set active = true where id = ${typeId}`;
      return { before: { active: t.active }, after: { active: true } };
    }, (r) => r)
  : adminWrite(session, { action: "ticket.type.deactivate", permission: "ticket.type.manage", targetType: "ticket_type", targetId: String(typeId) },
    async (tx) => {
      const t = await typeRow(tx, typeId);
      await tx.$executeRaw`update app.ticket_type set active = false where id = ${typeId}`;
      return { before: { active: t.active }, after: { active: false } };
    }, (r) => r);

// ---------- Reads ----------
const manageRead = <T>(session: string | undefined, fn: (tx: Tx) => Promise<T>) =>
  withScope(session, async (tx) => { await authorize(tx, "ticket.type.manage"); return fn(tx); });

export const listTypes = (session: string | undefined) => manageRead(session, async (tx) => ({
  types: await tx.$queryRaw<{ id: number; code: string; name: string; category: string; active: boolean; handlerKey: string }[]>`
    select t.id, t.code, t.name, c.name as category, t.active, t.handler_key as "handlerKey"
    from app.ticket_type t join app.ticket_category c on c.id = t.category_id order by t.name, t.id`,
  categories: await tx.$queryRaw<{ id: number; name: string; parentId: number | null }[]>`
    select id, name, parent_id as "parentId" from app.ticket_category order by name, id`,
  handlers: Object.keys(HANDLERS).sort(),
}));

export const getType = (session: string | undefined, typeId: number) => manageRead(session, async (tx) => {
  const [type] = await tx.$queryRaw<{ id: number; code: string; name: string; categoryId: number; priority: string; documentRequired: boolean;
    handlerKey: string; numberPrefix: string; active: boolean }[]>`
    select id, code, name, category_id as "categoryId", priority::text, document_required as "documentRequired",
           handler_key as "handlerKey", number_prefix as "numberPrefix", active from app.ticket_type where id = ${typeId}`;
  if (!type) throw new RbacError("notfound", "no such ticket type");
  return { ...type, levels: await levelsOf(tx, typeId), viewers: await viewersOf(tx, typeId) };
});
