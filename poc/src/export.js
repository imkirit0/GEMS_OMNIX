// Server-side streamed export: one transaction, a cursor, bounded batches, audited with the scope actually applied.
export function exportRows(withScope, session, { sql, params = [], batch = 500, action, requested }, onBatch) {
  return withScope(session, async (tx) => {
    await tx.query(`declare export_cur no scroll cursor for ${sql}`, params);
    let rows = 0;
    for (;;) {
      const r = await tx.query(`fetch ${Number(batch)} from export_cur`);
      if (!r.rows.length) break;
      rows += r.rows.length;
      await onBatch(r.rows);
    }
    await tx.query('close export_cur');
    await tx.query(
      `insert into app.audit_log (session_hash, action, outcome, detail)
       values (sha256(convert_to(current_setting('app.session_id'), 'UTF8')), $1, 'OK',
               jsonb_build_object('requested', $2::jsonb, 'scope', to_jsonb(app.visible_centre_ids()), 'rows', $3::int))`,
      [action, JSON.stringify(requested ?? null), rows]);
    return rows;
  });
}
