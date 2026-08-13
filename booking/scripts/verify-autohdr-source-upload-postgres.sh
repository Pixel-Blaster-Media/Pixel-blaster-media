#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$(find "$ROOT/supabase/migrations" -maxdepth 1 -type f -name '*_autohdr_canonical_source_upload.sql' | sort | tail -n 1)"

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

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixel-booking-autohdr-source-pg-test.XXXXXX")"
SOCKET_DIR="/tmp/pbautohdr-source-$$"
PORT="$((58000 + ($$ % 1000)))"
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
CANONICAL_ACCEPTED_CHECK="$("${PSQL[@]}" -Atc "
  select pg_get_constraintdef(oid, false)
  from pg_constraint
  where conrelid = 'public.media_versions'::regclass
    and conname = 'media_versions_accepted_check'
")"

if [[ -n "$MIGRATION" ]]; then
  printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\nrollback;\n' "$MIGRATION" > "$TMP_DIR/rollback.sql"
  "${PSQL[@]}" -f "$TMP_DIR/rollback.sql" >/dev/null
  if [[ "$("${PSQL[@]}" -Atc "select to_regprocedure('public.create_autohdr_source_batch(uuid,uuid,uuid,uuid,jsonb)') is null")" != "t" ]]; then
    echo "Rollback proof left AutoHDR source-upload schema residue." >&2
    exit 1
  fi
  "${PSQL[@]}" -f "$MIGRATION" >/dev/null
else
  echo "AutoHDR canonical source-upload migration is intentionally absent for the TDD red run." >&2
fi

if [[ "$("${PSQL[@]}" -Atc "
  select pg_get_constraintdef(oid, false)
  from pg_constraint
  where conrelid = 'public.media_versions'::regclass
    and conname = 'media_versions_accepted_check'
")" != "$CANONICAL_ACCEPTED_CHECK" ]]; then
  echo "AutoHDR source migration changed the canonical accepted-media constraint." >&2
  exit 1
fi

"${PSQL[@]}" -f "$ROOT/tests/postgres/autohdr-source-upload.behavior.sql" >/dev/null

# Commit the fixture, then prove two independent sessions serialize one request
# UUID, return the same canonical identities, and identify only the winner as new.
"${PSQL[@]}" -v commit_fixture=1 -f "$ROOT/tests/postgres/autohdr-source-upload.behavior.sql" >/dev/null
CONCURRENT_FILES='[{"filename":"Concurrent.jpg","byte_size":1024,"mime_type":"image/jpeg","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}]'

PGAPPNAME=autohdr-source-winner "${PSQL[@]}" -qAt -c "
  set role service_role;
  begin;
  select jsonb_agg(to_jsonb(result) order by result.position)
  from public.create_autohdr_source_batch(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '00000000-0000-4000-8000-000000000020',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '$CONCURRENT_FILES'::jsonb
  ) result;
  select pg_sleep(2);
  commit;
" >"$TMP_DIR/winner.log" 2>&1 &
WINNER_PID=$!
sleep 0.1

PGAPPNAME=autohdr-source-contender "${PSQL[@]}" -qAt -c "
  set role service_role;
  select jsonb_agg(to_jsonb(result) order by result.position)
  from public.create_autohdr_source_batch(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '00000000-0000-4000-8000-000000000020',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '$CONCURRENT_FILES'::jsonb
  ) result;
" >"$TMP_DIR/contender.log" 2>&1 &
CONTENDER_PID=$!

LOCK_OBSERVED=0
for _ in {1..50}; do
  if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where application_name='autohdr-source-contender' and wait_event_type='Lock'")" == "1" ]]; then
    LOCK_OBSERVED=1
    break
  fi
  sleep 0.05
done
if [[ "$LOCK_OBSERVED" != 1 ]]; then
  echo "Concurrent source replay was not observed waiting on a PostgreSQL lock." >&2
  exit 1
fi

wait "$WINNER_PID"
wait "$CONTENDER_PID"
WINNER_RESULT="$(/usr/bin/grep '^\[' "$TMP_DIR/winner.log" | tail -n 1)"
CONTENDER_RESULT="$(/usr/bin/grep '^\[' "$TMP_DIR/contender.log" | tail -n 1)"
WINNER_IDENTITIES="$(printf '%s' "$WINNER_RESULT" | /usr/bin/sed -E 's/"newly_created": true/"newly_created": MARKER/g')"
CONTENDER_IDENTITIES="$(printf '%s' "$CONTENDER_RESULT" | /usr/bin/sed -E 's/"newly_created": false/"newly_created": MARKER/g')"
if [[ -z "$WINNER_RESULT" || "$WINNER_IDENTITIES" != "$CONTENDER_IDENTITIES" ]]; then
  echo "Concurrent idempotent source requests returned different identities." >&2
  exit 1
fi
if [[ "$WINNER_RESULT" != *'"newly_created": true'* || "$CONTENDER_RESULT" != *'"newly_created": false'* ]]; then
  echo "Concurrent source responses did not distinguish creator from replay." >&2
  exit 1
fi
if [[ "$("${PSQL[@]}" -Atc "
  with target as (
    select batch.id
    from public.media_batches batch
    where batch.organization_id='11111111-1111-4111-8111-111111111111'
      and batch.source_provider='autohdr_source_upload'
      and batch.provider_job_id='00000000-0000-4000-8000-000000000020'
  )
  select (select count(*) from target) = 1
    and (select count(*) from public.media_assets where batch_id = (select id from target)) = 1
    and (select count(*) from public.media_versions where batch_id = (select id from target)) = 1
    and (select count(*) from public.media_ingest_jobs where batch_id = (select id from target)) = 1
")" != "t" ]]; then
  echo "Concurrent idempotent source request created duplicate canonical rows." >&2
  exit 1
fi

echo "AutoHDR canonical source-upload PostgreSQL 17 behavior suite passed."
