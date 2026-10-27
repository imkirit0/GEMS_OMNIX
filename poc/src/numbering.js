// C-02.2 mechanism. Policy (NP-1..8) is unapproved; everything policy-shaped is a parameter.

// Allocate inside the caller's transaction. The row lock serialises allocators;
// a rollback releases the increment, which is what makes gapless possible.
export async function allocate(tx, { centreId, docType, period }) {
  const { rows } = await tx.query(
    `update app.number_series set current = current + 1
      where centre_id = $1 and doc_type = $2 and period = $3
      returning current, gap_rule`,
    [centreId, docType, period]);
  if (!rows.length) throw new Error(`no number series ${centreId}/${docType}/${period}`);
  return Number(rows[0].current);
}

// Indian financial year (Apr-Mar) of an instant, in Asia/Kolkata. NP-2 may choose AY instead.
export function financialYear(instant) {
  const ist = new Date(instant.getTime() + 330 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// NP-5 format is unapproved: pattern pieces and max length are inputs, not constants.
export function formatNumber({ centreCode, docType, period, number, pad = 6, maxLength }) {
  const s = `${centreCode}/${docType}/${period}/${String(number).padStart(pad, '0')}`;
  if (maxLength != null && s.length > maxLength) {
    throw new RangeError(`formatted number ${s.length} chars exceeds ${maxLength}`);
  }
  return s;
}
