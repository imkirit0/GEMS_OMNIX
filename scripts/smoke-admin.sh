#!/usr/bin/env bash
# End-to-end smoke of the first-admin journey against a running server (default http://localhost:3101).
# Needs an EMPTY local database (fresh migrations): it bootstraps the first admin itself.
# Prints only status lines; tokens, cookies and TOTP secrets are never echoed.
set -euo pipefail
B=${1:-http://localhost:3101}
PW="admin-chosen-password-1"
J=$(mktemp)
trap 'rm -f "$J"' EXIT

TOKEN=$(node scripts/bootstrap-admin.mjs admin "System Admin" "$B" | grep -oE 'token=[^ ]+' | cut -d= -f2)
step() { printf '%-58s %s\n' "$1" "$2"; }

step "1 set password via one-time link" "$(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' -H "Origin: $B" --data-urlencode "token=$(node -e 'console.log(decodeURIComponent(process.argv[1]))' -- "$TOKEN")" --data "password=$PW" "$B/auth/reset/confirm")"
step "2 sign in (admin requires TOTP)" "$(curl -s -c "$J" -o /dev/null -w '%{http_code} -> %{redirect_url}' -H "Origin: $B" --data "login=admin&password=$PW" "$B/auth/login")"
step "3 confirm password to start enrolment" "$(curl -s -b "$J" -c "$J" -o /dev/null -w '%{http_code} -> %{redirect_url}' -H "Origin: $B" --data "password=$PW" "$B/auth/enrol/start")"
SECRET=$(curl -s -b "$J" "$B/login/enrol" | grep -oE 'secret=[A-Z2-7]+' | head -1 | cut -d= -f2)
step "4 enrolment page shows a key" "$([ -n "$SECRET" ] && echo "yes (${#SECRET} chars)" || echo NO)"
CODE=$(node --input-type=module -e "import { generateTOTP } from '@oslojs/otp'; import { decodeBase32IgnorePadding } from '@oslojs/encoding'; console.log(generateTOTP(decodeBase32IgnorePadding(process.argv[1]), 30, 6))" -- "$SECRET")
CODES=$(curl -s -b "$J" -c "$J" -H "Origin: $B" --data "code=$CODE" "$B/auth/enrol/confirm" | grep -oE '<code>[0-9a-f]{10}</code>' | wc -l)
step "5 confirm code: recovery codes shown once" "$CODES codes"
step "6 home links to administration" "$(curl -s -b "$J" "$B/" | grep -c 'User and role administration') link(s)"
step "7 GET /admin/users" "$(curl -s -b "$J" -o /dev/null -w '%{http_code}' "$B/admin/users")"
step "8 create user (step-up fresh from sign-in)" "$(curl -s -b "$J" -o /dev/null -w '%{http_code} -> %{redirect_url}' -H "Origin: $B" --data "login=clerk1&displayName=Clerk One" "$B/admin/users/create" | sed -E 's#users/[0-9a-f-]+#users/<id>#')"
step "9 GET /admin/users lists the new user" "$(curl -s -b "$J" "$B/admin/users" | grep -c 'clerk1') match(es)"
step "10 GET /admin/users without a session" "$(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' "$B/admin/users")"
