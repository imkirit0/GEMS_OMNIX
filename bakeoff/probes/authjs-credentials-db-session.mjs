// ADR-001 candidate C probe (DR-14). Usage: node authjs-credentials-db-session.mjs <path-to node_modules/@auth/core@0.41.3>
// Signs in via Credentials with session.strategy "database" and a recording adapter.
import { pathToFileURL } from 'node:url';
const core = await import(pathToFileURL(process.argv[2] + '/index.js').href);
const Credentials = (await import(pathToFileURL(process.argv[2] + '/providers/credentials.js').href)).default;
const calls = []; const errors = [];
const adapter = new Proxy({}, { get: (_, name) => typeof name === 'string' && name !== 'then'
  ? async (...a) => { calls.push(name); return name === 'getUser' ? { id: 'u1', email: 'u@x', emailVerified: null } : name === 'createSession' ? { ...a[0] } : null; } : undefined });
const config = {
  providers: [Credentials({ credentials: { username: {}, password: {} }, authorize: async () => ({ id: 'u1', name: 'User', email: 'u@x' }) })],
  adapter, session: { strategy: 'database' }, secret: 'x'.repeat(40), trustHost: true, basePath: '/auth',
  logger: { error: (e) => errors.push(String(e?.name ?? '') + ': ' + String(e?.message ?? e).split('\n')[0]), warn: (w) => errors.push('warn: ' + w), debug() {} },
};
const base = 'http://localhost:3000/auth';
const csrfRes = await core.Auth(new Request(base + '/csrf'), config);
const { csrfToken } = await csrfRes.json();
const cookie = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const res = await core.Auth(new Request(base + '/callback/credentials', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ csrfToken, username: 'u', password: 'p' }) }), config);
const setCookies = res.headers.getSetCookie().map((c) => c.split('=')[0]);
console.log(JSON.stringify({ authCoreVersion: '0.41.3', status: res.status, location: res.headers.get('location'), setCookies, adapterCalls: calls, errors }, null, 1));
