#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$(find "$ROOT/supabase/migrations" -maxdepth 1 -type f -name '*_autohdr_quarantine_source_ingestion.sql' | sort | tail -n 1)"

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

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixel-booking-autohdr-quarantine-pg-test.XXXXXX")"
SOCKET_DIR="/tmp/pbautohdr-quarantine-$$"
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
if ! "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" \
  -l "$TMP_DIR/postgres.log" \
  -o "-F -p $PORT -k $SOCKET_DIR -c listen_addresses=''" -w start >/dev/null; then
  sed -n '1,240p' "$TMP_DIR/postgres.log" >&2
  exit 1
fi
STARTED=1

PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" -f "$ROOT/tests/postgres/autohdr-source-upload-bootstrap.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260811225000_canonical_media_releases.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260813013349_autohdr_state_machine.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260813015534_autohdr_canonical_source_upload.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260813023000_autohdr_database_hardening.sql" >/dev/null

CANONICAL_ACCEPTED_CHECK="$("${PSQL[@]}" -Atc "
  select pg_get_constraintdef(oid, false)
  from pg_constraint
  where conrelid = 'public.media_versions'::regclass
    and conname = 'media_versions_accepted_check'
")"

if [[ -n "$MIGRATION" ]]; then
  printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\nrollback;\n' "$MIGRATION" > "$TMP_DIR/rollback.sql"
  "${PSQL[@]}" -f "$TMP_DIR/rollback.sql" >/dev/null
  if [[ "$("${PSQL[@]}" -Atc "
    select to_regclass('public.autohdr_source_ingests') is null
      and to_regprocedure('public.prepare_autohdr_source_batch(uuid,uuid,uuid,uuid,jsonb)') is null
  ")" != "t" ]]; then
    echo "Rollback proof left AutoHDR quarantine schema residue." >&2
    exit 1
  fi
  "${PSQL[@]}" -f "$MIGRATION" >/dev/null
else
  echo "AutoHDR quarantine source-ingestion migration is intentionally absent for the TDD red run." >&2
fi

if [[ "$("${PSQL[@]}" -Atc "
  select pg_get_constraintdef(oid, false)
  from pg_constraint
  where conrelid = 'public.media_versions'::regclass
    and conname = 'media_versions_accepted_check'
")" != "$CANONICAL_ACCEPTED_CHECK" ]]; then
  echo "AutoHDR quarantine migration changed the canonical accepted-media constraint." >&2
  exit 1
fi

"${PSQL[@]}" -v commit_fixture=1 -f "$ROOT/tests/postgres/autohdr-quarantine-ingestion.behavior.sql" >/dev/null

CONCURRENT_ROW="$("${PSQL[@]}" -AtF '|' -c "
  select organization_id, booking_id, batch_id, asset_id, version_id, ingest_job_id,
         quarantine_bucket_name, quarantine_object_key, quarantine_etag,
         master_bucket_name, master_object_key, encode(expected_sha256, 'hex'),
         expected_byte_size, expected_mime_type
  from public.autohdr_source_ingests
  where request_id='00000000-0000-4000-8000-000000000030'
")"
IFS='|' read -r ORG BOOKING BATCH ASSET VERSION INGEST Q_BUCKET Q_KEY Q_ETAG M_BUCKET M_KEY SHA BYTES MIME <<< "$CONCURRENT_ROW"

accept_sql() {
  local app_name="$1"
  local dimensions="$2"
  PGAPPNAME="$app_name" "${PSQL[@]}" -qAt -c "
    set role service_role;
    select jsonb_agg(to_jsonb(result))
    from public.accept_autohdr_quarantined_source_version(
      '$ORG', '$BOOKING', '$BATCH', '$ASSET', '$VERSION', '$INGEST',
      '$Q_BUCKET', '$Q_KEY', '$Q_ETAG', '$M_BUCKET', '$M_KEY',
      decode('$SHA', 'hex'), $BYTES, '$MIME', $dimensions
    ) result;
  "
}

PGAPPNAME=autohdr-accept-winner "${PSQL[@]}" -qAt -c "
  set role service_role;
  begin;
  select jsonb_agg(to_jsonb(result))
  from public.accept_autohdr_quarantined_source_version(
    '$ORG', '$BOOKING', '$BATCH', '$ASSET', '$VERSION', '$INGEST',
    '$Q_BUCKET', '$Q_KEY', '$Q_ETAG', '$M_BUCKET', '$M_KEY',
    decode('$SHA', 'hex'), $BYTES, '$MIME', 3200, 2400
  ) result;
  select pg_sleep(2);
  commit;
" >"$TMP_DIR/accept-winner.log" 2>&1 &
WINNER_PID=$!
sleep 0.1

accept_sql autohdr-accept-contender "3200, 2400" >"$TMP_DIR/accept-contender.log" 2>&1 &
CONTENDER_PID=$!

LOCK_OBSERVED=0
for _ in {1..50}; do
  if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where application_name='autohdr-accept-contender' and wait_event_type='Lock'")" == "1" ]]; then
    LOCK_OBSERVED=1
    break
  fi
  sleep 0.05
done
if [[ "$LOCK_OBSERVED" != 1 ]]; then
  echo "Concurrent source acceptance was not observed waiting on a PostgreSQL lock." >&2
  exit 1
fi

wait "$WINNER_PID"
wait "$CONTENDER_PID"
WINNER_RESULT="$(/usr/bin/grep '^\[' "$TMP_DIR/accept-winner.log" | tail -n 1)"
CONTENDER_RESULT="$(/usr/bin/grep '^\[' "$TMP_DIR/accept-contender.log" | tail -n 1)"
if [[ -z "$WINNER_RESULT" || "$WINNER_RESULT" != "$CONTENDER_RESULT" ]]; then
  echo "Concurrent source acceptance did not converge on one result." >&2
  exit 1
fi

if accept_sql autohdr-accept-drift "3201, 2400" >"$TMP_DIR/accept-drift.log" 2>&1; then
  echo "Accepted source replay allowed evidence drift." >&2
  exit 1
fi

echo "AutoHDR quarantine-first source-ingestion PostgreSQL 17 behavior suite passed."
