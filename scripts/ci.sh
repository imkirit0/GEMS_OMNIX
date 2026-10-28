#!/usr/bin/env bash
# The single definition of "the build is green". GitHub Actions runs exactly this; run it locally the same way:
#   bash scripts/ci.sh
# WARNING: it recreates the local Docker database (docker compose down -v) so every run starts from empty migrations.
# Environment: the variables below must be set (locally they come from .env.local; in CI from the workflow).
# The migration framework adds ETL_DATABASE_URL (gems_etl, direct to the database), ETL_DB_PASSWORD and ETL_SALT;
# local values: see .github/workflows/ci.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi
for v in MIGRATE_URL ADMIN_DATABASE_URL APP_DATABASE_URL AUTH_DATABASE_URL AUTH_ENC_KEY STORAGE_DRIVER ETL_DATABASE_URL ETL_DB_PASSWORD ETL_SALT; do
  [ -n "${!v:-}" ] || { echo "missing environment variable $v" >&2; exit 1; }
done
PY=$(command -v python3 || command -v python)
rm -rf .next # stale generated route types from an earlier build must not mask or cause typecheck results
step() { printf '\n== %s\n' "$1"; }

step "T-DOC-001: requirements matrix consistency"
"$PY" -I docs/audit/tools/build_matrix.py docs/audit | tail -1
git diff --exit-code -- docs/audit/02-requirements-traceability-matrix.csv \
  || { echo "02 CSV is stale: run python -I docs/audit/tools/build_matrix.py docs/audit and commit" >&2; exit 1; }

step "FRD is generated from the matrix and committed in sync"
"$PY" -I docs/requirements/tools/build_frd.py .
git diff --exit-code -- docs/requirements/FRD-GEMS-OMNIX.md \
  || { echo "FRD is stale: run python -I docs/requirements/tools/build_frd.py . and commit" >&2; exit 1; }

step "Prisma client"
npx prisma generate >/dev/null
echo "generated"

step "Fresh database"
docker compose down -v >/dev/null 2>&1 || true
docker compose up -d --wait
npx prisma migrate deploy
node scripts/etl/setup.mjs # the CI database is a migration environment

step "Schema drift: Prisma schema must equal the migrated database"
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code --script \
  || { echo "schema drift: add a migration for the change above" >&2; exit 1; }
echo "no drift"

step "No unsafe raw SQL (T-RLS-013)"
if grep -rnE "(query|execute)RawUnsafe" src app; then echo "unsafe raw SQL is banned" >&2; exit 1; fi
echo "none"

step "Typecheck"
# no "cmd && echo" here: under set -e a failing command on the left of && would NOT stop the script
npx tsc --noEmit
echo "0 errors"

step "Tests"
npx vitest run

step "Production build"
npx next build

step "No secrets in the client bundle (T-SEC-017)"
node scripts/scan-client-bundle.mjs

step "Real server: first-admin journey and security checks on a fresh database"
docker compose down -v >/dev/null 2>&1 || true
docker compose up -d --wait
npx prisma migrate deploy >/dev/null
node scripts/etl/setup.mjs >/dev/null
node node_modules/next/dist/bin/next start -p 3101 > .next/ci-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -s -o /dev/null http://localhost:3101/login && break; sleep 1; done
bash scripts/smoke-admin.sh http://localhost:3101
node scripts/smoke-security.mjs http://localhost:3101
