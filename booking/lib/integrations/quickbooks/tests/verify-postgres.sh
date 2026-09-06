#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
TESTS="$ROOT/lib/integrations/quickbooks/tests"
PG_BIN="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
[[ "$($PG_BIN/postgres --version)" == *") 17."* ]] || { printf 'PostgreSQL 17 required\n'; exit 1; }
TMP=$(mktemp -d)
SOCKET="/tmp/pbinvoice-$$"
STARTED=0
cleanup() {
 if [[ "$STARTED" == 1 ]]; then "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate -w stop >/dev/null; fi
 rm -rf "$TMP" "$SOCKET"
}
trap cleanup EXIT
mkdir -p "$SOCKET"
"$PG_BIN/initdb" -D "$TMP/data" -A trust -U postgres --no-locale >/dev/null
"$PG_BIN/pg_ctl" -D "$TMP/data" -l "$TMP/log" -o "-F -k $SOCKET -c listen_addresses=''" -w start >/dev/null
STARTED=1
PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKET" -U postgres -d postgres)
"${PSQL[@]}" -f "$TESTS/bootstrap.sql"
MIGRATION="$ROOT/supabase/migrations/20260905100600_quickbooks_invoice_intents.sql"
if [[ -f "$MIGRATION" ]]; then "${PSQL[@]}" -1 -f "$MIGRATION"; fi
"${PSQL[@]}" -f "$TESTS/intent.behavior.sql"
"${PSQL[@]}" -f "$TESTS/adoption.behavior.sql"
python3 "$TESTS/rolling.behavior.py" "${PSQL[@]}"
printf 'QuickBooks PostgreSQL behavior passed\n'
