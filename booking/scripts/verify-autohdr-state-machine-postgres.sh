#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_MIGRATION="$ROOT/supabase/migrations/20260813013349_autohdr_state_machine.sql"
REPAIR_MIGRATION="$ROOT/supabase/migrations/20260813023000_autohdr_database_hardening.sql"
RECOVERY_MIGRATION="$ROOT/supabase/migrations/20260813030000_autohdr_provider_recovery.sql"

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

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixel-booking-autohdr-pg-test.XXXXXX")"
SOCKET_DIR="/tmp/pbautohdr-$$"
PORT="$((57000 + ($$ % 1000)))"
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
"${PSQL[@]}" -f "$ROOT/tests/postgres/autohdr-state-machine-bootstrap.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260811225000_canonical_media_releases.sql" >/dev/null

if [[ -f "$STATE_MIGRATION" ]]; then
  printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\n' "$STATE_MIGRATION" > "$TMP_DIR/rollback.sql"
  if [[ -f "$REPAIR_MIGRATION" ]]; then
    printf '\\ir %s\n' "$REPAIR_MIGRATION" >> "$TMP_DIR/rollback.sql"
  fi
  if [[ -f "$RECOVERY_MIGRATION" ]]; then
    printf '\\ir %s\n' "$RECOVERY_MIGRATION" >> "$TMP_DIR/rollback.sql"
  fi
  printf 'rollback;\n' >> "$TMP_DIR/rollback.sql"
  "${PSQL[@]}" -f "$TMP_DIR/rollback.sql" >/dev/null
  if [[ "$("${PSQL[@]}" -Atc "select to_regclass('public.autohdr_jobs') is null")" != "t" ]]; then
    echo "Rollback proof left AutoHDR schema residue." >&2
    exit 1
  fi
  "${PSQL[@]}" -f "$STATE_MIGRATION" >/dev/null
  if [[ -f "$REPAIR_MIGRATION" ]]; then
    "${PSQL[@]}" -f "$REPAIR_MIGRATION" >/dev/null
  else
    echo "AutoHDR database hardening migration is intentionally absent for the TDD red run." >&2
  fi
  if [[ -f "$RECOVERY_MIGRATION" ]]; then
    "${PSQL[@]}" -f "$RECOVERY_MIGRATION" >/dev/null
  else
    echo "AutoHDR provider recovery migration is intentionally absent for the TDD red run." >&2
  fi
else
  echo "AutoHDR migration is intentionally absent for the TDD red run." >&2
fi

"${PSQL[@]}" -f "$ROOT/tests/postgres/autohdr-state-machine.behavior.sql" >/dev/null

# Re-run and commit the fixture at ready so two sessions contend for one claim.
"${PSQL[@]}" -v commit_fixture=1 -f "$ROOT/tests/postgres/autohdr-state-machine.behavior.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/tests/postgres/autohdr-provider-recovery.behavior.sql" >/dev/null

CONCURRENT_FILES='[{"position":0,"source_media_version_id":"51111111-1111-4111-8111-111111111101","filename":"Concurrent.jpg"}]'
PGAPPNAME=autohdr-claim-winner "${PSQL[@]}" -qAt -c "
  set role service_role;
  begin;
  select jsonb_agg(to_jsonb(result))
  from public.claim_autohdr_job(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101',
    'autohdr-concurrent-claim', decode(repeat('ef', 32), 'hex'),
    '$CONCURRENT_FILES'::jsonb
  ) result;
  select pg_sleep(2);
  commit;
" >"$TMP_DIR/claim-winner.log" 2>&1 &
CLAIM_WINNER_PID=$!
sleep 0.1

PGAPPNAME=autohdr-claim-contender "${PSQL[@]}" -qAt -c "
  set role service_role;
  select jsonb_agg(to_jsonb(result))
  from public.claim_autohdr_job(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101',
    'autohdr-concurrent-claim', decode(repeat('ef', 32), 'hex'),
    '$CONCURRENT_FILES'::jsonb
  ) result;
" >"$TMP_DIR/claim-contender.log" 2>&1 &
CLAIM_CONTENDER_PID=$!

CLAIM_LOCK_OBSERVED=0
for _ in {1..50}; do
  if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where application_name='autohdr-claim-contender' and wait_event_type='Lock'")" == "1" ]]; then
    CLAIM_LOCK_OBSERVED=1
    break
  fi
  sleep 0.05
done
if [[ "$CLAIM_LOCK_OBSERVED" != 1 ]]; then
  echo "Concurrent AutoHDR claim contender was not observed waiting on a PostgreSQL lock." >&2
  exit 1
fi

wait "$CLAIM_WINNER_PID"
wait "$CLAIM_CONTENDER_PID"
CLAIM_WINNER_RESULT="$(/usr/bin/grep '^\[' "$TMP_DIR/claim-winner.log" | tail -n 1)"
CLAIM_CONTENDER_RESULT="$(/usr/bin/grep '^\[' "$TMP_DIR/claim-contender.log" | tail -n 1)"
CLAIM_WINNER_ID="$(printf '%s' "$CLAIM_WINNER_RESULT" | /usr/bin/sed -E 's/.*"id": "([^"]+)".*/\1/')"
CLAIM_CONTENDER_ID="$(printf '%s' "$CLAIM_CONTENDER_RESULT" | /usr/bin/sed -E 's/.*"id": "([^"]+)".*/\1/')"
if [[ -z "$CLAIM_WINNER_RESULT" || "$CLAIM_WINNER_ID" != "$CLAIM_CONTENDER_ID" ]]; then
  echo "Concurrent AutoHDR claims returned different job identities." >&2
  exit 1
fi
if [[ "$CLAIM_WINNER_RESULT" != *'"newly_created": true'* || "$CLAIM_CONTENDER_RESULT" != *'"newly_created": false'* ]]; then
  echo "Concurrent AutoHDR claims did not distinguish creator from replay." >&2
  exit 1
fi
if [[ "$("${PSQL[@]}" -Atc "
  select count(*) = 1
    from public.autohdr_jobs
   where organization_id='11111111-1111-4111-8111-111111111111'
     and idempotency_key='autohdr-concurrent-claim'
")" != "t" ]]; then
  echo "Concurrent AutoHDR claims created duplicate jobs." >&2
  exit 1
fi

PREPARE_JOB_A="$("${PSQL[@]}" -qAt -c "
  set role service_role;
  select id from public.claim_autohdr_job(
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101', 'autohdr-concurrent-prepare-a',
    decode(repeat('35', 32), 'hex'),
    '[{\"position\":0,\"source_media_version_id\":\"51111111-1111-4111-8111-111111111101\",\"filename\":\"ConcurrentPrepareA.jpg\"}]'::jsonb
  );
")"
PREPARE_JOB_B="$("${PSQL[@]}" -qAt -c "
  set role service_role;
  select id from public.claim_autohdr_job(
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101', 'autohdr-concurrent-prepare-b',
    decode(repeat('36', 32), 'hex'),
    '[{\"position\":0,\"source_media_version_id\":\"51111111-1111-4111-8111-111111111101\",\"filename\":\"ConcurrentPrepareB.jpg\"}]'::jsonb
  );
")"

PGAPPNAME=autohdr-prepare-winner "${PSQL[@]}" -qAt -c "
  set role service_role;
  begin;
  select id from public.transition_autohdr_job(
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101', '$PREPARE_JOB_A',
    'claimed', 'preparing', null, null, null
  );
  select pg_sleep(2);
  commit;
" >"$TMP_DIR/prepare-winner.log" 2>&1 &
PREPARE_WINNER_PID=$!
sleep 0.1

set +e
PGAPPNAME=autohdr-prepare-contender "${PSQL[@]}" -qAt -c "
  set role service_role;
  select id from public.transition_autohdr_job(
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101', '$PREPARE_JOB_B',
    'claimed', 'preparing', null, null, null
  );
" >"$TMP_DIR/prepare-contender.log" 2>&1 &
PREPARE_CONTENDER_PID=$!
set -e

PREPARE_LOCK_OBSERVED=0
for _ in {1..50}; do
  if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where application_name='autohdr-prepare-contender' and wait_event_type='Lock'")" == "1" ]]; then
    PREPARE_LOCK_OBSERVED=1
    break
  fi
  sleep 0.05
done
if [[ "$PREPARE_LOCK_OBSERVED" != 1 ]]; then
  echo "Concurrent AutoHDR provider preparation contender did not wait on the booking lock." >&2
  exit 1
fi
wait "$PREPARE_WINNER_PID"
if wait "$PREPARE_CONTENDER_PID"; then
  echo "Concurrent AutoHDR provider preparation opened two billable opportunities." >&2
  exit 1
fi
if [[ "$("${PSQL[@]}" -Atc "select count(*) from public.autohdr_jobs where id in ('$PREPARE_JOB_A','$PREPARE_JOB_B') and state='preparing'")" != "1" ]]; then
  echo "Concurrent AutoHDR provider preparation did not preserve one winner." >&2
  exit 1
fi
"${PSQL[@]}" -qAt -c "
  set role service_role;
  select id from public.abandon_autohdr_provider_job(
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101', '$PREPARE_JOB_A',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Concurrency test cleanup before provider creation.'
  );
" >/dev/null

ACTIVATION_JOB_ID="$("${PSQL[@]}" -qAt -c "
  set role service_role;
  select id from public.claim_autohdr_job(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101',
    'autohdr-concurrent-activation', decode(repeat('34', 32), 'hex'),
    '[{\"position\":0,\"source_media_version_id\":\"51111111-1111-4111-8111-111111111101\",\"filename\":\"ConcurrentActivation.jpg\"}]'::jsonb
  );
")"
"${PSQL[@]}" -qAt -c "
  set role service_role;
  select id from public.transition_autohdr_job(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101', '$ACTIVATION_JOB_ID',
    'claimed', 'preparing', null, null, null
  );
" >/dev/null

PGAPPNAME=autohdr-activation-winner "${PSQL[@]}" -qAt -c "
  set role service_role;
  begin;
  select id from public.activate_autohdr_provider_job(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101', '$ACTIVATION_JOB_ID', 'provider-winner'
  );
  select pg_sleep(2);
  commit;
" >"$TMP_DIR/activation-winner.log" 2>&1 &
ACTIVATION_WINNER_PID=$!
sleep 0.1

set +e
PGAPPNAME=autohdr-activation-contender "${PSQL[@]}" -qAt -c "
  set role service_role;
  select id from public.activate_autohdr_provider_job(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101', '$ACTIVATION_JOB_ID', 'provider-contender'
  );
" >"$TMP_DIR/activation-contender.log" 2>&1 &
ACTIVATION_CONTENDER_PID=$!
set -e

ACTIVATION_LOCK_OBSERVED=0
for _ in {1..50}; do
  if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where application_name='autohdr-activation-contender' and wait_event_type='Lock'")" == "1" ]]; then
    ACTIVATION_LOCK_OBSERVED=1
    break
  fi
  sleep 0.05
done
if [[ "$ACTIVATION_LOCK_OBSERVED" != 1 ]]; then
  echo "Concurrent AutoHDR activation contender was not observed waiting on a PostgreSQL lock." >&2
  exit 1
fi
wait "$ACTIVATION_WINNER_PID"
if wait "$ACTIVATION_CONTENDER_PID"; then
  echo "Concurrent AutoHDR activation accepted two provider identities." >&2
  exit 1
fi
if [[ "$("${PSQL[@]}" -Atc "
  select count(*) = 1 and bool_and(state='awaiting_upload')
    and bool_and(provider_uid='provider-winner')
    and bool_and(provider_uid_assigned_at is not null)
    and bool_and(upload_started_at is not null)
  from public.autohdr_jobs where id='$ACTIVATION_JOB_ID'
")" != "t" ]] || [[ "$("${PSQL[@]}" -Atc "select count(*) from public.autohdr_jobs where state='preparing' and provider_uid is not null")" != "0" ]]; then
  echo "Concurrent AutoHDR activation did not preserve one atomic winner." >&2
  exit 1
fi

JOB_ID="$("${PSQL[@]}" -Atc "
  select id from public.autohdr_jobs
   where organization_id='11111111-1111-4111-8111-111111111111'
     and idempotency_key='autohdr-fixture-a'
")"

PGAPPNAME=autohdr-retrieval-winner "${PSQL[@]}" -c "
  set role service_role;
  begin;
  select id from public.claim_autohdr_retrieval(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101', '$JOB_ID'
  );
  select pg_sleep(2);
  commit;
" >"$TMP_DIR/winner.log" 2>&1 &
WINNER_PID=$!
sleep 0.1

set +e
PGAPPNAME=autohdr-retrieval-contender "${PSQL[@]}" -c "
  set role service_role;
  select id from public.claim_autohdr_retrieval(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101', '$JOB_ID'
  );
" >"$TMP_DIR/contender.log" 2>&1 &
CONTENDER_PID=$!
set -e

LOCK_OBSERVED=0
for _ in {1..50}; do
  if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where application_name='autohdr-retrieval-contender' and wait_event_type='Lock'")" == "1" ]]; then
    LOCK_OBSERVED=1
    break
  fi
  sleep 0.05
done
if [[ "$LOCK_OBSERVED" != 1 ]]; then
  echo "Concurrent retrieval contender was not observed waiting on a PostgreSQL lock." >&2
  exit 1
fi

wait "$WINNER_PID"
if wait "$CONTENDER_PID"; then
  echo "Concurrent retrieval contender claimed an already claimed job." >&2
  exit 1
fi
if [[ "$("${PSQL[@]}" -Atc "
  select count(*) = 1
    from public.autohdr_jobs
   where organization_id='11111111-1111-4111-8111-111111111111'
     and id='$JOB_ID' and state='retrieving'
     and retrieval_claimed_at is not null and retrieval_claim_token is not null
")" != "t" ]]; then
  echo "Concurrent retrieval claim did not leave exactly one fenced job." >&2
  exit 1
fi

echo "AutoHDR PostgreSQL 17 state-machine behavior suite passed."
