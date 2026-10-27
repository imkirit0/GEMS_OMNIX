// Provision / tear down the POC on Supabase. Passwords are random, written to .env.supabase (gitignored), never printed.
// Usage: node supabase.mjs setup | teardown
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

function scram(password) {
  const salt = crypto.randomBytes(16);
  const salted = crypto.pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const hmac = (key) => crypto.createHmac('sha256', salted).update(key).digest();
  const stored = crypto.createHash('sha256').update(hmac('Client Key')).digest();
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored.toString('base64')}:${hmac('Server Key').toString('base64')}`;
}

const ROLES = ['gems_owner', 'gems_app', 'gems_job', 'gems_report_ro'];
const env = Object.fromEntries(fs.readFileSync('../.env', 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const u = new URL(env.DIRECT_URL);
const db = new pg.Client({ host: u.hostname, port: 5432, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: 'postgres', ssl: { ca: fs.readFileSync('../certs/supabase-prod-ca-2021.crt', 'utf8') } });
await db.connect();
try {
  if (process.argv[2] === 'setup') {
    const pw = Object.fromEntries(ROLES.map((r) => [r, crypto.randomBytes(24).toString('base64url')]));
    fs.writeFileSync('.env.supabase', ROLES.map((r) => `${r}=${pw[r]}`).join('\n') + '\n', { mode: 0o600 });
    for (const r of ROLES) {
      // only the SCRAM verifier is sent, so no plaintext password can land in server logs
      await db.query(`create role ${r} login password '${scram(pw[r])}' nosuperuser nocreatedb nocreaterole nobypassrls${r === 'gems_owner' ? '' : ' noinherit'}`);
      // admin needs membership: SET ROLE gems_owner for DDL, signalling app backends (T-NUM-005)
      await db.query(`grant ${r} to postgres with inherit true, set true`);
    }
    await db.query('create schema app authorization gems_owner');
    await db.query('grant usage on schema app to gems_app, gems_job, gems_report_ro');
    await db.query('revoke all on schema app from public, anon, authenticated, service_role');
    await db.query(fs.readFileSync('sql/02-schema.sql', 'utf8'));
    await db.query('reset role');
    console.log('setup ok');
  } else if (process.argv[2] === 'teardown') {
    await db.query('drop schema if exists app cascade');
    for (const r of ROLES) await db.query(`drop role if exists ${r}`);
    fs.rmSync('.env.supabase', { force: true });
    console.log('teardown ok');
  } else throw new Error('usage: setup | teardown');
} finally { await db.end(); }
