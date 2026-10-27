// Scoped DB access: the only way app code reaches the database (06 §3 "Pooling").
// Every unit of work is one transaction that starts with a transaction-local app.session_id.
export class ScopeError extends Error {}

const RETRYABLE = new Set(['40001', '40P01']); // serialization failure, deadlock

export function scoped(pool) {
  return async function withScope(sessionToken, fn, { retries = 3 } = {}) {
    if (!sessionToken) throw new ScopeError('missing session');
    for (let attempt = 0; ; attempt++) {
      const client = await pool.connect();
      let open = true;
      let broken;
      const tx = {
        query(...args) {
          if (!open) return Promise.reject(new ScopeError('query outside transaction'));
          return client.query(...args);
        },
      };
      try {
        await client.query('begin');
        await client.query("select set_config('app.session_id', $1, true)", [sessionToken]);
        const { rows } = await client.query('select app.session_is_valid() as ok');
        // fail loudly instead of rendering an empty page (T-RLS-006/007)
        if (!rows[0].ok) throw new ScopeError('invalid, expired or revoked session');
        const result = await fn(tx);
        await client.query('commit');
        return result;
      } catch (e) {
        await client.query('rollback').catch((err) => { broken = err; });
        if (attempt < retries && RETRYABLE.has(e.code)) continue;
        throw e;
      } finally {
        open = false;
        client.release(broken);
      }
    }
  };
}
