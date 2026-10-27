// T-SEC-017: nothing secret may reach the browser. Scans the built client assets (.next/static) for
// the values of server-side secrets in the environment and for secret-shaped patterns.
// Usage: node scripts/scan-client-bundle.mjs   (after `next build`; env as for the app)
import fs from "node:fs";
import path from "node:path";

const SECRET_ENV = ["MIGRATE_URL", "ADMIN_DATABASE_URL", "APP_DATABASE_URL", "JOB_DATABASE_URL", "AUTH_DATABASE_URL", "AUTH_ENC_KEY", "DATABASE_URL", "DIRECT_URL"];
const needles = new Set();
for (const name of SECRET_ENV) {
  const v = process.env[name];
  if (!v) continue;
  needles.add(v);
  try { const u = new URL(v); if (u.password) needles.add(decodeURIComponent(u.password)); } catch { /* not a URL */ }
}
const patterns = [/postgres(ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk_live_[0-9a-zA-Z]{10,}/, /\bAUTH_ENC_KEY\b/];

const root = ".next/static";
if (!fs.existsSync(root)) { console.error(`${root} not found: run next build first`); process.exit(2); }
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } };
walk(root);

const hits = [];
for (const f of files) {
  if (!/\.(js|mjs|css|html|json|map|txt)$/.test(f)) continue;
  const text = fs.readFileSync(f, "utf8");
  for (const n of needles) if (n.length >= 8 && text.includes(n)) hits.push(`${f}: contains the value of a server secret`);
  for (const re of patterns) if (re.test(text)) hits.push(`${f}: matches ${re}`);
}
console.log(`scanned ${files.length} client files against ${needles.size} secret values and ${patterns.length} patterns`);
if (hits.length) { for (const h of hits) console.error(h); process.exit(1); }
console.log("no secrets found");
