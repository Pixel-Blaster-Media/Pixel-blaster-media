#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPAND="$ROOT/supabase/migrations/20260831144638_private_booking_internal_notes_expand.sql"
CONTRACT="$ROOT/supabase/migrations/20260831144639_private_booking_internal_notes_contract.sql"

if [[ -n "${POSTGRES_BIN:-}" ]]; then
  PG_BIN="$POSTGRES_BIN"
elif [[ -x /opt/homebrew/opt/postgresql@17/bin/initdb ]]; then
  PG_BIN=/opt/homebrew/opt/postgresql@17/bin
elif command -v initdb >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v initdb)")"
else
  printf '%s\n' 'PostgreSQL 17 binaries are required.' >&2
  exit 1
fi
[[ "$($PG_BIN/postgres --version)" == *") 17."* ]] || {
  printf '%s\n' 'PostgreSQL 17 is required.' >&2
  exit 1
}

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/pixel-private-booking-notes.XXXXXX")
SOCKET_DIR="/tmp/pbnotes-$$"
PORT="$((61000 + (RANDOM % 4000)))"
STARTED=0
cleanup() {
  if [[ "$STARTED" == 1 ]]; then
    "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$SOCKET_DIR" "$TMP_DIR"
}
trap cleanup EXIT INT TERM
mkdir -p "$SOCKET_DIR"
"$PG_BIN/initdb" -D "$TMP_DIR/data" -A trust -U postgres --no-locale >/dev/null
"$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -l "$TMP_DIR/postgres.log" \
  -o "-F -p $PORT -k $SOCKET_DIR -c listen_addresses=''" -w start >/dev/null
STARTED=1
PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" -f "$ROOT/tests/postgres/private-booking-notes-bootstrap.sql" >/dev/null

BASELINE=$("${PSQL[@]}" -Atc "
  begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  select internal_notes from public.bookings where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  rollback;
")
[[ "$BASELINE" == *"Legacy private note"* ]] || {
  printf '%s\n' 'Baseline confidentiality defect was not reproduced.' >&2
  exit 1
}
printf '%s\n' 'BASELINE_LEAK_REPRODUCED'

"${PSQL[@]}" -c "
  update public.bookings
  set internal_notes=repeat('z', 2001)
  where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
" >/dev/null
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\ncommit;\n' \
  "$EXPAND" >"$TMP_DIR/over-limit-expand.sql"
if "${PSQL[@]}" -f "$TMP_DIR/over-limit-expand.sql" >"$TMP_DIR/over-limit-expand.log" 2>&1; then
  printf '%s\n' 'Expand migration accepted an over-limit legacy note.' >&2
  exit 1
fi
python3 - "$TMP_DIR/over-limit-expand.log" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
if 'legacy booking internal note exceeds the private-note limit' not in text:
    raise SystemExit('Over-limit expand probe failed for the wrong reason.')
PY
if [[ "$("${PSQL[@]}" -Atc "select to_regclass('public.booking_internal_notes') is null")" != "t" ]] \
   || [[ "$("${PSQL[@]}" -Atc "select char_length(internal_notes) from public.bookings where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'")" != "2001" ]]; then
  printf '%s\n' 'Over-limit expand failure left migration or data residue.' >&2
  exit 1
fi
"${PSQL[@]}" -c "
  update public.bookings
  set internal_notes='Legacy private note'
  where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
" >/dev/null

printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\n\\ir %s\nrollback;\n' \
  "$EXPAND" "$CONTRACT" >"$TMP_DIR/rollback.sql"
"${PSQL[@]}" -f "$TMP_DIR/rollback.sql" >/dev/null
if [[ "$("${PSQL[@]}" -Atc "select to_regclass('public.booking_internal_notes') is null")" != "t" ]]; then
  printf '%s\n' 'Rollback proof left private-note table residue.' >&2
  exit 1
fi
if [[ "$("${PSQL[@]}" -Atc "
  select not exists (
    select 1
    from pg_constraint
    where conrelid='public.bookings'::regclass
      and conname='bookings_organization_id_id_key'
  )
")" != "t" ]]; then
  printf '%s\n' 'Rollback proof left the tenant-qualified booking key behind.' >&2
  exit 1
fi
if [[ "$("${PSQL[@]}" -Atc "select internal_notes from public.bookings where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'")" != "Legacy private note" ]]; then
  printf '%s\n' 'Rollback proof changed legacy note data.' >&2
  exit 1
fi

printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\ncommit;\n' \
  "$EXPAND" >"$TMP_DIR/apply-expand.sql"
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\ncommit;\n' \
  "$CONTRACT" >"$TMP_DIR/apply-contract.sql"
"${PSQL[@]}" -f "$TMP_DIR/apply-expand.sql" >/dev/null
if [[ "$("${PSQL[@]}" -Atc "
  select exists (
    select 1
    from pg_constraint
    where conrelid='public.bookings'::regclass
      and conname='bookings_organization_id_id_key'
      and contype='u'
      and pg_get_constraintdef(oid)='UNIQUE (organization_id, id)'
  )
")" != "t" ]]; then
  printf '%s\n' 'Expand migration did not establish its tenant-qualified parent key.' >&2
  exit 1
fi
OWNER_EXPAND_RPC=$("${PSQL[@]}" -Atc "
  select result_status || '|' || coalesce(result_notes, '<NULL>') || '|' || result_revision
  from public.update_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    '12121212-1212-4212-8212-121212121212',
    0,
    'Owner expand note',
    '99999999-9999-4999-8999-999999999999'
  );
")
[[ "$OWNER_EXPAND_RPC" == "saved|Owner expand note|1" ]] || {
  printf '%s\n' 'Owner membership could not mutate private notes during expand.' >&2
  exit 1
}
OWNER_EXPAND_READ=$("${PSQL[@]}" -Atc "
  select notes || '|' || revision
  from public.get_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    array['12121212-1212-4212-8212-121212121212']::uuid[],
    '99999999-9999-4999-8999-999999999999'
  );
")
[[ "$OWNER_EXPAND_READ" == "Owner expand note|1" ]] || {
  printf '%s\n' 'Owner membership could not read private notes during expand.' >&2
  exit 1
}
"${PSQL[@]}" -c "
  begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  update public.bookings
  set internal_notes='Legacy mirror update'
  where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  commit;
" >/dev/null
if [[ "$("${PSQL[@]}" -Atc "
  select notes || ':' || revision
  from public.booking_internal_notes
  where booking_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
")" != "Legacy mirror update:2" ]]; then
  printf '%s\n' 'Expand phase did not preserve a deployed legacy write.' >&2
  exit 1
fi
EXPAND_RPC=$("${PSQL[@]}" -Atc "
  select result_status || '|' || coalesce(result_notes, '<NULL>') || '|' || result_revision
  from public.update_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    2,
    'Expanded RPC update',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
")
[[ "$EXPAND_RPC" == "saved|Expanded RPC update|3" ]] || {
  printf '%s\n' 'Expand-phase RPC did not return the expected revision.' >&2
  exit 1
}
if [[ "$("${PSQL[@]}" -Atc "
  select note.notes || ':' || note.revision || ':' || booking.internal_notes
  from public.booking_internal_notes note
  join public.bookings booking on booking.id=note.booking_id
  where note.booking_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
")" != "Expanded RPC update:3:Expanded RPC update" ]]; then
  printf '%s\n' 'Expand-phase RPC did not dual-write exactly once.' >&2
  exit 1
fi
printf '\\set ON_ERROR_STOP on\nbegin;\nupdate public.booking_internal_notes set notes=%s where booking_id=%s;\n\\ir %s\ncommit;\n' \
  "\$\$intentional mismatch\$\$" \
  "\$\$dddddddd-dddd-4ddd-8ddd-dddddddddddd\$\$::uuid" \
  "$CONTRACT" >"$TMP_DIR/contract-mismatch.sql"
if "${PSQL[@]}" -f "$TMP_DIR/contract-mismatch.sql" >"$TMP_DIR/contract-mismatch.log" 2>&1; then
  printf '%s\n' 'Contract migration accepted mismatched plaintext/private notes.' >&2
  exit 1
fi
python3 - "$TMP_DIR/contract-mismatch.log" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
if 'legacy and private booking notes are not exactly synchronized' not in text:
    raise SystemExit('Contract mismatch probe failed for the wrong reason.')
PY
if [[ "$("${PSQL[@]}" -Atc "
  select note.notes || ':' || note.revision || ':' || booking.internal_notes
  from public.booking_internal_notes note
  join public.bookings booking on booking.id=note.booking_id
  where note.booking_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
")" != "Expanded RPC update:3:Expanded RPC update" ]]; then
  printf '%s\n' 'Failed contract mismatch probe changed note data.' >&2
  exit 1
fi
"${PSQL[@]}" -f "$TMP_DIR/apply-contract.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/tests/postgres/private-booking-notes-contracted.behavior.sql" >/dev/null

PGAPPNAME=private-note-holder "${PSQL[@]}" -Atc "
  begin;
  select result_status || '|' || coalesce(result_notes, '<NULL>') || '|' || result_revision
  from public.update_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    5,
    'holder update',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  select pg_sleep(2);
  commit;
" >"$TMP_DIR/holder.log" 2>&1 &
HOLDER_PID=$!
sleep 0.1
PGAPPNAME=private-note-contender "${PSQL[@]}" -Atc "
  select result_status || '|' || coalesce(result_notes, '<NULL>') || '|' || result_revision
  from public.update_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    5,
    'contender overwrite',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
" >"$TMP_DIR/contender.log" 2>&1 &
CONTENDER_PID=$!
LOCK_OBSERVED=0
for _ in {1..50}; do
  if [[ "$("${PSQL[@]}" -Atc "
    select count(*)
    from pg_stat_activity
    where application_name='private-note-contender'
      and wait_event_type='Lock'
  ")" == "1" ]]; then
    LOCK_OBSERVED=1
    break
  fi
  sleep 0.05
done
[[ "$LOCK_OBSERVED" == 1 ]] || {
  printf '%s\n' 'Concurrent private-note contender was not observed waiting on a lock.' >&2
  exit 1
}
wait "$HOLDER_PID"
wait "$CONTENDER_PID"
python3 - "$TMP_DIR/holder.log" "$TMP_DIR/contender.log" <<'PY'
from pathlib import Path
import sys
holder = Path(sys.argv[1]).read_text()
contender = Path(sys.argv[2]).read_text()
if 'saved|holder update|6' not in holder:
    raise SystemExit('Lock holder did not save the expected revision.')
if 'conflict|holder update|6' not in contender:
    raise SystemExit('Stale contender was not rejected with canonical state.')
PY
if [[ "$("${PSQL[@]}" -Atc "
  select notes || ':' || revision
  from public.booking_internal_notes
  where booking_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
")" != "holder update:6" ]]; then
  printf '%s\n' 'Concurrent private-note update lost canonical state.' >&2
  exit 1
fi

OWNER_READ=$("${PSQL[@]}" -Atc "
  begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  select coalesce(internal_notes, '<NULL>') from public.bookings where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  rollback;
")
[[ "$OWNER_READ" == *"<NULL>"* && "$OWNER_READ" != *"Legacy private note"* ]] || {
  printf '%s\n' 'Realtor could still read a private booking note.' >&2
  exit 1
}
"${PSQL[@]}" -c "
  begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  insert into public.bookings (id, organization_id, owner_id)
  values ('abababab-abab-4bab-8bab-abababababab','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  commit;
" >/dev/null
if [[ "$("${PSQL[@]}" -Atc "
  select count(*)
  from public.booking_internal_notes
  where booking_id='abababab-abab-4bab-8bab-abababababab'
")" != "0" ]]; then
  printf '%s\n' 'Normal realtor insert created a private-note row.' >&2
  exit 1
fi

if "${PSQL[@]}" -c "
  begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  insert into public.bookings (id, organization_id, owner_id, internal_notes)
  values ('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','seeded private note');
  commit;
" >"$TMP_DIR/owner-insert.log" 2>&1; then
  printf '%s\n' 'Realtor seeded a legacy private note.' >&2
  exit 1
fi
python3 - "$TMP_DIR/owner-insert.log" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
if (
    'bookings_internal_notes_must_be_null' not in text
    and 'new row violates row-level security policy for table "bookings"' not in text
):
    raise SystemExit('Realtor insert failed for the wrong reason.')
PY

if "${PSQL[@]}" -c "
  begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  select * from public.booking_internal_notes;
  rollback;
" >"$TMP_DIR/private-select.log" 2>&1; then
  printf '%s\n' 'Authenticated role read the private-note table.' >&2
  exit 1
fi
python3 - "$TMP_DIR/private-select.log" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
if 'permission denied for table booking_internal_notes' not in text:
    raise SystemExit('Private table read failed for the wrong reason.')
PY

printf '%s\n' 'Private booking notes PostgreSQL confidentiality suite passed.'
