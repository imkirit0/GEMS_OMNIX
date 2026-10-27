// P2: T-RLS-001..016, 018 (C-04). T-RLS-017 lives in perf.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ScopeError, scoped } from '../src/db.js';
import { createReceipt, Forbidden } from '../src/receipts.js';
import { exportRows } from '../src/export.js';
import { reset, asAdmin, connected, pool, appScope, firstStudent, writeEvidence, C, T, PERIOD, POOLED, TARGET } from './helpers.js';

const TENANT_TABLES = ['student', 'number_series', 'receipt', 'centre_daily_total'];
let app;
const evidence = {};

before(async () => { await reset(); app = appScope(); });
after(async () => { await app.pool.end(); writeEvidence('P2-rls', evidence); });

const centresSeen = (rows) => [...new Set(rows.map((r) => r.centre_id))].sort();
const rejects42501 = (p) => assert.rejects(p, (e) => e.code === '42501');

test('T-RLS-001 app roles have no superuser/bypass/owner/DDL/SET ROLE', async () => {
  for (const role of ['gems_app', 'gems_job']) {
    const attrs = await asAdmin((db) => db.query(
      `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
              (select count(*)::int from pg_class where relowner = r.oid) owned,
              pg_has_role(r.oid, 'gems_owner', 'MEMBER') member_of_owner
       from pg_roles r where rolname = $1`, [role]).then((r) => r.rows[0]));
    assert.deepEqual(attrs, { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, owned: 0, member_of_owner: false });
    const db = await connected(role);
    try {
      for (const sql of [
        'create table app.x (i int)', 'create table public.x (i int)',
        // Supabase grants TEMP to PUBLIC on its database; recorded as a finding instead of changing platform defaults
        ...(TARGET === 'local' ? ['create temp table x (i int)'] : []),
        'alter table app.student add column z int', 'drop table app.student', 'create schema s',
        'set role gems_owner', 'alter table app.student disable row level security', 'drop policy scope_select on app.student',
      ]) {
        await assert.rejects(db.query(sql), (e) => ['42501', '42P01'].includes(e.code) || /must be|permission/.test(e.message), sql);
      }
    } finally { await db.end(); }
  }
});

test('T-RLS-002 every table with centre_id has ENABLE+FORCE RLS and SELECT/INSERT/UPDATE/DELETE policies', async () => {
  const rows = await asAdmin((db) => db.query(`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity,
           array(select distinct p.cmd from pg_policies p where p.schemaname = 'app' and p.tablename = c.relname order by 1) cmds
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'p')
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'centre_id' and not a.attisdropped)
    order by 1`).then((r) => r.rows));
  assert.deepEqual(rows.map((r) => r.relname).sort(), [...TENANT_TABLES].sort(), 'coverage list must not be vacuous');
  for (const r of rows) {
    assert.ok(r.relrowsecurity && r.relforcerowsecurity, `${r.relname} RLS not enabled+forced`);
    for (const cmd of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.ok(r.cmds.includes(cmd) || r.cmds.includes('ALL'), `${r.relname} missing ${cmd} policy`);
    }
  }
});

test('T-RLS-003 every view is security_invoker and filters by scope', async () => {
  const views = await asAdmin((db) => db.query(`
    select c.relname, coalesce('security_invoker=true' = any (c.reloptions), false) inv
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind = 'v'`).then((r) => r.rows));
  assert.ok(views.length > 0);
  for (const v of views) assert.ok(v.inv, `${v.relname} runs with owner rights`);
  const rows = await app.withScope(T.uA, (tx) => tx.query('select centre_id from app.v_student').then((r) => r.rows));
  assert.deepEqual(centresSeen(rows), [C.A]);
});

test('T-RLS-004 materialized view not readable by app roles; aggregate table is RLS-scoped', async () => {
  for (const role of ['gems_app', 'gems_job', 'gems_report_ro']) {
    const db = await connected(role);
    try { await rejects42501(db.query('select * from app.centre_total_mv')); } finally { await db.end(); }
  }
  const rows = await app.withScope(T.uA, (tx) => tx.query('select centre_id from app.centre_daily_total').then((r) => r.rows));
  assert.deepEqual(centresSeen(rows), [C.A]);
});

test('T-RLS-005 SECURITY DEFINER inventory, fixed search_path, scope function truth table', async () => {
  const fns = await asAdmin((db) => db.query(`
    select p.proname, exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') fixed
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef order by 1`).then((r) => r.rows));
  assert.deepEqual(fns, [{ proname: 'session_is_valid', fixed: true }, { proname: 'visible_centre_ids', fixed: true }]);

  const expected = {
    [T.uA]: [1], [T.uB]: [2], [T.hoR1]: [1, 4], [T.hoAll]: [1, 2, 3, 4], [T.jobAB]: [1, 2],
    [T.expired]: [], [T.revoked]: [], 'random-forged': [], '': [],
  };
  const db = await connected('gems_app');
  try {
    for (const [tok, want] of Object.entries(expected)) {
      await db.query('begin');
      await db.query("select set_config('app.session_id', $1, true)", [tok]);
      const got = (await db.query('select app.visible_centre_ids() ids')).rows[0].ids;
      await db.query('rollback');
      assert.deepEqual([...got].sort(), want, `token ${tok || '(blank)'}`);
    }
    const none = (await db.query('select app.visible_centre_ids() ids')).rows[0].ids;
    assert.deepEqual(none, [], 'no setting at all');
  } finally { await db.end(); }
});

test('T-RLS-006 missing scope: 0 rows, writes fail, app guard raises', async () => {
  const db = await connected('gems_app', POOLED);
  try {
    await db.query('begin');
    for (const t of TENANT_TABLES) {
      assert.equal((await db.query(`select count(*)::int n from app.${t}`)).rows[0].n, 0, t);
    }
    await rejects42501(db.query(`insert into app.student (centre_id, name) values (1, 'x')`));
    await db.query('rollback');
  } finally { await db.end(); }
  await assert.rejects(app.withScope(undefined, async () => {}), ScopeError);
  await assert.rejects(app.withScope('', async () => {}), ScopeError);
});

test('T-RLS-007 forged/expired/revoked sessions and other GUCs grant nothing', async () => {
  const db = await connected('gems_app', POOLED);
  try {
    for (const tok of ['forged-' + Math.random(), T.expired, T.revoked]) {
      await db.query('begin');
      await db.query("select set_config('app.session_id', $1, true)", [tok]);
      await db.query("select set_config('app.centre_ids', '1,2,3,4', true), set_config('app.user_id', '4', true)");
      for (const t of TENANT_TABLES) {
        assert.equal((await db.query(`select count(*)::int n from app.${t}`)).rows[0].n, 0, `${tok} ${t}`);
      }
      await db.query('rollback');
      await assert.rejects(app.withScope(tok, async () => {}), ScopeError);
    }
  } finally { await db.end(); }
});

test('T-RLS-008 cross-centre writes under an A session are rejected or affect 0 rows', async () => {
  const before = await asAdmin((db) => db.query(`select md5(string_agg(id || name || centre_id, ',' order by id)) h from app.student where centre_id <> 1`).then((r) => r.rows[0].h));
  const sB = await firstStudent(C.B);
  await rejects42501(app.withScope(T.uA, (tx) => tx.query(`insert into app.student (centre_id, name) values (2, 'smuggled')`)));
  await rejects42501(app.withScope(T.uA, (tx) => tx.query(`update app.student set centre_id = 2 where centre_id = 1`)));
  await rejects42501(app.withScope(T.uA, (tx) => tx.query(
    `insert into app.receipt (centre_id, student_id, doc_type, period, number, amount_paise, idempotency_key) values (2, $1, 'FEEREC', $2, 999, 100, 'x-008')`, [sB, PERIOD])));
  // A centre row pointing at a B student: composite FK (RI bypasses RLS, so a plain FK would accept it)
  await assert.rejects(app.withScope(T.uA, (tx) => tx.query(
    `insert into app.receipt (centre_id, student_id, doc_type, period, number, amount_paise, idempotency_key) values (1, $1, 'FEEREC', $2, 999, 100, 'x-008b')`, [sB, PERIOD])),
    (e) => e.code === '23503');
  const del = await app.withScope(T.uA, (tx) => tx.query('delete from app.student where centre_id = 2'));
  const upd = await app.withScope(T.uA, (tx) => tx.query(`update app.student set name = 'pwned' where centre_id = 2`));
  const ser = await app.withScope(T.uA, (tx) => tx.query(`update app.number_series set current = 500 where centre_id = 2`));
  assert.equal(del.rowCount, 0);
  assert.equal(upd.rowCount, 0);
  assert.equal(ser.rowCount, 0);
  const afterH = await asAdmin((db) => db.query(`select md5(string_agg(id || name || centre_id, ',' order by id)) h from app.student where centre_id <> 1`).then((r) => r.rows[0].h));
  assert.equal(afterH, before);
});

test('T-RLS-009 PgBouncer transaction pooling: 2,000 interleaved txs, aborted txs, 0 leaks', async () => {
  const p = pool('gems_app', 16);
  const total = 2000;
  let leaks = 0, dirtyStarts = 0, aborted = 0, ok = 0;
  const backends = new Set();
  const one = async (i) => {
    const c = await p.connect();
    try {
      await c.query('begin');
      const s = (await c.query(`select current_setting('app.session_id', true) s, pg_backend_pid() pid`)).rows[0];
      backends.add(s.pid);
      if (s.s) dirtyStarts++;
      const [tok, own] = i % 2 ? [T.uA, C.A] : [T.uB, C.B];
      await c.query("select set_config('app.session_id', $1, true)", [tok]);
      if (i % 7 === 0) {
        await c.query('select 1/0').catch(() => {});
        await c.query('rollback');
        aborted++;
        return;
      }
      const rows = (await c.query('select distinct centre_id from app.student')).rows;
      if (rows.some((r) => r.centre_id !== own) || rows.length !== 1) leaks++;
      await c.query('commit');
      ok++;
    } finally { c.release(); }
  };
  const queue = Array.from({ length: total }, (_, i) => i);
  await Promise.all(Array.from({ length: 16 }, async () => { while (queue.length) await one(queue.shift()); }));
  await p.end();
  evidence['T-RLS-009'] = { total, ok, aborted, leaks, dirtyStarts, distinctServerBackends: backends.size };
  assert.equal(ok + aborted, total);
  if (TARGET === 'local') assert.ok(backends.size <= 2, `expected <= 2 server connections, saw ${backends.size}`);
  else assert.ok(backends.size >= 2, 'pooler must actually reuse/rotate server connections');
  assert.equal(dirtyStarts, 0);
  assert.equal(leaks, 0);
});

test('T-RLS-010 query outside the transaction throws before reaching the DB', async () => {
  let leaked;
  await app.withScope(T.uA, async (tx) => { leaked = tx; });
  await assert.rejects(leaked.query('select 1'), ScopeError);
});

test('T-RLS-011 streamed export with tampered filters returns only in-scope rows and audits actual scope', async () => {
  const seen = [];
  const n = await exportRows(app.withScope, T.uA, {
    sql: 'select id, centre_id, name from app.student where centre_id = any ($1) order by id',
    params: [[C.A, C.B, C.O]], batch: 7, action: 'student.export', requested: { centreIds: [C.A, C.B, C.O] },
  }, (rows) => { seen.push(...rows); });
  assert.equal(n, 20);
  assert.deepEqual(centresSeen(seen), [C.A]);
  const audit = await asAdmin((db) => db.query(`select detail from app.audit_log where action = 'student.export' order by id desc limit 1`).then((r) => r.rows[0].detail));
  assert.deepEqual(audit, { requested: { centreIds: [1, 2, 3] }, scope: [1], rows: 20 });
});

test('T-RLS-012 job as gems_job limited to declared centre list; undeclared scope fails loudly', async () => {
  const jp = pool('gems_job', 2);
  const job = scoped(jp);
  try {
    const rows = await job(T.jobAB, (tx) => tx.query('select distinct centre_id from app.student').then((r) => r.rows));
    assert.deepEqual(centresSeen(rows), [C.A, C.B]);
    await assert.rejects(job(undefined, async () => {}), ScopeError);
  } finally { await jp.end(); }
});

test('T-RLS-013 raw SQL via the app client and via a direct gems_app connection is under RLS', async () => {
  const viaApp = await app.withScope(T.uA, (tx) => tx.query('select count(*)::int n from app.student'));
  assert.equal(viaApp.rows[0].n, 20);
  const db = await connected('gems_app'); // direct, not through PgBouncer (psql equivalent)
  try {
    assert.equal((await db.query('select count(*)::int n from app.student')).rows[0].n, 0);
    await db.query('begin');
    await db.query("select set_config('app.session_id', $1, true)", [T.uA]);
    assert.equal((await db.query('select count(*)::int n from app.student')).rows[0].n, 20);
    await db.query('rollback');
  } finally { await db.end(); }
});

test('T-RLS-014 region scope follows centre moves on the next transaction', async () => {
  const seen = () => app.withScope(T.hoR1, (tx) => tx.query('select distinct centre_id from app.student').then((r) => centresSeen(r.rows)));
  assert.deepEqual(await seen(), [C.A, C.A2]);
  await asAdmin((db) => db.query('update app.centre set region_id = 2 where id = $1', [C.A2]));
  try {
    assert.deepEqual(await seen(), [C.A]);
  } finally {
    await asAdmin((db) => db.query('update app.centre set region_id = 1 where id = $1', [C.A2]));
  }
});

test('T-RLS-015 no unexpected BYPASSRLS role; platform API roles cannot reach the app schema', async () => {
  const roles = await asAdmin((db) => db.query(`select rolname from pg_roles where (rolbypassrls or rolsuper) and rolname <> 'postgres' order by 1`).then((r) => r.rows.map((x) => x.rolname)));
  // Supabase platform roles are known and pinned here so a new bypass role fails the test (C-15)
  const allowed = TARGET === 'supabase' ? ['service_role', 'supabase_admin', 'supabase_etl_admin', 'supabase_read_only_user'] : [];
  assert.deepEqual(roles, allowed);
  if (TARGET === 'supabase') {
    const reach = await asAdmin((db) => db.query(`
      select r.rolname, has_schema_privilege(r.rolname, 'app', 'USAGE') usage,
             (select count(*)::int from information_schema.role_table_grants g where g.table_schema = 'app' and g.grantee = r.rolname) grants
      from pg_roles r where r.rolname in ('anon', 'authenticated') order by 1`).then((r) => r.rows));
    assert.deepEqual(reach, [{ rolname: 'anon', usage: false, grants: 0 }, { rolname: 'authenticated', usage: false, grants: 0 }]);
  }
});

test('T-RLS-016 gems_report_ro is under the same policies and cannot write (no replica in POC)', async () => {
  const rp = pool('gems_report_ro', 2);
  const ro = scoped(rp);
  try {
    const rows = await ro(T.uA, (tx) => tx.query('select centre_id from app.receipt union all select centre_id from app.student').then((r) => r.rows));
    assert.deepEqual(centresSeen(rows), [C.A]);
    await rejects42501(ro(T.uA, (tx) => tx.query(`update app.student set name = 'x'`)));
  } finally { await rp.end(); }
});

test('T-RLS-018 denied action consumes no number and writes only a denial audit row', async () => {
  const sB = await firstStudent(C.B);
  const snap = () => asAdmin(async (db) => ({
    series: (await db.query(`select current::int from app.number_series where centre_id = 2 and doc_type = 'FEEREC'`)).rows[0].current,
    receipts: (await db.query('select count(*)::int n from app.receipt')).rows[0].n,
    audits: (await db.query(`select outcome from app.audit_log where detail->>'idempotencyKey' = 'k-018'`)).rows.map((r) => r.outcome),
  }));
  const before = await snap();
  await assert.rejects(createReceipt(app.withScope, T.uA, {
    centreId: C.B, studentId: sB, docType: 'FEEREC', period: PERIOD, amountPaise: 50000, idempotencyKey: 'k-018',
  }), Forbidden);
  const afterS = await snap();
  assert.equal(afterS.series, before.series);
  assert.equal(afterS.receipts, before.receipts);
  assert.deepEqual(afterS.audits, ['DENIED']);
});

test('audit_log is append-only for app roles and the owner', async () => {
  await app.withScope(T.uA, (tx) => tx.query(`insert into app.audit_log (action, outcome) values ('probe', 'OK')`));
  await rejects42501(app.withScope(T.uA, (tx) => tx.query(`update app.audit_log set action = 'x'`)));
  await rejects42501(app.withScope(T.uA, (tx) => tx.query('select * from app.audit_log')));
  const owner = await connected('gems_owner');
  try {
    await assert.rejects(owner.query(`update app.audit_log set action = 'x'`), /append-only/);
    await assert.rejects(owner.query('delete from app.audit_log'), /append-only/);
    await assert.rejects(owner.query('truncate app.audit_log'), /append-only/);
  } finally { await owner.end(); }
});
