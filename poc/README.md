# POC (11): throwaway proof code, not production

```
docker compose up -d --wait   # Postgres 17 + PgBouncer (transaction mode) on 127.0.0.1:55432 / 56432
npm test                      # P2 (T-RLS-*), P3 (T-NUM-* in both NP-3 modes), T-RLS-017 perf
docker compose down -v        # wipe
```
Results and metrics land in `evidence/`; each run is logged in `../docs/audit/12-evidence-and-verification-log.md`.
Credentials in `docker-compose.yml` / `sql/` / `pgbouncer/` are local throwaway values.
