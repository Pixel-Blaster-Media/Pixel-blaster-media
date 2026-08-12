#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${POSTGRES_BIN:-}" ]]; then
  PG_BIN="$POSTGRES_BIN"
elif command -v initdb >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v initdb)")"
elif [[ -x /opt/homebrew/opt/postgresql@17/bin/initdb ]]; then
  PG_BIN=/opt/homebrew/opt/postgresql@17/bin
else
  echo "PostgreSQL 17 binaries are required (set POSTGRES_BIN)." >&2
  exit 1
fi
if ! "$PG_BIN/postgres" --version | /usr/bin/grep -Eq 'PostgreSQL\) 17\.'; then
  echo "PostgreSQL 17 is required." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixel-booking-credentials-pg-test.XXXXXX")"
SOCKET_DIR="/tmp/pbcred-$$"
mkdir -p "$SOCKET_DIR"
PORT="$((61000 + (RANDOM % 4000)))"
STARTED=0
cleanup() {
  if [[ "$STARTED" == 1 ]]; then
    "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$SOCKET_DIR"
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

"$PG_BIN/initdb" -D "$TMP_DIR/data" -A trust -U postgres --no-locale >/dev/null
if ! "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" \
  -l "$TMP_DIR/postgres.log" \
  -o "-F -p $PORT -k $SOCKET_DIR -c listen_addresses=''" -w start >/dev/null; then
  cat "$TMP_DIR/postgres.log" >&2
  exit 1
fi
STARTED=1
PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" -f "$ROOT/tests/postgres/integration-credentials-bootstrap.sql" >/dev/null

printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\nrollback;\n' \
  "$ROOT/supabase/migrations/20260812180000_atomic_integration_credential_merge.sql" \
  > "$TMP_DIR/rollback.sql"
"${PSQL[@]}" -f "$TMP_DIR/rollback.sql" >/dev/null
if [[ "$("${PSQL[@]}" -Atc "select to_regprocedure('public.merge_integration_credentials(uuid,text,jsonb,uuid)') is null")" != "t" ]]; then
  echo "Rollback proof left function residue." >&2
  exit 1
fi

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260812180000_atomic_integration_credential_merge.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/tests/postgres/integration-credentials.behavior.sql" >/dev/null

# Two overlapping existing-row updates must visibly serialize and retain both values.
PGAPPNAME=credential-key-holder "${PSQL[@]}" -c "
  begin;
  select public.merge_integration_credentials(
    '11111111-1111-4111-8111-111111111111','autoenhance',
    '{\"api_key\":\"rotated-key\"}'::jsonb,null);
  select pg_sleep(2);
  commit;
" >"$TMP_DIR/key.log" 2>&1 &
KEY_PID=$!
sleep 0.1
PGAPPNAME=credential-toggle-contender "${PSQL[@]}" -c "
  select public.merge_integration_credentials(
    '11111111-1111-4111-8111-111111111111','autoenhance',
    '{\"enabled\":\"true\"}'::jsonb,null);
" >"$TMP_DIR/toggle.log" 2>&1 &
TOGGLE_PID=$!

LOCK_OBSERVED=0
for _ in {1..50}; do
  if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where application_name='credential-toggle-contender' and wait_event_type='Lock'")" == "1" ]]; then
    LOCK_OBSERVED=1
    break
  fi
  sleep 0.05
done
if [[ "$LOCK_OBSERVED" != 1 ]]; then
  echo "Existing-row contender was not observed waiting on a PostgreSQL lock." >&2
  exit 1
fi
wait "$KEY_PID"
wait "$TOGGLE_PID"

if [[ "$("${PSQL[@]}" -Atc "
  select credentials @> '{\"api_key\":\"rotated-key\",\"enabled\":\"true\",\"webhook_secret\":\"secret-a\"}'::jsonb
  from public.integration_credentials
  where organization_id='11111111-1111-4111-8111-111111111111'
    and provider='autoenhance'
")" != "t" ]]; then
  echo "Concurrent credential merges lost a field." >&2
  exit 1
fi

# Two first writes for an absent row must visibly serialize on the unique index.
PGAPPNAME=credential-insert-holder "${PSQL[@]}" -c "
  begin;
  select public.merge_integration_credentials(
    '22222222-2222-4222-8222-222222222222','autohdr',
    '{\"api_key\":\"new-key\"}'::jsonb,null);
  select pg_sleep(2);
  commit;
" >"$TMP_DIR/insert-holder.log" 2>&1 &
INSERT_PID=$!
sleep 0.1
PGAPPNAME=credential-insert-contender "${PSQL[@]}" -c "
  select public.merge_integration_credentials(
    '22222222-2222-4222-8222-222222222222','autohdr',
    '{\"enabled\":\"true\"}'::jsonb,null);
" >"$TMP_DIR/insert-contender.log" 2>&1 &
INSERT_CONTENDER_PID=$!

INSERT_LOCK_OBSERVED=0
for _ in {1..50}; do
  if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where application_name='credential-insert-contender' and wait_event_type='Lock'")" == "1" ]]; then
    INSERT_LOCK_OBSERVED=1
    break
  fi
  sleep 0.05
done
if [[ "$INSERT_LOCK_OBSERVED" != 1 ]]; then
  echo "Absent-row contender was not observed waiting on a PostgreSQL lock." >&2
  exit 1
fi
wait "$INSERT_PID"
wait "$INSERT_CONTENDER_PID"

if [[ "$("${PSQL[@]}" -Atc "
  select credentials @> '{\"api_key\":\"new-key\",\"enabled\":\"true\"}'::jsonb
  from public.integration_credentials
  where organization_id='22222222-2222-4222-8222-222222222222'
    and provider='autohdr'
")" != "t" ]]; then
  echo "Concurrent absent-row credential merges lost a field." >&2
  exit 1
fi

echo "Integration credential PostgreSQL behavior suite passed."
