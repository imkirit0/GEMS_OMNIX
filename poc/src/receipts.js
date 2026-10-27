import { allocate } from './numbering.js';

export class Forbidden extends Error {}

const auditSql = `insert into app.audit_log (session_hash, action, outcome, target_centre_id, detail)
  values (sha256(convert_to(current_setting('app.session_id'), 'UTF8')), $1, $2, $3, $4)`;

// Scope check in the app layer; RLS is the second, independent gate.
async function authorizeCentre(tx, centreId) {
  const { rows } = await tx.query('select $1::int = any (app.visible_centre_ids()) as ok', [centreId]);
  if (!rows[0].ok) throw new Forbidden(`centre ${centreId} outside scope`);
}

const byKey = (tx, key) =>
  tx.query('select * from app.receipt where idempotency_key = $1', [key]).then((r) => r.rows[0]);

// hooks.afterAllocate lets tests inject failures between allocation and commit.
export async function createReceipt(withScope, session, input, hooks = {}) {
  const { centreId, studentId, docType, period, amountPaise, idempotencyKey } = input;
  try {
    return await withScope(session, async (tx) => {
      const existing = await byKey(tx, idempotencyKey);
      if (existing) return existing;
      await authorizeCentre(tx, centreId);
      const number = await allocate(tx, { centreId, docType, period });
      await hooks.afterAllocate?.(tx, number);
      const { rows } = await tx.query(
        `insert into app.receipt (centre_id, student_id, doc_type, period, number, amount_paise, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [centreId, studentId, docType, period, number, amountPaise, idempotencyKey]);
      await tx.query(auditSql, ['receipt.create', 'OK', centreId, { number, idempotencyKey }]);
      return rows[0];
    });
  } catch (e) {
    if (e instanceof Forbidden) {
      // denial is audited in its own transaction; the business tx (and any number) was rolled back
      await withScope(session, (tx) => tx.query(auditSql, ['receipt.create', 'DENIED', centreId, { idempotencyKey }]));
      throw e;
    }
    if (e.code === '23505' && e.constraint === 'receipt_idempotency_key_key') {
      // lost a race on the same idempotency key: return the winner's receipt
      return withScope(session, (tx) => byKey(tx, idempotencyKey));
    }
    throw e;
  }
}

export function cancelReceipt(withScope, session, id) {
  return withScope(session, async (tx) => {
    const { rowCount } = await tx.query(`update app.receipt set status = 'CANCELLED' where id = $1 and status = 'ACTIVE'`, [id]);
    if (rowCount !== 1) throw new Error(`receipt ${id} not cancellable`);
    await tx.query(auditSql, ['receipt.cancel', 'OK', null, { id }]);
  });
}
