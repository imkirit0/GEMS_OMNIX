// FX-BASE (09) for P2/P3. Synthetic data only.
import pg from 'pg';
import fs from 'node:fs';
import { scoped } from '../src/db.js';

// POC_TARGET=local (Docker: Postgres + PgBouncer) or supabase (session pooler 5432 as "direct", Supavisor 6543 as pooled).
export const TARGET = process.env.POC_TARGET ?? 'local';

const readEnv = (file) => Object.fromEntries(fs.readFileSync(new URL(file, import.meta.url), 'utf8').split(/\r?\n/)
  .filter((l) => /^\w+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));

let DIRECT, POOLED, PW, login = (user) => user;
if (TARGET === 'supabase') {
  const admin = new URL(readEnv('../../.env').DIRECT_URL);
  const ref = decodeURIComponent(admin.username).split('.')[1];
  const ssl = { ca: fs.readFileSync(new URL('../../certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8') };
  DIRECT = { host: admin.hostname, port: 5432, database: 'postgres', ssl };
  POOLED = { host: admin.hostname, port: 6543, database: 'postgres', ssl };
  PW = { ...readEnv('../.env.supabase'), postgres: decodeURIComponent(admin.password) };
  login = (user) => `${user}.${ref}`;
} else {
  const host = '127.0.0.1';
  DIRECT = { host, port: 55432, database: 'gems' };
  POOLED = { host, port: 56432, database: 'gems' };
  PW = { gems_app: 'app_pw', gems_job: 'job_pw', gems_report_ro: 'ro_pw', gems_owner: 'owner_pw', postgres: 'postgres_pw' };
}
export { DIRECT, POOLED };

export const client = (user, via = DIRECT) => new pg.Client({ ...via, user: login(user), password: PW[user] });
export const pool = (user = 'gems_app', max = 10) => new pg.Pool({ ...POOLED, user: login(user), password: PW[user], max });

export async function asAdmin(fn) {
  const c = client('postgres');
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

export async function connected(user, via = DIRECT) {
  const c = client(user, via);
  await c.connect();
  return c;
}

// Centres: A=1 (R1), B=2 (R2), O=3 (R2, overseas), A2=4 (R1)
export const C = { A: 1, B: 2, O: 3, A2: 4 };
export const T = {
  uA: 'tok-uA', uB: 'tok-uB', hoR1: 'tok-hoR1', hoAll: 'tok-hoAll',
  jobAB: 'tok-jobAB', expired: 'tok-expired', revoked: 'tok-revoked',
};
export const PERIOD = '2026-27';

export async function reset({ gapRule = 'GAPLESS', studentsPerCentre = 20 } = {}) {
  await asAdmin(async (db) => {
    await db.query(`set session_replication_role = replica`); // lets the superuser truncate the append-only audit table
    await db.query(`truncate app.receipt, app.number_series, app.student, app.centre_daily_total, app.audit_log,
      app.app_session, app.user_scope, app.app_user, app.centre, app.region restart identity cascade`);
    await db.query(`set session_replication_role = origin`);
    await db.query(`insert into app.region values (1, 'R1'), (2, 'R2')`);
    await db.query(`insert into app.centre values (1, 'KL2-25', 1), (2, 'TN1-03', 2), (3, 'AE1-01', 2), (4, 'KL3-07', 1)`);
    await db.query(`insert into app.app_user values (1,'uA'),(2,'uB'),(3,'hoR1'),(4,'hoAll'),(5,'jobAB'),(6,'expired'),(7,'revoked')`);
    await db.query(`insert into app.user_scope (user_id, kind, region_id, scope_centre_id) values
      (1,'CENTRE',null,1),(2,'CENTRE',null,2),(3,'REGION',1,null),(4,'ALL',null,null),
      (5,'CENTRE',null,1),(5,'CENTRE',null,2),(6,'CENTRE',null,2),(7,'CENTRE',null,2)`);
    await db.query(`insert into app.app_session (token_hash, user_id, expires_at, revoked_at)
      select sha256(convert_to(t, 'UTF8')), u, now() + e::interval, r
      from (values ('tok-uA',1,'8 hours',null::timestamptz), ('tok-uB',2,'8 hours',null), ('tok-hoR1',3,'8 hours',null),
                   ('tok-hoAll',4,'8 hours',null), ('tok-jobAB',5,'8 hours',null), ('tok-expired',6,'-1 minute',null),
                   ('tok-revoked',7,'8 hours',now())) v(t,u,e,r)`);
    await db.query(`insert into app.student (centre_id, name)
      select c, 'Student ' || c || '-' || g from unnest(array[1,2,3,4]) c, generate_series(1, $1) g`, [studentsPerCentre]);
    await db.query(`insert into app.number_series (centre_id, doc_type, period, gap_rule, current)
      select c, d, $1, $2, 0 from unnest(array[1,2,3,4]) c, unnest(array['FEEREC','INV']) d`, [PERIOD, gapRule]);
    await db.query(`insert into app.centre_daily_total values (1, '2026-10-01', 100000), (2, '2026-10-01', 200000)`);
    await db.query(`refresh materialized view app.centre_total_mv`);
  });
}

export const firstStudent = (centreId) =>
  asAdmin((db) => db.query('select min(id)::int id from app.student where centre_id = $1', [centreId]).then((r) => r.rows[0].id));

export function appScope(max = 10) {
  const p = pool('gems_app', max);
  return { pool: p, withScope: scoped(p) };
}

// Evidence file per proof per day (11: poc/evidence/<proof>-<date>.json)
export function writeEvidence(proof, data) {
  const day = new Date().toISOString().slice(0, 10);
  const file = new URL(`../evidence/${proof}-${TARGET}-${day}.json`, import.meta.url);
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  fs.writeFileSync(file, JSON.stringify({ ...prev, ...data, updatedAt: new Date().toISOString() }, null, 2));
}
