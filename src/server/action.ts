// Every mutation goes through scopedAction: authorize -> change -> audit, in one transaction.
// A denial rolls the business transaction back and is audited in its own transaction (T-RLS-018).
import { withScope, type Ctx, type Tx } from "./db";

export class Forbidden extends Error {
  override name = "Forbidden";
}

export type ActionMeta = {
  action: string; // audit action name
  permission: string; // domain.resource.action
  centreId?: number; // omit for network-wide actions (then only ALL-scope grants count)
  targetType?: string;
  targetId?: string;
};

export async function authorize(tx: Tx, permission: string, centreId?: number): Promise<void> {
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    select app.has_permission(${permission}, ${centreId ?? null}::int) as ok`;
  if (!row?.ok) throw new Forbidden(`${permission} denied${centreId == null ? "" : ` for centre ${centreId}`}`);
}

async function audit(tx: Tx, meta: ActionMeta, outcome: "OK" | "DENIED", detail: object) {
  await tx.$executeRaw`
    insert into app.audit_log (user_id, action, outcome, target_centre_id, target_type, target_id, detail)
    values (app.session_user_id(), ${meta.action}, ${outcome}::app."AuditOutcome", ${meta.centreId ?? null}::int,
            ${meta.targetType ?? null}, ${meta.targetId ?? null}, ${JSON.stringify(detail)}::jsonb)`;
}

export async function scopedAction<T>(
  session: string | undefined,
  meta: ActionMeta,
  fn: (tx: Tx, ctx: Ctx) => Promise<T>,
  auditDetail: (result: T) => object = () => ({}),
): Promise<T> {
  try {
    return await withScope(session, async (tx, ctx) => {
      await authorize(tx, meta.permission, meta.centreId);
      const result = await fn(tx, ctx);
      await audit(tx, meta, "OK", auditDetail(result));
      return result;
    });
  } catch (e) {
    if (e instanceof Forbidden) {
      await withScope(session, (tx) => audit(tx, meta, "DENIED", { permission: meta.permission }));
    }
    throw e;
  }
}
