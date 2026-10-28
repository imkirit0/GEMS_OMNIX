// C-26 experiment: does a client pool larger than Supavisor's server pool cause the dropped connections?
// Repeats the T-NUM-001 workload (200 concurrent allocations on one series, all queued on its row lock) at
// several client pool sizes and counts runs that hit a connection error. Synthetic data only.
// Usage (repo poc/, after `node supabase.mjs setup`): POC_TARGET=supabase node c26-experiment.mjs [repeats] [sizes...]
import { createReceipt } from './src/receipts.js';
import { reset, appScope, firstStudent, asAdmin, C, T, PERIOD } from './test/helpers.js';

const repeats = Number(process.argv[2] ?? 6);
const sizes = (process.argv.slice(3).length ? process.argv.slice(3) : ['16', '12']).map(Number);
const results = [];

for (const size of sizes) {
  for (let r = 1; r <= repeats; r++) {
    await reset({ gapRule: 'UNIQUE' });
    const sA = await firstStudent(C.A);
    const app = appScope(size);
    const errors = {};
    app.pool.on('error', (e) => { errors[`pool:${e.code ?? e.message}`] = (errors[`pool:${e.code ?? e.message}`] ?? 0) + 1; });
    const t0 = Date.now();
    const out = await Promise.allSettled(Array.from({ length: 200 }, (_, i) => createReceipt(app.withScope, T.uA, {
      centreId: C.A, studentId: sA, docType: 'FEEREC', period: PERIOD, amountPaise: 10000, idempotencyKey: `c26-${size}-${r}-${i}`,
    })));
    for (const o of out) if (o.status === 'rejected') errors[o.reason?.code ?? o.reason?.message] = (errors[o.reason?.code ?? o.reason?.message] ?? 0) + 1;
    const committed = await asAdmin((db) => db.query(`select count(*)::int n, count(distinct number)::int d from app.receipt
      where centre_id = 1 and doc_type = 'FEEREC' and period = $1`, [PERIOD]).then((x) => x.rows[0]));
    await app.pool.end().catch(() => {});
    // orphaned server sessions from a drop would block the next reset: wait for them to go
    await asAdmin((db) => db.query(`select pg_terminate_backend(pid) from pg_stat_activity
      where usename = 'gems_app' and state <> 'idle'`)).catch(() => {});
    const row = { size, run: r, ms: Date.now() - t0, ok: out.filter((o) => o.status === 'fulfilled').length,
      committed: committed.n, distinct: committed.d, errors };
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
const summary = Object.fromEntries(sizes.map((s) => {
  const rs = results.filter((x) => x.size === s);
  return [s, { runs: rs.length, runsWithConnectionError: rs.filter((x) => Object.keys(x.errors).length).length,
    duplicateNumbers: rs.some((x) => x.committed !== x.distinct) }];
}));
console.log('SUMMARY ' + JSON.stringify(summary));
