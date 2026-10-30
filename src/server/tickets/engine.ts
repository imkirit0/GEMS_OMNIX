// Ticket and approval engine, Stage 2 core (docs/designs/ticket-engine/ticket-engine.md, Approved 2026-10-28).
// Every write is scopedAction(): authorise, change and audit in one transaction. The database adds RLS, the guard
// triggers and append-only history (0009); who may act is decided by app.ticket_may_act, refused here (DD-1).
import { randomUUID } from "node:crypto";
import { Forbidden, scopedAction } from "../action";
import { isConnectionLost, ScopeError, withScope, type Tx } from "../db";
import { adminWrite } from "../rbac";
import { allocateGlobal, formatTicketNumber } from "../numbering";
import { storage } from "../storage";
import { Prisma } from "../../../generated/prisma/client";
import { ApplyFailed, TicketDuplicate, TicketError, TicketNotFound } from "./errors";
import { HANDLERS, type TicketField, type TicketRow } from "./handlers";
import { TICKET_GATES, TICKET_POLICY } from "./policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);
const PAGE = 50;

// ---------- Database errors (design §Database errors) ----------
// Not rbac.ts db(): that one turns every unique violation into "login or key already exists".
type PgCause = { originalCode?: string; originalMessage?: string };
async function ticketDb<T>(ticketId: string | undefined, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const cause = (e as { meta?: { driverAdapterError?: { cause?: PgCause } } }).meta?.driverAdapterError?.cause;
    const code = cause?.originalCode;
    const constraint = /constraint "([^"]+)"/.exec(cause?.originalMessage ?? "")?.[1];
    if (code === "23505" && constraint === "ticket_pkey" && ticketId) throw new TicketDuplicate(ticketId);
    if (code === "23505" && constraint === "ticket_document_upload_id_key") throw new TicketError("document", "upload already attached");
    if (code === "23505" && constraint === "ticket_reraise_of_key") throw new TicketError("invalid", "already re-raised");
    if (code === "22P02") throw new TicketError("invalid", "malformed value");
    if (code === "42501") throw new Forbidden(cause?.originalMessage ?? "forbidden"); // audited as DENIED by scopedAction
    throw e; // includes guard-trigger refusals (P0001): an engine bug, shown as a generic error
  }
}

// Short read under RLS before scopedAction, which needs the centre. Hidden, missing or not viewable: 404.
async function locate(session: string | undefined, ticketId: string): Promise<{ centreId: number }> {
  if (!isUuid(ticketId)) throw new TicketNotFound();
  const [t] = await withScope(session, (tx) => tx.$queryRaw<{ centre_id: number; ok: boolean }[]>`
    select centre_id, app.ticket_may_view(id) as ok from app.ticket where id = ${ticketId}::uuid`);
  if (!t?.ok) throw new TicketNotFound();
  return { centreId: t.centre_id };
}

async function lockTicket(tx: Tx, id: string): Promise<TicketRow<unknown> | undefined> {
  const [t] = await tx.$queryRaw<TicketRow<unknown>[]>`
    select id::text, number, type_id as "typeId", centre_id as "centreId", raised_by::text as "raisedBy",
           status::text, current_level as "currentLevel", level_count as "levelCount",
           assigned_user_id::text as "assignedUserId", payload, reraise_of::text as "reraiseOf", version,
           created_at as "createdAt"
    from app.ticket where id = ${id}::uuid for update`;
  return t;
}

// The type row, locked for share through a definer function so a deactivation waits for us (design RA1).
async function lockHandler(tx: Tx, typeId: number) {
  const [t] = await tx.$queryRaw<{ active: boolean; handler_key: string }[]>`select * from app.ticket_type_lock(${typeId}::int)`;
  const handler = t?.active ? HANDLERS[t.handler_key] : undefined;
  if (!handler) throw new TicketError("inactive");
  return handler;
}

const event = (tx: Tx, t: { id: string; centreId: number }, action: string, level: number,
  x: { remarks?: string | null; toUserId?: string | null; detail?: object } = {}) => tx.$executeRaw`
  insert into app.ticket_event (ticket_id, centre_id, actor_id, action, level, remarks, to_user_id, detail)
  values (${t.id}::uuid, ${t.centreId}, app.session_user_id(), ${action}::app."TicketAction", ${level},
          ${x.remarks ?? null}, ${x.toUserId ?? null}::uuid, ${JSON.stringify(x.detail ?? {})}::jsonb)`;

// Every update adds 1 to version and is conditional on the version the actor saw (guard trigger checks the rest).
async function bump(tx: Tx, t: TicketRow<unknown>, set: Prisma.Sql) {
  const n = await tx.$executeRaw`update app.ticket set ${set}, version = version + 1 where id = ${t.id}::uuid and version = ${t.version}`;
  if (n !== 1) throw new TicketError("conflict");
}

const signatureOf = (bytes: Uint8Array) =>
  TICKET_POLICY.fileTypes.find((f) => f.signature.length <= bytes.length && f.signature.every((b, i) => bytes[i] === b));

// ---------- Uploads (DD-6, DD-16) ----------

export async function requestUpload(session: string | undefined,
  u: { typeId: number; centreId: number; fileName: string; size: number; contentType: string }): Promise<{ uploadId: string; url: string }> {
  if (!Number.isSafeInteger(u.typeId) || !Number.isSafeInteger(u.centreId)) throw new TicketError("invalid");
  const uploadId = randomUUID();
  const key = `uploads/${u.centreId}/${uploadId}`;
  await scopedAction(session, { action: "ticket.upload.request", permission: "ticket.raise", centreId: u.centreId,
    targetType: "ticket_upload", targetId: uploadId }, async (tx) => {
    // no upload unless a live type needs documents and document storage is live (correction-tickets DD-14)
    const [t] = await tx.$queryRaw<{ active: boolean; document_required: boolean; handler_key: string }[]>`
      select active, document_required, handler_key from app.ticket_type where id = ${u.typeId}`;
    if (!TICKET_GATES.documentsLive || !t?.active || !t.document_required || !HANDLERS[t.handler_key]) throw new TicketError("inactive");
    if (!Number.isSafeInteger(u.size) || u.size <= 0 || u.size > TICKET_POLICY.maxFileBytes) throw new TicketError("document", "file too large");
    if (!TICKET_POLICY.fileTypes.some((f) => f.mime === u.contentType)) throw new TicketError("document", "file type not allowed");
    const fileName = u.fileName.trim().slice(0, 200);
    if (!fileName) throw new TicketError("invalid", "file name missing");
    await tx.$executeRaw`insert into app.ticket_upload (id, centre_id, uploaded_by, storage_key, file_name, declared_size)
      values (${uploadId}::uuid, ${u.centreId}, app.session_user_id(), ${key}, ${fileName}, ${u.size})`;
  }, () => ({ after: { typeId: u.typeId, size: u.size, contentType: u.contentType } }));
  return { uploadId, url: await (await storage()).signedUploadUrl(key) };
}

type CheckedDocument = { uploadId: string; contentType: string; size: number };

// Outside the transaction: outside calls must not run inside it, because withScope may retry it (handler rule 1).
async function checkUploads(session: string | undefined, centreId: number, ids: string[]): Promise<CheckedDocument[]> {
  if (ids.length === 0) return [];
  if (ids.length > TICKET_POLICY.maxFilesPerTicket || new Set(ids).size !== ids.length) throw new TicketError("document", "too many files");
  const { rows, me } = await withScope(session, async (tx, ctx) => ({ me: ctx.userId, rows: await tx.$queryRaw<
    { id: string; centre_id: number; uploaded_by: string; storage_key: string; attached: boolean }[]>`
    select u.id::text, u.centre_id, u.uploaded_by::text, u.storage_key,
           exists (select 1 from app.ticket_document d where d.upload_id = u.id) as attached
    from app.ticket_upload u where u.id = any (${ids}::uuid[])` }));
  const store = await storage();
  const out: CheckedDocument[] = [];
  for (const id of ids) {
    const u = rows.find((r) => r.id === id);
    if (!u || u.centre_id !== centreId || u.uploaded_by !== me || u.attached) throw new TicketError("document", "upload not usable");
    const head = await store.head(u.storage_key, 16);
    if (!head || head.totalSize <= 0 || head.totalSize > TICKET_POLICY.maxFileBytes) throw new TicketError("document", "file missing or too large");
    const type = signatureOf(head.bytes);
    if (!type) throw new TicketError("document", "file type not allowed");
    out.push({ uploadId: id, contentType: type.mime, size: head.totalSize });
  }
  return out;
}

// ---------- Raise and re-raise ----------

export type RaiseInput = {
  ticketId: string; // generated when the form is rendered: a second submit finds it (idempotent raise)
  typeId: number; centreId: number; payload: Record<string, string>; uploadIds: string[]; reraiseOf?: string;
};

export async function raise(session: string | undefined, r: RaiseInput): Promise<{ id: string; created: boolean }> {
  if (!isUuid(r.ticketId) || (r.reraiseOf !== undefined && !isUuid(r.reraiseOf))) throw new TicketError("invalid", "malformed id");
  if (!r.uploadIds.every(isUuid)) throw new TicketError("document", "upload not usable");
  const pre = await withScope(session, async (tx) => {
    const [dup] = await tx.$queryRaw<{ n: number }[]>`select 1 as n from app.ticket where id = ${r.ticketId}::uuid`;
    const [source] = r.reraiseOf ? await tx.$queryRaw<{ centre_id: number; type_id: number }[]>`
      select centre_id, type_id from app.ticket where id = ${r.reraiseOf}::uuid` : [];
    return { dup: !!dup, source };
  });
  if (pre.dup) return { id: r.ticketId, created: false }; // nothing written, nothing audited
  if (r.reraiseOf && !pre.source) throw new TicketError("invalid", "nothing to re-raise");
  // a re-raise keeps the rejected ticket's type and centre, whatever the form sent (DD-9)
  const centreId = pre.source?.centre_id ?? r.centreId;
  const typeId = pre.source?.type_id ?? r.typeId;
  if (!Number.isSafeInteger(centreId) || !Number.isSafeInteger(typeId)) throw new TicketError("invalid");
  const docs = await checkUploads(session, centreId, r.uploadIds);

  const res = await scopedAction(session, { action: "ticket.raise", permission: "ticket.raise", centreId,
    targetType: "ticket", targetId: r.ticketId }, (tx, ctx) => ticketDb(r.ticketId, async () => {
    const handler = await lockHandler(tx, typeId);
    // the re-raise checks come before any domain answer, so a non-raiser learns nothing from prepare (correction-tickets D1)
    let source: unknown;
    if (r.reraiseOf) {
      const [old] = await tx.$queryRaw<{ status: string; raised_by: string; payload: unknown }[]>`
        select status::text, raised_by::text, payload from app.ticket where id = ${r.reraiseOf}::uuid for update`;
      if (old?.status !== "REJECTED" || old.raised_by !== ctx.userId) throw new TicketError("invalid", "only the raiser can re-raise a rejected ticket");
      source = old.payload;
    }
    const [type] = await tx.$queryRaw<{ code: string; number_prefix: string; document_required: boolean }[]>`
      select code, number_prefix, document_required from app.ticket_type where id = ${typeId}`;
    const parsed = handler.parse(r.payload);
    const payload = handler.prepare
      ? await handler.prepare(tx, { centreId, payload: parsed, ...(r.reraiseOf ? { source } : {}) })
      : parsed;
    await handler.validate(tx, { centreId, payload });
    if (type!.document_required && docs.length === 0) throw new TicketError("document", "a document is required");
    const levels = await tx.$queryRaw<{ level: number; approver_user_id: string | null; approver_role_id: number | null }[]>`
      select level, approver_user_id::text, approver_role_id from app.ticket_type_level where type_id = ${typeId} order by level`;
    if (levels.length === 0 || levels.some((l, i) => l.level !== i + 1)) throw new TicketError("inactive", "type has no valid levels");
    const seq = await allocateGlobal(tx, "TICKET", TICKET_POLICY.numberPeriod);
    const number = formatTicketNumber({ prefix: type!.number_prefix, typeCode: type!.code, number: seq,
      pad: TICKET_POLICY.numberPad, maxLength: TICKET_POLICY.numberMaxLength });
    await tx.$executeRaw`insert into app.ticket (id, number, type_id, centre_id, raised_by, level_count, payload, reraise_of)
      values (${r.ticketId}::uuid, ${number}, ${typeId}, ${centreId}, ${ctx.userId}::uuid, ${levels.length},
              ${JSON.stringify(payload)}::jsonb, ${r.reraiseOf ?? null}::uuid)`;
    for (const l of levels) await tx.$executeRaw`insert into app.ticket_level (ticket_id, centre_id, level, approver_user_id, approver_role_id)
      values (${r.ticketId}::uuid, ${centreId}, ${l.level}, ${l.approver_user_id}::uuid, ${l.approver_role_id})`;
    for (const d of docs) await tx.$executeRaw`insert into app.ticket_document (ticket_id, centre_id, upload_id, content_type, size_bytes)
      values (${r.ticketId}::uuid, ${centreId}, ${d.uploadId}::uuid, ${d.contentType}, ${d.size})`;
    await event(tx, { id: r.ticketId, centreId }, "RAISE", 1, { detail: r.reraiseOf ? { reraiseOf: r.reraiseOf } : {} });
    return { number };
  }), (x) => ({ after: { number: x.number, typeId, level: 1 }, ...(r.reraiseOf ? { reraiseOf: r.reraiseOf } : {}) }));
  void res;
  return { id: r.ticketId, created: true };
}

// ---------- Act: approve, reject, forward ----------

export type ActInput = { ticketId: string; action: "approve" | "reject" | "forward"; seenVersion: number; remarks?: string; forwardTo?: string };
type ActResult = { before: unknown; after: unknown; level: number; final: boolean };

export async function act(session: string | undefined, a: ActInput): Promise<void> {
  if (!["approve", "reject", "forward"].includes(a.action) || !Number.isSafeInteger(a.seenVersion)) throw new TicketError("invalid");
  if (a.action === "forward" && !isUuid(a.forwardTo)) throw new TicketError("invalid", "choose who to forward to");
  const { centreId } = await locate(session, a.ticketId);
  await scopedAction(session, {
    action: a.action === "approve" ? "ticket.approve" : a.action === "reject" ? "ticket.reject" : "ticket.forward",
    permission: "ticket.approve", centreId, targetType: "ticket", targetId: a.ticketId,
  }, (tx) => ticketDb(a.ticketId, async (): Promise<ActResult> => {
    const t = await lockTicket(tx, a.ticketId);
    // the second of two racing approvers waits on the lock above, then sees the new version (T-TKT-006)
    if (!t || t.status !== "OPEN" || t.version !== a.seenVersion) throw new TicketError("conflict");
    const [may] = await tx.$queryRaw<{ ok: boolean }[]>`select app.ticket_may_act(${t.id}::uuid) as ok`;
    if (!may?.ok) throw new Forbidden("not allowed to act on this ticket"); // includes self-approval and distinct approvers
    const level = t.currentLevel;
    const remarks = a.remarks?.trim() || null;

    if (a.action === "reject") {
      if (!remarks) throw new TicketError("invalid", "remarks are required to reject");
      await bump(tx, t, Prisma.sql`status = 'REJECTED', closed_at = now()`);
      await event(tx, t, "REJECT", level, { remarks });
      return { before: { status: "OPEN", level }, after: { status: "REJECTED" }, level, final: false };
    }
    if (a.action === "forward") {
      const [ok] = await tx.$queryRaw<{ ok: boolean }[]>`select app.ticket_may_receive(${t.id}::uuid, ${a.forwardTo}::uuid) as ok`;
      if (!ok?.ok) throw new TicketError("invalid", "that user cannot receive this ticket");
      await bump(tx, t, Prisma.sql`assigned_user_id = ${a.forwardTo}::uuid`);
      await event(tx, t, "FORWARD", level, { remarks, toUserId: a.forwardTo });
      return { before: { assignedUserId: t.assignedUserId }, after: { assignedUserId: a.forwardTo }, level, final: false };
    }
    if (level < t.levelCount) {
      await bump(tx, t, Prisma.sql`current_level = current_level + 1, assigned_user_id = null`);
      await event(tx, t, "APPROVE", level, { remarks });
      return { before: { level, assignedUserId: t.assignedUserId }, after: { level: level + 1, assignedUserId: null }, level, final: false };
    }
    // last level: re-check, apply, close, all in this transaction (G1, G2, G7)
    const handler = await lockHandler(tx, t.typeId);
    if (handler.revalidate) await handler.revalidate(tx, t);
    else await handler.validate(tx, { centreId: t.centreId, payload: t.payload });
    let change: { before: unknown; after: unknown };
    try {
      change = await handler.apply(tx, t);
    } catch (e) {
      // a write conflict or a lost connection is not the handler failing: let withScope retry it (C-26)
      if ((e as { code?: string }).code === "P2034" || isConnectionLost(e)) throw e;
      throw new ApplyFailed(level, e);
    }
    await bump(tx, t, Prisma.sql`status = 'APPROVED', closed_at = now()`);
    await event(tx, t, "APPROVE", level, { remarks, detail: { final: true } });
    return { ...change, level, final: true };
  }), (r) => ({ before: r.before, after: r.after, level: r.level, final: r.final }),
  (e) => e instanceof ApplyFailed
    ? { action: "ticket.apply_failed", extra: { level: e.level, error: e.cause instanceof Error ? e.cause.name : "unknown" } }
    : null);
}

// ---------- Administrator reassign (DD-13) ----------

export async function reassign(session: string | undefined, r: { ticketId: string; seenVersion: number; toUserId: string }): Promise<void> {
  if (!isUuid(r.ticketId)) throw new TicketNotFound();
  if (!isUuid(r.toUserId) || !Number.isSafeInteger(r.seenVersion)) throw new TicketError("invalid", "choose who to reassign to");
  // network-wide: no centreId, so only an ALL-scope ticket.type.manage counts; it also makes every centre visible
  await adminWrite(session, { action: "ticket.reassign", permission: "ticket.type.manage", targetType: "ticket", targetId: r.ticketId },
    (tx) => ticketDb(r.ticketId, async () => {
      const t = await lockTicket(tx, r.ticketId);
      if (!t) throw new TicketNotFound();
      if (t.status !== "OPEN" || t.version !== r.seenVersion) throw new TicketError("conflict");
      const [ok] = await tx.$queryRaw<{ ok: boolean }[]>`select app.ticket_may_receive(${t.id}::uuid, ${r.toUserId}::uuid) as ok`;
      if (!ok?.ok) throw new TicketError("invalid", "that user cannot receive this ticket");
      await bump(tx, t, Prisma.sql`assigned_user_id = ${r.toUserId}::uuid`);
      await event(tx, t, "FORWARD", t.currentLevel, { toUserId: r.toUserId, detail: { admin: true } });
      return { before: { assignedUserId: t.assignedUserId }, after: { assignedUserId: r.toUserId } };
    }), (x) => x);
}

// ---------- Reads ----------

export type TicketListRow = {
  id: string; number: string; status: string; currentLevel: number; levelCount: number; typeName: string;
  priority: string; centreId: number; centreCode: string; raisedBy: string; createdAt: Date;
};

// Keyset cursor, opaque to the browser: base64url of "<created_at ISO>|<id>" of the last row shown.
const encodeCursor = (r: { createdAt: Date; id: string }) => Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString("base64url");
function decodeCursor(c?: string): { at: Date; id: string } | null {
  if (!c) return null;
  const [at, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
  const d = new Date(at ?? "");
  if (Number.isNaN(d.getTime()) || !isUuid(id)) throw new TicketError("invalid", "bad page cursor");
  return { at: d, id };
}

const listColumns = Prisma.sql`t.id::text, t.number, t.status::text, t.current_level as "currentLevel", t.level_count as "levelCount",
  ty.name as "typeName", ty.priority::text, t.centre_id as "centreId", c.code as "centreCode", t.raised_by::text as "raisedBy",
  t.created_at as "createdAt"`; // constant SQL, no input
const page = <R extends TicketListRow>(rows: R[]) => ({ rows, next: rows.length === PAGE ? encodeCursor(rows[rows.length - 1]!) : null });

// ---------- Approvals workbench (docs/designs/approvals-workbench): the queue, its cards, bulk approve and reject ----------

export type QueueFilter = Partial<Record<"type" | "centre" | "from" | "to", string | string[]>>;
export type QueueRow = TicketListRow & { version: number };
const QUEUE_KEYS = ["type", "centre", "from", "to"];
/** The queue's filters: only these four keys; anything else matches nothing (R4). */
const parseQueue = (f: Record<string, unknown>) =>
  Object.keys(f).some((k) => !QUEUE_KEYS.includes(k) && f[k] !== undefined) ? "invalid" as const : parseFilter(f as TicketFilter);

/** What the session may act on now, oldest first (T-TKT-003): the same rule act() applies, as one set. */
export async function approvalQueue(session: string | undefined, f: QueueFilter & { cursor?: string | string[] } = {})
  : Promise<{ rows: QueueRow[]; next: string | null }> {
  const { cursor, ...rest } = f;
  return withScope(session, async (tx) => {
    const p = parseQueue(rest), c = cursorOf(cursor);
    if (p === "invalid" || c === "invalid") return { rows: [], next: null }; // a bad cursor no longer throws (R8)
    return page(await tx.$queryRaw<QueueRow[]>`
      select ${listColumns}, t.version ${manageFrom} ${manageWhere(p, ACTABLE)}
        ${c ? Prisma.sql`and (t.created_at, t.id) > (${c.at}, ${c.id}::uuid)` : Prisma.empty}
      order by t.created_at, t.id limit ${PAGE}`);
  });
}

export type QueueCards = { total: number; byType: { typeId: number; code: string; name: string; count: number }[];
  byCentre: { centreId: number; code: string; name: string; count: number }[] };

/** The queue's cards (R-144): per type ignoring the type filter, per centre ignoring the centre filter, so neither select
 * traps the user (D8); total is derived (I4). */
export async function queueCards(session: string | undefined, f: QueueFilter = {}): Promise<QueueCards> {
  return withScope(session, async (tx) => {
    const p = parseQueue(f);
    if (p === "invalid") return { total: 0, byType: [], byCentre: [] };
    const byType = await tx.$queryRaw<QueueCards["byType"]>`
      select ty.id as "typeId", ty.code, ty.name, count(*)::int as count ${manageFrom} ${manageWhere({ ...p, type: undefined }, ACTABLE)}
      group by ty.id, ty.code, ty.name order by ty.code, ty.id`;
    const byCentre = await tx.$queryRaw<QueueCards["byCentre"]>`
      select c.id as "centreId", c.code, c.name, count(*)::int as count ${manageFrom} ${manageWhere({ ...p, centre: undefined }, ACTABLE)}
      group by c.id, c.code, c.name order by c.code, c.id`;
    const total = p.type === undefined ? byType.reduce((n, r) => n + r.count, 0) : byType.find((r) => r.typeId === p.type)?.count ?? 0;
    return { total, byType, byCentre };
  });
}

export type BulkResult = { done: number; conflict: number; forbidden: number; invalid: number; failed: number };
export const BULK_MAX = 50; // PMC; confirmed by the timing run (D2)

/**
 * Approve or reject several tickets, each through act() in its own transactions, with its own lock, version check,
 * permission, handler and audit (DD-3). Refusals are counted by reason; anything else is rethrown and stops the batch,
 * leaving what was done committed (a resubmit then reports those as conflicts).
 */
export async function bulkAct(session: string | undefined, b: { action: "approve" | "reject"; remarks?: string;
  items: { ticketId: string; seenVersion: number }[] }): Promise<BulkResult> {
  // nothing is touched unless the batch itself is well formed (Z7)
  if (b?.action !== "approve" && b?.action !== "reject") throw new TicketError("invalid", "choose approve or reject");
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > BULK_MAX) throw new TicketError("invalid", `choose 1-${BULK_MAX} tickets`);
  const remarks = typeof b.remarks === "string" ? b.remarks.trim() : "";
  if (b.action === "reject" && !remarks) throw new TicketError("invalid", "remarks are required to reject");
  const r: BulkResult = { done: 0, conflict: 0, forbidden: 0, invalid: 0, failed: 0 };
  for (const it of b.items) {
    try {
      await act(session, { ticketId: it.ticketId, action: b.action, seenVersion: it.seenVersion, remarks: remarks || undefined });
      r.done++;
    } catch (e) {
      // counting (C3): a non-UUID id is TicketNotFound -> forbidden; a duplicate becomes a conflict (R6)
      if (e instanceof Forbidden || e instanceof TicketNotFound) r.forbidden++;
      else if (e instanceof ApplyFailed) r.failed++;
      else if (e instanceof TicketError && (e.reason === "conflict" || e.reason === "stale")) r.conflict++;
      else if (e instanceof TicketError && e.reason === "invalid") r.invalid++;
      else if (e instanceof TicketError && e.reason === "inactive") r.failed++;
      else throw e; // ScopeError, a lost connection, a guard's P0001, a "document" reason (cannot occur here): stop (C4, I6)
    }
  }
  return r;
}

const STATUSES = ["OPEN", "APPROVED", "REJECTED"], PRIORITIES = ["LOW", "MEDIUM", "HIGH"];

// ---------- Ticket management view (docs/designs/ticket-management): one filter set for the list, the summary and the KPIs ----------

/** Raw GET values; validated once here (Z2). "" or undefined is "not given"; anything else invalid matches nothing (G3). */
export type TicketFilter = Partial<Record<"status" | "priority" | "type" | "centre" | "area" | "region" | "from" | "to" | "number", string | string[]>>;
export type TicketManageRow = TicketListRow & { areaName: string; regionCode: string };
type Parsed = { status?: string; priority?: string; type?: number; centre?: number; area?: number; region?: number;
  from?: string; to?: string; like?: string };
const ID_RE = /^\d{1,9}$/;
/** A real calendar date: Date.parse rolls 2026-02-30 over to March, so round-trip it (R6). */
const okDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
function parseFilter(f: TicketFilter): Parsed | "invalid" {
  const out: Parsed = {};
  for (const [k, raw] of Object.entries(f)) {
    if (raw === undefined || raw === "") continue;
    if (typeof raw !== "string") return "invalid"; // a repeated parameter (R3)
    if (k === "status") { if (!STATUSES.includes(raw)) return "invalid"; out.status = raw; }
    else if (k === "priority") { if (!PRIORITIES.includes(raw)) return "invalid"; out.priority = raw; }
    else if (k === "type" || k === "centre" || k === "area" || k === "region") { if (!ID_RE.test(raw)) return "invalid"; out[k] = Number(raw); }
    else if (k === "from" || k === "to") { if (!okDate(raw)) return "invalid"; out[k] = raw; }
    else if (k === "number") { if (raw.length > 40) return "invalid"; out.like = raw.replace(/[\\%_]/g, "\\$&") + "%"; } // literal wildcards (R12)
    else return "invalid";
  }
  return out;
}
// One FROM clause and one condition set for both reads (C11); dates are IST days, index-friendly (D2)
const manageFrom = Prisma.sql`from app.ticket t join app.ticket_type ty on ty.id = t.type_id join app.centre c on c.id = t.centre_id
  join app.area a on a.id = c.area_id join app.region r on r.id = a.region_id`;
// Visibility as one set (0023 app.visible_ticket_ids, measured): ticket_may_view's rows, computed once per query
// instead of once per row (D3; the per-row definer cost 13 s for 5.5k tickets of a user without ticket.view).
const VISIBLE = Prisma.sql`t.id in (select app.visible_ticket_ids())`;
// The set of tickets the session may act on now (0024, measured: the per-row ticket_may_act cost 4.1 s on 2,412 open).
const ACTABLE = Prisma.sql`t.id in (select app.actable_ticket_ids())`;
const manageWhere = (p: Parsed, base = VISIBLE) => Prisma.sql`where ${base}
  ${p.status ? Prisma.sql`and t.status = ${p.status}::app."TicketStatus"` : Prisma.empty}
  ${p.priority ? Prisma.sql`and ty.priority = ${p.priority}::app."TicketPriority"` : Prisma.empty}
  ${p.type !== undefined ? Prisma.sql`and t.type_id = ${p.type}` : Prisma.empty}
  ${p.centre !== undefined ? Prisma.sql`and t.centre_id = ${p.centre}` : Prisma.empty}
  ${p.area !== undefined ? Prisma.sql`and c.area_id = ${p.area}` : Prisma.empty}
  ${p.region !== undefined ? Prisma.sql`and a.region_id = ${p.region}` : Prisma.empty}
  ${p.from ? Prisma.sql`and t.created_at >= (${p.from}::date)::timestamp at time zone 'Asia/Kolkata'` : Prisma.empty}
  ${p.to ? Prisma.sql`and t.created_at < ((${p.to}::date) + 1)::timestamp at time zone 'Asia/Kolkata'` : Prisma.empty}
  ${p.like ? Prisma.sql`and t.number ilike ${p.like}` : Prisma.empty}`;

/** The page cursor, or "invalid" for an array or a string decodeCursor refuses: a bad cursor matches nothing (Z1, Z5). */
function cursorOf(cursor: unknown): { at: Date; id: string } | null | "invalid" {
  if (cursor === undefined || cursor === "") return null;
  if (typeof cursor !== "string") return "invalid";
  try { return decodeCursor(cursor); } catch (e) { if (e instanceof TicketError) return "invalid"; throw e; }
}

export async function listTickets(session: string | undefined, f: TicketFilter & { cursor?: string | string[] } = {})
  : Promise<{ rows: TicketManageRow[]; next: string | null }> {
  const { cursor, ...rest } = f;
  return withScope(session, async (tx) => {
    const p = parseFilter(rest);
    const c = cursorOf(cursor);
    if (p === "invalid" || c === "invalid") return { rows: [], next: null };
    return page(await tx.$queryRaw<TicketManageRow[]>`
      select ${listColumns}, a.name as "areaName", r.code as "regionCode"
      ${manageFrom} ${manageWhere(p)}
        ${c ? Prisma.sql`and (t.created_at, t.id) < (${c.at}, ${c.id}::uuid)` : Prisma.empty}
      order by t.created_at desc, t.id desc limit ${PAGE}`);
  });
}

export type TicketSummary = { kpi: { total: number; open: number; approved: number; rejected: number; forwarded: number };
  byType: { typeId: number; code: string; name: string; open: number; approved: number; rejected: number; total: number; forwarded: number }[] };

/** Per-type counts and the KPI tiles (their sums) under the same filters; the tiles follow every filter, status included (D6). */
export async function ticketSummary(session: string | undefined, f: TicketFilter = {}): Promise<TicketSummary> {
  return withScope(session, async (tx) => {
    const p = parseFilter(f);
    const byType = p === "invalid" ? [] : await tx.$queryRaw<TicketSummary["byType"]>`
      select ty.id as "typeId", ty.code, ty.name,
             count(*) filter (where t.status = 'OPEN')::int as open, count(*) filter (where t.status = 'APPROVED')::int as approved,
             count(*) filter (where t.status = 'REJECTED')::int as rejected, count(*)::int as total,
             count(*) filter (where t.status = 'OPEN' and exists (select 1 from app.ticket_event e where e.ticket_id = t.id
               and e.action = 'FORWARD' and coalesce(e.detail->>'admin', '') <> 'true'))::int as forwarded
      ${manageFrom} ${manageWhere(p)}
      group by ty.id, ty.code, ty.name order by ty.code, ty.id`;
    const sum = (k: "open" | "approved" | "rejected" | "total" | "forwarded") => byType.reduce((n, r) => n + r[k], 0);
    return { kpi: { total: sum("total"), open: sum("open"), approved: sum("approved"), rejected: sum("rejected"), forwarded: sum("forwarded") }, byType };
  });
}

/** The pickers: the centres and types of tickets the caller may view, with their areas and regions; one scan (R5). */
export async function ticketFilterOptions(session: string | undefined) {
  return withScope(session, async (tx) => {
    const seen = await tx.$queryRaw<{ centreId: number; typeId: number }[]>`
      select distinct t.centre_id as "centreId", t.type_id as "typeId" from app.ticket t where ${VISIBLE}`;
    const centreIds = [...new Set(seen.map((x) => x.centreId))], typeIds = [...new Set(seen.map((x) => x.typeId))];
    const centres = await tx.$queryRaw<{ id: number; code: string; name: string; areaId: number; areaName: string; regionId: number; regionCode: string }[]>`
      select c.id, c.code, c.name, a.id as "areaId", a.name as "areaName", r.id as "regionId", r.code as "regionCode"
      from app.centre c join app.area a on a.id = c.area_id join app.region r on r.id = a.region_id
      where c.id = any (${centreIds}::int[]) order by c.code, c.id`;
    const types = await tx.$queryRaw<{ id: number; code: string; name: string }[]>`
      select id, code, name from app.ticket_type where id = any (${typeIds}::int[]) order by code, id`;
    const regions = [...new Map(centres.map((c) => [c.regionId, { id: c.regionId, code: c.regionCode }])).values()]
      .sort((x, y) => x.code.localeCompare(y.code) || x.id - y.id);
    const areas = [...new Map(centres.map((c) => [c.areaId, { id: c.areaId, label: `${c.regionCode} / ${c.areaName}`, k: [c.regionCode, c.areaName] }])).values()]
      .sort((x, y) => x.k[0]!.localeCompare(y.k[0]!) || x.k[1]!.localeCompare(y.k[1]!) || x.id - y.id).map(({ id, label }) => ({ id, label }));
    return { regions, areas, centres: centres.map(({ id, code, name }) => ({ id, code, name })), types };
  });
}

export async function raiseOptions(session: string | undefined) {
  return withScope(session, async (tx) => {
    const types = await tx.$queryRaw<{ id: number; code: string; name: string; handler_key: string; document_required: boolean }[]>`
      select id, code, name, handler_key, document_required from app.ticket_type where active order by name, id`;
    const centres = await tx.$queryRaw<{ id: number; code: string; name: string }[]>`
      select id, code, name from app.centre where id = any (app.scoped_centre_ids('ticket.raise')) order by code`;
    return {
      types: types.filter((t) => HANDLERS[t.handler_key]).map((t) => ({ id: t.id, code: t.code, name: t.name,
        documentRequired: t.document_required, fields: HANDLERS[t.handler_key]!.fields as TicketField[] })),
      centres,
    };
  });
}

export async function getTicket(session: string | undefined, id: string) {
  if (!isUuid(id)) throw new TicketNotFound();
  return withScope(session, async (tx) => {
    const [t] = await tx.$queryRaw<(TicketListRow & { payload: unknown; version: number; assignedUserId: string | null;
      reraiseOf: string | null; closedAt: Date | null; typeCode: string; handlerKey: string; canView: boolean; canAct: boolean })[]>`
      select ${listColumns}, t.payload, t.version, t.assigned_user_id::text as "assignedUserId", t.reraise_of::text as "reraiseOf",
             t.closed_at as "closedAt", ty.code as "typeCode", ty.handler_key as "handlerKey",
             app.ticket_may_view(t.id) as "canView", app.ticket_may_act(t.id) as "canAct"
      from app.ticket t join app.ticket_type ty on ty.id = t.type_id join app.centre c on c.id = t.centre_id
      where t.id = ${id}::uuid`;
    if (!t?.canView) throw new TicketNotFound();
    const levels = await tx.$queryRaw<{ level: number; approverUserId: string | null; approverRoleId: number | null; roleName: string | null }[]>`
      select l.level, l.approver_user_id::text as "approverUserId", l.approver_role_id as "approverRoleId", r.name as "roleName"
      from app.ticket_level l left join app.role r on r.id = l.approver_role_id where l.ticket_id = ${id}::uuid order by l.level`;
    const history = await tx.$queryRaw<{ id: bigint; at: Date; actorId: string; action: string; level: number; remarks: string | null;
      toUserId: string | null; detail: unknown }[]>`
      select id, at, actor_id::text as "actorId", action::text, level, remarks, to_user_id::text as "toUserId", detail
      from app.ticket_event where ticket_id = ${id}::uuid order by id`;
    const documents = await tx.$queryRaw<{ id: bigint; fileName: string; contentType: string; sizeBytes: bigint; at: Date }[]>`
      select d.id, u.file_name as "fileName", d.content_type as "contentType", d.size_bytes as "sizeBytes", d.at
      from app.ticket_document d join app.ticket_upload u on u.id = d.upload_id where d.ticket_id = ${id}::uuid order by d.id`;
    const people = await tx.$queryRaw<{ id: string; display_name: string }[]>`select id::text, display_name from app.ticket_people(${id}::uuid)`;
    const [m] = await tx.$queryRaw<{ ok: boolean }[]>`select app.has_permission('ticket.type.manage', null) as ok`;
    const canReassign = !!m?.ok && t.status === "OPEN";
    const candidates = t.canAct || canReassign
      ? await tx.$queryRaw<{ id: string; display_name: string }[]>`select id::text, display_name from app.ticket_forward_candidates(${id}::uuid)`
      : [];
    // DD-16: a handler may require a permission to see the payload, for those who cannot act (one rule, here)
    const h = HANDLERS[t.handlerKey];
    let visible = t.canAct || !h?.valuesPermission;
    if (!visible) {
      const [v] = await tx.$queryRaw<{ ok: boolean }[]>`select app.has_permission(${h!.valuesPermission!}, ${t.centreId}::int) as ok`;
      visible = !!v?.ok;
    }
    let described: [string, string][] | null = null;
    if (visible && h?.describe) {
      try { described = h.describe(t.payload); } catch { described = null; } // a payload of an older handler: the JSON
    }
    return { ...t, payload: visible ? t.payload : null, described, hasReview: !!h?.review, levels, history, documents,
      canReassign, candidates, names: Object.fromEntries(people.map((p) => [p.id, p.display_name])) as Record<string, string> };
  });
}

/**
 * The handler's review lines for one who may act (DD-6, DD-17), audited as ticket.review.duplicates with the matched
 * person ids. A failing review degrades to one line, audited FAILED in its own transaction; a lost connection, an
 * expired session and a refusal are not hidden (R1).
 */
export async function ticketReview(session: string | undefined, ticketId: string): Promise<string[]> {
  const { centreId } = await locate(session, ticketId);
  try {
    const r = await scopedAction(session, { action: "ticket.review.duplicates", permission: "ticket.approve", centreId, targetType: "ticket", targetId: ticketId },
      async (tx) => {
        const [t] = await tx.$queryRaw<{ payload: unknown; handler_key: string; ok: boolean }[]>`
          select t.payload, ty.handler_key, app.ticket_may_act(t.id) as ok
          from app.ticket t join app.ticket_type ty on ty.id = t.type_id where t.id = ${ticketId}::uuid`;
        if (!t?.ok) throw new Forbidden("not an approver of this ticket");
        const review = HANDLERS[t.handler_key]?.review;
        return review ? review(tx, { centreId, payload: t.payload }) : { lines: [], matches: [] };
      }, (x) => ({ matches: x.matches }),
      (e) => (isConnectionLost(e) || e instanceof ScopeError || e instanceof Forbidden ? null
        : { action: "ticket.review.duplicates", extra: { error: e instanceof Error ? e.name : "unknown" } }));
    return r.lines;
  } catch (e) {
    if (isConnectionLost(e) || e instanceof ScopeError || e instanceof Forbidden) throw e;
    console.error(JSON.stringify({ level: "error", msg: "ticket review failed", error: e instanceof Error ? e.name : "unknown" }));
    return ["Review unavailable"];
  }
}

export async function documentLink(session: string | undefined, ticketId: string, documentId: number): Promise<string> {
  const { centreId } = await locate(session, ticketId);
  if (!Number.isSafeInteger(documentId)) throw new TicketNotFound();
  const key = await scopedAction(session, { action: "ticket.document.download", permission: "ticket.document.view", centreId,
    targetType: "ticket_document", targetId: String(documentId) }, async (tx) => {
    const [d] = await tx.$queryRaw<{ storage_key: string }[]>`
      select u.storage_key from app.ticket_document d join app.ticket_upload u on u.id = d.upload_id
      where d.id = ${documentId} and d.ticket_id = ${ticketId}::uuid`;
    if (!d) throw new TicketNotFound(); // a document of another ticket looks like a missing one
    return d.storage_key;
  });
  return (await storage()).signedDownloadUrl(key, TICKET_POLICY.downloadUrlSeconds);
}
