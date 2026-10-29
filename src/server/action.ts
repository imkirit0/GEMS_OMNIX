// Every mutation goes through scopedAction: authorize -> change -> audit, in one transaction.
// A denial rolls the business transaction back and is audited in its own transaction (T-RLS-018);
// so is a failure the caller's onFailure hook chooses to record (outcome FAILED, e.g. ticket.apply_failed).
import { withScope, type Ctx, type Tx } from "./db";

export class Forbidden extends Error {
  override name = "Forbidden";
  /** the permission that was missing, when it differs from the action's own (enquiry I7) */
  constructor(message?: string, readonly permission?: string) { super(message); }
}

export type ActionMeta = {
  action: string; // audit action name
  permission: string; // domain.resource.action
  centreId?: number; // omit for network-wide actions (then only ALL-scope grants count)
  targetType?: string;
  targetId?: string;
  reason?: string; // why (required by policy for some sensitive actions)
};

export async function authorize(tx: Tx, permission: string, centreId?: number): Promise<void> {
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    select app.has_permission(${permission}, ${centreId ?? null}::int) as ok`;
  if (!row?.ok) throw new Forbidden(`${permission} denied${centreId == null ? "" : ` for centre ${centreId}`}`, permission);
}

/** What an action may add to its audit row. `before`/`after` and `reason` get their own columns (T-AUD-001). */
export type AuditExtra = { before?: unknown; after?: unknown; reason?: string; [k: string]: unknown };

// All app audit rows go through app.audit(): actor, session, roles, scope, request id and ip are filled by the DB.
async function audit(tx: Tx, meta: ActionMeta, outcome: "OK" | "DENIED" | "FAILED", extra: AuditExtra) {
  const { before, after, reason, ...detail } = extra;
  await tx.$executeRaw`select app.audit(${meta.action}, ${outcome}::app."AuditOutcome", ${meta.centreId ?? null}::int,
    ${meta.targetType ?? null}::text, ${meta.targetId ?? null}::text, ${reason ?? meta.reason ?? null}::text,
    ${before === undefined ? null : JSON.stringify(before)}::jsonb, ${after === undefined ? null : JSON.stringify(after)}::jsonb,
    ${JSON.stringify(detail)}::jsonb)`;
}

export async function scopedAction<T>(
  session: string | undefined,
  meta: ActionMeta,
  fn: (tx: Tx, ctx: Ctx) => Promise<T>,
  auditDetail: (result: T) => AuditExtra = () => ({}),
  onFailure?: (e: unknown) => { action: string; extra: AuditExtra } | null,
): Promise<T> {
  try {
    return await withScope(session, async (tx, ctx) => {
      await authorize(tx, meta.permission, meta.centreId);
      const result = await fn(tx, ctx);
      await audit(tx, meta, "OK", auditDetail(result));
      return result;
    });
  } catch (e) {
    // Runs once, after withScope's retries. Forbidden wins: DENIED, and the hook is not asked.
    const failed = e instanceof Forbidden ? null : onFailure?.(e);
    try {
      if (e instanceof Forbidden) await withScope(session, (tx) => audit(tx, meta, "DENIED", { permission: e.permission ?? meta.permission }));
      else if (failed) await withScope(session, (tx) => audit(tx, { ...meta, action: failed.action }, "FAILED", failed.extra));
    } catch (auditError) {
      // never let a failed audit write hide why the action failed
      console.error(JSON.stringify({ level: "error", msg: "failure audit not written", action: meta.action,
        error: auditError instanceof Error ? auditError.name : "unknown" }));
    }
    throw e;
  }
}
