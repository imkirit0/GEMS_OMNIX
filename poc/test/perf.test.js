// T-RLS-017: paged-list overhead with vs without RLS. Local Docker numbers only; production-sized runs belong to PERF on Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reset, asAdmin, connected, writeEvidence, T, TARGET } from './helpers.js';

const CENTRES = 300, PER_CENTRE = 1000, RUNS = 300, WARMUP = 30;
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];

async function timeQuery(db, sql, params) {
  const out = [];
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const t = process.hrtime.bigint();
    await db.query(sql, typeof params === 'function' ? params(i) : params);
    if (i >= WARMUP) out.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  return +p95(out).toFixed(3);
}

test('T-RLS-017 RLS overhead on paged lists is measured', async () => {
  await reset({ studentsPerCentre: 0 });
  await asAdmin(async (db) => {
    await db.query(`insert into app.centre select g, 'X' || g, 1 + g % 2 from generate_series(5, $1 + 4) g`, [CENTRES - 4]);
    await db.query(`insert into app.student (centre_id, name) select c, 'S' || g from generate_series(1, $1) c, generate_series(1, $2) g`, [CENTRES, PER_CENTRE]);
    await db.query('analyze app.student');
  });
  const cases = {
    centrePage: { sql: 'select id, name from app.student where centre_id = 1 order by id limit 50 offset $1', params: (i) => [(i % 20) * 50], token: T.uA },
    allCentresPage: { sql: 'select id, name, centre_id from app.student order by id limit 50 offset $1', params: (i) => [(i % 20) * 50], token: T.hoAll },
  };
  const results = {};
  const su = await connected('postgres');
  const appDb = await connected('gems_app');
  try {
    for (const [name, c] of Object.entries(cases)) {
      const base = await timeQuery(su, c.sql, c.params);
      await appDb.query('begin');
      await appDb.query("select set_config('app.session_id', $1, true)", [c.token]);
      const rls = await timeQuery(appDb, c.sql, c.params);
      await appDb.query('rollback');
      results[name] = { p95NoRlsMs: base, p95RlsMs: rls, addedMs: +(rls - base).toFixed(3), overheadPct: +(((rls - base) / base) * 100).toFixed(1) };
    }
  } finally { await su.end(); await appDb.end(); }
  const rows = CENTRES * PER_CENTRE;
  writeEvidence('P2-rls', { 'T-RLS-017': { rows, runs: RUNS, proposedThresholdPct: 10, env: TARGET === 'supabase' ? 'Supabase ap-southeast-1 via session pooler, client in India (RTT included)' : 'local Docker, direct connections', results } });
  console.log(JSON.stringify(results));
  for (const r of Object.values(results)) assert.ok(Number.isFinite(r.overheadPct)); // failure condition is "not measured"
});
