#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C
export LANG=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_MIGRATION="$ROOT/supabase/migrations/20260813033000_autohdr_source_worker_contract.sql"

if [[ -n "${POSTGRES_BIN:-}" ]]; then
  PG_BIN="$POSTGRES_BIN"
elif command -v initdb >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v initdb)")"
elif [[ -x /opt/homebrew/opt/postgresql@17/bin/initdb ]]; then
  PG_BIN=/opt/homebrew/opt/postgresql@17/bin
elif [[ -x /usr/local/opt/postgresql@17/bin/initdb ]]; then
  PG_BIN=/usr/local/opt/postgresql@17/bin
else
  echo "PostgreSQL 17 binaries are required (set POSTGRES_BIN)." >&2
  exit 1
fi

if ! "$PG_BIN/postgres" --version | /usr/bin/grep -Eq 'PostgreSQL\) 17\.'; then
  echo "PostgreSQL 17 is required; found: $("$PG_BIN/postgres" --version)" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixel-booking-autohdr-worker-pg-test.XXXXXX")"
SOCKET_DIR="/tmp/pbautohdr-worker-$$"
PORT="$((59000 + ($$ % 1000)))"
STARTED=0
cleanup() {
  if [[ "$STARTED" == 1 ]]; then
    "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$SOCKET_DIR"
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$SOCKET_DIR"
"$PG_BIN/initdb" -D "$TMP_DIR/data" -A trust -U postgres --no-locale >/dev/null
if ! "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -l "$TMP_DIR/postgres.log" \
  -o "-F -p $PORT -k $SOCKET_DIR -c listen_addresses=''" -w start >/dev/null; then
  sed -n '1,240p' "$TMP_DIR/postgres.log" >&2
  exit 1
fi
STARTED=1

PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" -f "$ROOT/tests/postgres/autohdr-source-upload-bootstrap.sql" >/dev/null
for migration in \
  20260811225000_canonical_media_releases.sql \
  20260813013349_autohdr_state_machine.sql \
  20260813015534_autohdr_canonical_source_upload.sql \
  20260813023000_autohdr_database_hardening.sql \
  20260813025818_autohdr_quarantine_source_ingestion.sql \
  20260813030000_autohdr_provider_recovery.sql; do
  "${PSQL[@]}" -f "$ROOT/supabase/migrations/$migration" >/dev/null
done

if [[ -f "$WORKER_MIGRATION" ]]; then
  printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\nrollback;\n' "$WORKER_MIGRATION" > "$TMP_DIR/rollback-proof.sql"
  "${PSQL[@]}" -f "$TMP_DIR/rollback-proof.sql" >/dev/null
  if [[ "$("${PSQL[@]}" -Atc "select to_regclass('public.autohdr_source_hash_reservations') is null")" != "t" ]]; then
    echo "Rollback proof left source worker schema residue." >&2
    exit 1
  fi
  "${PSQL[@]}" -f "$WORKER_MIGRATION" >/dev/null
else
  echo "AutoHDR source worker migration is intentionally absent for the TDD red run." >&2
fi

"${PSQL[@]}" -v commit_fixture=1 -f "$ROOT/tests/postgres/autohdr-source-worker.behavior.sql" >/dev/null

# Two concurrent sessions race the same one-file claim. Holding the candidate
# row lock in session A forces session B's SKIP LOCKED path to return no work.
"${PSQL[@]}" -c "begin; select ingest_job_id from public.autohdr_source_ingests where organization_id = '11111111-1111-4111-8111-111111111111' and request_id = '00000000-0000-4000-8000-000000000204' for update; select pg_sleep(2); commit;" >"$TMP_DIR/session-a.out" 2>"$TMP_DIR/session-a.err" &
SESSION_A=$!
for _ in $(seq 1 100); do
  if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where query like '%request_id = ''00000000-0000-4000-8000-000000000204'' for update%' and wait_event_type = 'Timeout'")" == "1" ]]; then
    break
  fi
  sleep 0.02
done
if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where query like '%request_id = ''00000000-0000-4000-8000-000000000204'' for update%' and wait_event_type = 'Timeout'")" != "1" ]]; then
  echo "Session A was not observed holding the source row lock." >&2
  wait "$SESSION_A" || true
  exit 1
fi
CLAIM_B="$("${PSQL[@]}" -qAtc "set role service_role; select count(*) from public.claim_autohdr_source_file('11111111-1111-4111-8111-111111111111','worker-concurrent-b',60)")"
wait "$SESSION_A"
if [[ "$CLAIM_B" != "0" ]]; then
  echo "Concurrent source claim did not skip the locked row: $CLAIM_B" >&2
  exit 1
fi
CLAIM_A="$("${PSQL[@]}" -qAtc "set role service_role; select count(*) from public.claim_autohdr_source_file('11111111-1111-4111-8111-111111111111','worker-concurrent-a',60)")"
if [[ "$CLAIM_A" != "1" ]]; then
  echo "Unlocked source was not claimed exactly once: $CLAIM_A" >&2
  exit 1
fi

echo "AutoHDR source worker PostgreSQL 17 behavior and two-session concurrency suites passed."
