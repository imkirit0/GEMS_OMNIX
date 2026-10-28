// Manual check (person-core design item 4, K7): the match-key name rule on Supabase, whose lc_ctype may differ
// from local Docker. Read-only: evaluates the expression on literals; creates and writes nothing.
// Usage: node --env-file=.env scripts/manual-supabase-matchkey.mjs   (DIRECT_URL; never printed)
import pg from "pg";
const db = new pg.Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const name = (g, f) => db.query(`select array_to_string(array(select w from regexp_split_to_table(lower(coalesce($1::text, '') || ' ' || coalesce($2::text, '')),
  '[^[:alpha:]\u0300-\u036f\u0900-\u0dff]+') w where w <> '' order by w), ' ') n`, [g, f]).then((r) => r.rows[0].n);
const [ctype] = (await db.query(`select datctype, version() v from pg_database where datname = current_database()`)).rows;
const out = {
  lc_ctype: ctype.datctype, server: ctype.v.split(" on ")[0],
  malayalam: await name("അനുപമ", "കൃഷ്ണൻ"), malayalamSwapped: await name("കൃഷ്ണൻ", "അനുപമ"),
  latin: await name("Raj", "Kumar"), latinSwapped: await name("kumar", "RAJ"), single: await name("Anjali", null),
};
out.sameMalayalam = out.malayalam === out.malayalamSwapped;
out.malayalamWords = out.malayalam.split(" ").length;
console.log(JSON.stringify(out, null, 1));
await db.end();
