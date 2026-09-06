#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${POSTGRES_BIN:-}" ]]; then
  PG_BIN="$POSTGRES_BIN"
elif [[ -x /opt/homebrew/opt/postgresql@17/bin/initdb ]]; then
  PG_BIN=/opt/homebrew/opt/postgresql@17/bin
else
  PG_BIN="$(dirname "$(command -v initdb)")"
fi
[[ "$("$PG_BIN/postgres" --version)" == *") 17."* ]] || { printf 'PostgreSQL 17 is required.\n' >&2; exit 1; }
TMP=$(mktemp -d /tmp/pbclean.XXXXXX)
STARTED=0
cleanup() {
  if [[ "$STARTED" == 1 ]]; then "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate -w stop >/dev/null; fi
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$TMP/socket" "$TMP/source/scripts"
"$PG_BIN/initdb" -D "$TMP/data" -A trust -U postgres --no-locale >/dev/null
"$PG_BIN/pg_ctl" -D "$TMP/data" -l "$TMP/server.log" -o "-F -k $TMP/socket -c listen_addresses=''" -w start >/dev/null
STARTED=1
PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$TMP/socket" -U postgres -d postgres)
# Generate the complete candidate in isolation; never rewrite the working tree.
cp -R "$ROOT/supabase" "$TMP/source/"
cp "$ROOT/scripts/generate-supabase-setup.sh" "$TMP/source/scripts/"
bash "$TMP/source/scripts/generate-supabase-setup.sh"
"${PSQL[@]}" -f "$ROOT/tests/postgres/supabase-platform.sql" >/dev/null
"${PSQL[@]}" --single-transaction -f "$TMP/source/supabase/setup.sql" >"$TMP/setup.log" 2>&1 || { cat "$TMP/setup.log"; exit 1; }
"${PSQL[@]}" -f "$ROOT/tests/postgres/clean-bootstrap.behavior.sql"
