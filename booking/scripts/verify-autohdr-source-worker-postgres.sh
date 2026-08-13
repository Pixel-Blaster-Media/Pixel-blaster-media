#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C
export LANG=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_MIGRATION="$ROOT/supabase/migrations/20260813033000_autohdr_source_worker_contract.sql"
RECOVERY_MIGRATION="$ROOT/supabase/migrations/20260813040000_autohdr_source_worker_recovery.sql"
RUNTIME_MIGRATION="$ROOT/supabase/migrations/20260813041000_autohdr_source_worker_runtime.sql"

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

"${PSQL[@]}" -f "$ROOT/tests/postgres/autohdr-source-worker-legacy-fixtures.sql" >/dev/null

if [[ -f "$WORKER_MIGRATION" ]]; then
  printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\nrollback;\n' "$WORKER_MIGRATION" > "$TMP_DIR/rollback-proof.sql"
  "${PSQL[@]}" -f "$TMP_DIR/rollback-proof.sql" >/dev/null
  if [[ "$("${PSQL[@]}" -Atc "select to_regclass('public.autohdr_source_hash_reservations') is null")" != "t" ]]; then
    echo "Rollback proof left source worker schema residue." >&2
    exit 1
  fi
  "${PSQL[@]}" -f "$WORKER_MIGRATION" >/dev/null
  "${PSQL[@]}" -f "$RECOVERY_MIGRATION" >/dev/null
  "${PSQL[@]}" -f "$RUNTIME_MIGRATION" >/dev/null
else
  echo "AutoHDR source worker migration is intentionally absent for the TDD red run." >&2
fi

"${PSQL[@]}" -v commit_fixture=1 -f "$ROOT/tests/postgres/autohdr-source-worker.behavior.sql" >/dev/null

# Keep the later same-hash race fixtures out of the earlier SKIP LOCKED and
# crash-recovery claims. All fixtures share one transaction timestamp, so UUID
# ordering is not a truthful substitute for explicit candidate isolation.
"${PSQL[@]}" -qAtc "update public.autohdr_source_ingests set worker_id='fixture-isolation', worker_lease_token=gen_random_uuid(), worker_claimed_at=clock_timestamp(), worker_lease_expires_at=clock_timestamp()+interval '10 minutes' where request_id in ('00000000-0000-4000-8000-000000000206','00000000-0000-4000-8000-000000000207')" >/dev/null

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
CLAIM_B="$("${PSQL[@]}" -qAtF '|' -c "set role service_role; select request_id,ingest_job_id,lease_token from public.claim_autohdr_source_file('11111111-1111-4111-8111-111111111111','worker-crash',30)")"
wait "$SESSION_A"
if [[ "${CLAIM_B%%|*}" != "00000000-0000-4000-8000-000000000205" ]]; then
  echo "Concurrent claim did not skip the locked row and select the independent crash fixture: $CLAIM_B" >&2
  exit 1
fi
CLAIM_A="$("${PSQL[@]}" -qAtc "set role service_role; select count(*) from public.claim_autohdr_source_file('11111111-1111-4111-8111-111111111111','worker-concurrent-a',60)")"
if [[ "$CLAIM_A" != "1" ]]; then
  echo "Unlocked source was not claimed exactly once: $CLAIM_A" >&2
  exit 1
fi

# Real crash-after-reservation recovery and stale-token fencing. The first
# worker commits its reservation and disappears. Expiry makes the same source
# claimable with a rotated token; every stale settlement then fails.
CRASH_REST="${CLAIM_B#*|}"; CRASH_JOB="${CRASH_REST%%|*}"; STALE_TOKEN="${CRASH_REST##*|}"
"${PSQL[@]}" -qAtc "set role service_role; select version_id from public.reserve_or_reuse_autohdr_source_master('11111111-1111-4111-8111-111111111111','$CRASH_JOB','$STALE_TOKEN','pixel-blaster-private-media',(select master_object_key from public.autohdr_source_ingests where ingest_job_id='$CRASH_JOB'),decode(repeat('45',32),'hex'),14,'image/jpeg')" >/dev/null
"${PSQL[@]}" -qAtc "update public.autohdr_source_ingests set worker_lease_expires_at=clock_timestamp()-interval '1 second' where ingest_job_id='$CRASH_JOB'; update public.autohdr_source_hash_reservations set reservation_lease_expires_at=clock_timestamp()-interval '1 second' where reserved_by_ingest_job_id='$CRASH_JOB'" >/dev/null
RECLAIM="$("${PSQL[@]}" -qAtF '|' -c "set role service_role; select ingest_job_id,lease_token from public.claim_autohdr_source_file('11111111-1111-4111-8111-111111111111','worker-reclaim',60) where ingest_job_id='$CRASH_JOB'")"
NEW_TOKEN="${RECLAIM##*|}"
if [[ -z "$NEW_TOKEN" || "$NEW_TOKEN" == "$STALE_TOKEN" ]]; then echo "crash-after-reservation did not rotate lease token" >&2; exit 1; fi
if "${PSQL[@]}" -qAtc "set role service_role; select * from public.complete_autohdr_source_file('11111111-1111-4111-8111-111111111111','$CRASH_JOB','$STALE_TOKEN',100,100)" >/dev/null 2>&1; then echo "stale token completed reclaimed source" >&2; exit 1; fi
"${PSQL[@]}" -qAtc "set role service_role; select version_id from public.reserve_or_reuse_autohdr_source_master('11111111-1111-4111-8111-111111111111','$CRASH_JOB','$NEW_TOKEN','pixel-blaster-private-media',(select master_object_key from public.autohdr_source_ingests where ingest_job_id='$CRASH_JOB'),decode(repeat('45',32),'hex'),14,'image/jpeg'); select * from public.complete_autohdr_source_file('11111111-1111-4111-8111-111111111111','$CRASH_JOB','$NEW_TOKEN',100,100)" >/dev/null

# Observable same-hash reservation race: two sessions own distinct source leases,
# session A holds the tenant/hash advisory lock after reserving, and session B is
# observed waiting on that lock before it fails closed on the live reservation.
"${PSQL[@]}" -qAtc "update public.autohdr_source_ingests set worker_id=null, worker_lease_token=null, worker_lease_expires_at=null where request_id='00000000-0000-4000-8000-000000000206'" >/dev/null
RACE_A="$("${PSQL[@]}" -qAtF '|' -c "set role service_role; select ingest_job_id,lease_token,master_object_key from public.claim_autohdr_source_file('11111111-1111-4111-8111-111111111111','race-a',60)")"
"${PSQL[@]}" -qAtc "update public.autohdr_source_ingests set worker_id=null, worker_lease_token=null, worker_lease_expires_at=null where request_id='00000000-0000-4000-8000-000000000207'" >/dev/null
RACE_B="$("${PSQL[@]}" -qAtF '|' -c "set role service_role; select ingest_job_id,lease_token,master_object_key from public.claim_autohdr_source_file('11111111-1111-4111-8111-111111111111','race-b',60)")"
IFS='|' read -r RACE_A_JOB RACE_A_TOKEN RACE_A_KEY <<<"$RACE_A"
IFS='|' read -r RACE_B_JOB RACE_B_TOKEN RACE_B_KEY <<<"$RACE_B"
if [[ -z "$RACE_A_JOB" || -z "$RACE_B_JOB" || "$RACE_A_JOB" == "$RACE_B_JOB" ]]; then
  echo "same-hash race fixtures were not claimed as two distinct sources" >&2
  exit 1
fi
"${PSQL[@]}" -c "set role service_role; begin; select version_id from public.reserve_or_reuse_autohdr_source_master('11111111-1111-4111-8111-111111111111','$RACE_A_JOB','$RACE_A_TOKEN','pixel-blaster-private-media','$RACE_A_KEY',decode(repeat('56',32),'hex'),15,'image/jpeg'); select pg_sleep(2); commit" >"$TMP_DIR/race-a.out" 2>"$TMP_DIR/race-a.err" &
RACE_A_PID=$!
for _ in $(seq 1 100); do
  [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where query like '%$RACE_A_JOB%' and wait_event_type='Timeout'")" == "1" ]] && break
  sleep 0.02
done
set +e
"${PSQL[@]}" -c "set role service_role; select version_id from public.reserve_or_reuse_autohdr_source_master('11111111-1111-4111-8111-111111111111','$RACE_B_JOB','$RACE_B_TOKEN','pixel-blaster-private-media','$RACE_B_KEY',decode(repeat('56',32),'hex'),15,'image/jpeg')" >"$TMP_DIR/race-b.out" 2>"$TMP_DIR/race-b.err" &
RACE_B_PID=$!
set -e
for _ in $(seq 1 100); do
  [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where query like '%$RACE_B_JOB%' and wait_event_type='Lock'")" == "1" ]] && break
  sleep 0.02
done
if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where query like '%$RACE_B_JOB%' and wait_event_type='Lock'")" != "1" ]]; then echo "same-hash contender was not observed waiting on the advisory lock" >&2; exit 1; fi
wait "$RACE_A_PID"
if wait "$RACE_B_PID"; then echo "same-hash contender bypassed the live reservation" >&2; exit 1; fi

echo "AutoHDR source worker PostgreSQL 17 behavior, same-hash reservation race, crash-after-reservation reclaim, stale token fencing, and concurrent accepted reuse suites passed."
