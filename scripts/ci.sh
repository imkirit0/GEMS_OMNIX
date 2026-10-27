#!/usr/bin/env bash
# The single definition of "the build is green". GitHub Actions runs exactly this; run it locally the same way:
#   bash scripts/ci.sh
# WARNING: it recreates the local Docker database (docker compose down -v) so every run starts from empty migrations.
# Environment: the variables below must be set (locally they come from .env.local; in CI from the workflow).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi
for v in MIGRATE_URL ADMIN_DATABASE_URL APP_DATABASE_URL AUTH_DATABASE_URL AUTH_ENC_KEY; do
  [ -n "${!v:-}" ] || { echo "missing environment variable $v" >&2; exit 1; }
done
PY=$(command -v python3 || command -v python)
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
npx prisma generate >/dev/null && echo "generated"

step "Fresh database"
docker compose down -v >/dev/null 2>&1 || true
docker compose up -d --wait
npx prisma migrate deploy

step "Schema drift: Prisma schema must equal the migrated database"
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code --script \
  || { echo "schema drift: add a migration for the change above" >&2; exit 1; }
echo "no drift"

step "No unsafe raw SQL (T-RLS-013)"
if grep -rnE "(query|execute)RawUnsafe" src app; then echo "unsafe raw SQL is banned" >&2; exit 1; fi
echo "none"

step "Typecheck"
npx tsc --noEmit && echo "0 errors"

step "Tests"
npx vitest run

step "Production build"
npx next build
