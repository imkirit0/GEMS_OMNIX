// P3: T-NUM-001..010 (C-02.3), each run in both NP-3 modes. Expectations are parameterised by mode.
import { describe, test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createReceipt, cancelReceipt } from '../src/receipts.js';
import { allocate, financialYear, formatNumber } from '../src/numbering.js';
import { reset, asAdmin, connected, appScope, firstStudent, writeEvidence, C, T, PERIOD, POOLED } from './helpers.js';

const evidence = {};
after(() => writeEvidence('P3-numbering', evidence));

const sortNum = (xs) => xs.map(Number).sort((a, b) => a - b);
const range = (from, n) => Array.from({ length: n }, (_, i) => from + i);
const seriesCurrent = (centre, docType = 'FEEREC', period = PERIOD) => asAdmin((db) => db.query(
  'select current::int from app.number_series where centre_id = $1 and doc_type = $2 and period = $3', [centre, docType, period]).then((r) => r.rows[0]?.current));

// Gapless: exactly from..from+n-1. Unique-only: n distinct values.
function assertNumbers(mode, numbers, n, from = 1) {
  const s = sortNum(numbers);
  assert.equal(new Set(s).size, n, 'duplicates');
  if (mode === 'GAPLESS') assert.deepEqual(s, range(from, n));
}

for (const mode of ['GAPLESS', 'UNIQUE']) {
  describe(`NP-3 mode ${mode}`, () => {
    let app, sA, sB;
    const receipt = (i, extra = {}, hooks) => createReceipt(app.withScope, T.uA, {
      centreId: C.A, studentId: sA, docType: 'FEEREC', period: PERIOD, amountPaise: 10000, idempotencyKey: `${mode}-${i}`, ...extra,
    }, hooks);
    const committed = () => asAdmin((db) => db.query(`select number from app.receipt where centre_id = 1 and doc_type = 'FEEREC' and period = $1`, [PERIOD]).then((r) => r.rows.map((x) => Number(x.number))));

    before(() => { app = appScope(16); });
    after(() => app.pool.end());
    beforeEach(async () => { await reset({ gapRule: mode }); sA = await firstStudent(C.A); sB = await firstStudent(C.B); });

    test('T-NUM-001 200 concurrent allocations via PgBouncer', async () => {
      const t0 = Date.now();
      const out = await Promise.all(range(1, 200).map((i) => receipt(i)));
      evidence[`T-NUM-001/${mode}`] = { n: 200, ms: Date.now() - t0 };
      assertNumbers(mode, out.map((r) => r.number), 200);
      assert.equal(await seriesCurrent(C.A), 200);
    });

    test('T-NUM-002 every 5th business tx rolled back after allocation', async () => {
      const results = await Promise.allSettled(range(1, 50).map((i) => receipt(i, {}, {
        afterAllocate: () => { if (i % 5 === 0) throw new Error('business failure'); },
      })));
      assert.equal(results.filter((r) => r.status === 'rejected').length, 10);
      assertNumbers(mode, await committed(), 40);
      assert.equal(await seriesCurrent(C.A), 40);
    });

    test('T-NUM-003 lock timeout then retry: failed attempt leaves no trace', async () => {
      let release;
      const gate = new Promise((r) => { release = r; });
      let holderReady;
      const holding = new Promise((r) => { holderReady = r; });
      const holder = app.withScope(T.uA, async (tx) => {
        await allocate(tx, { centreId: C.A, docType: 'FEEREC', period: PERIOD });
        holderReady();
        await gate;
        throw new Error('holder aborts');
      }).catch((e) => e);
      await holding;
      const timed = app.withScope(T.uA, async (tx) => {
        await tx.query(`set local lock_timeout = '200ms'`);
        return allocate(tx, { centreId: C.A, docType: 'FEEREC', period: PERIOD });
      }).catch((e) => e);
      const err = await timed;
      assert.equal(err.code, '55P03', 'expected lock_not_available');
      release();
      await holder; // rolled back: its allocation is released
      const retry = await receipt('retry');
      assert.equal(Number(retry.number), 1, 'retry gets the next number; failed attempts left no trace');
      assertNumbers(mode, await committed(), 1);
      assert.equal(await seriesCurrent(C.A), 1);
    });

    test('T-NUM-004 idempotent retry returns the original number (sequential and concurrent)', async () => {
      const a = await receipt('same');
      const b = await receipt('same');
      assert.equal(b.id, a.id);
      const burst = await Promise.all(range(1, 10).map(() => receipt('burst')));
      assert.equal(new Set(burst.map((r) => r.id)).size, 1);
      assert.equal(await seriesCurrent(C.A), 2);
      assertNumbers(mode, await committed(), 2);
    });

    test('T-NUM-005 connection killed between allocation and commit', async () => {
      const db = await connected('gems_app', POOLED);
      db.on('error', () => {});
      await db.query('begin');
      await db.query("select set_config('app.session_id', $1, true)", [T.uA]);
      const n = await allocate(db, { centreId: C.A, docType: 'FEEREC', period: PERIOD });
      assert.equal(n, 1);
      const killed = await asAdmin((adm) => adm.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where usename = 'gems_app' and state = 'idle in transaction'`).then((r) => r.rowCount));
      assert.ok(killed >= 1);
      await db.end().catch(() => {});
      assert.equal(await seriesCurrent(C.A), 0);
      const next = await receipt('after-kill');
      if (mode === 'GAPLESS') assert.equal(Number(next.number), 1);
    });

    test('T-NUM-006 series isolation across centres and doc types in parallel', async () => {
      const jobs = [];
      for (const [centre, session, student] of [[C.A, T.uA, () => sA], [C.B, T.uB, () => sB]]) {
        for (const docType of ['FEEREC', 'INV']) {
          for (const i of range(1, 25)) {
            jobs.push(createReceipt(app.withScope, session, {
              centreId: centre, studentId: student(), docType, period: PERIOD, amountPaise: 1, idempotencyKey: `${centre}-${docType}-${i}`,
            }).then((r) => ({ key: `${centre}/${docType}`, n: r.number })));
          }
        }
      }
      const all = await Promise.all(jobs);
      for (const key of ['1/FEEREC', '1/INV', '2/FEEREC', '2/INV']) {
        assertNumbers(mode, all.filter((x) => x.key === key).map((x) => x.n), 25);
      }
    });

    test('T-NUM-007 FY boundary in Asia/Kolkata selects the new period at its configured start', async () => {
      const last = new Date('2027-03-31T18:29:59.999Z'); // 23:59:59.999 IST
      const first = new Date('2027-03-31T18:30:00.000Z'); // 00:00 IST 1 Apr
      assert.equal(financialYear(last), '2026-27');
      assert.equal(financialYear(first), '2027-28');
      await asAdmin((db) => db.query(`insert into app.number_series values (1, 'FEEREC', '2027-28', $1, 0)`, [mode]));
      await receipt('pre', { period: financialYear(last) });
      const r = await receipt('post', { period: financialYear(first) });
      assert.equal(Number(r.number), 1);
      assert.equal(await seriesCurrent(C.A, 'FEEREC', '2026-27'), 1);
      // a period with no configured series fails loudly instead of inventing one
      await assert.rejects(receipt('nope', { period: '2028-29' }), /no number series/);
    });

    test('T-NUM-008 cancelled number stays assigned and is never reissued', async () => {
      const r1 = await receipt(1);
      await cancelReceipt(app.withScope, T.uA, r1.id);
      const r2 = await receipt(2);
      assert.notEqual(Number(r2.number), Number(r1.number));
      const status = await asAdmin((db) => db.query('select status from app.receipt where id = $1', [r1.id]).then((r) => r.rows[0].status));
      assert.equal(status, 'CANCELLED');
      await assert.rejects(app.withScope(T.uA, (tx) => tx.query(
        `insert into app.receipt (centre_id, student_id, doc_type, period, number, amount_paise, idempotency_key) values (1, $1, 'FEEREC', $2, $3, 1, 'reuse')`,
        [sA, PERIOD, r1.number])), (e) => e.code === '23505');
    });

    test('T-NUM-009 format and length are parameters of NP-5 (unapproved)', () => {
      const legacy = { centreCode: 'KL2-25', docType: 'FEEREC', period: '2026-27', number: 123 };
      assert.equal(formatNumber(legacy), 'KL2-25/FEEREC/2026-27/000123');
      assert.equal(formatNumber({ ...legacy, maxLength: 28 }).length, 28);
      // if NP-5 sets a shorter limit (e.g. a statutory one, to be confirmed by the tax advisor) this format is rejected, not truncated
      assert.throws(() => formatNumber({ ...legacy, maxLength: 16 }), RangeError);
    });

    test('T-NUM-010 migrated counter continues from legacy current + 1', async () => {
      await asAdmin(async (db) => {
        await db.query(`update app.number_series set current = 43887 where centre_id = 1 and doc_type = 'FEEREC'`);
        await db.query(`insert into app.receipt (centre_id, student_id, doc_type, period, number, amount_paise, idempotency_key)
          select 1, $1, 'FEEREC', $2, g, 1, 'legacy-' || g from generate_series(43880, 43887) g`, [sA, PERIOD]);
      });
      const r = await receipt('first-new');
      assert.equal(Number(r.number), 43888);
    });
  });
}
