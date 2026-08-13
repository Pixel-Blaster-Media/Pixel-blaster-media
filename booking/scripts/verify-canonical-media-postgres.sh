#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C
export LANG=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixel-booking-media-pg-test.XXXXXX")"
SOCKET_DIR="/tmp/pbmedia-$$"
PORT="$((56000 + ($$ % 1000)))"
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
"${PSQL[@]}" -f "$ROOT/tests/postgres/canonical-media-bootstrap.sql" >/dev/null
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\nrollback;\n' \
  "$ROOT/supabase/migrations/20260811225000_canonical_media_releases.sql" \
  > "$TMP_DIR/rollback-proof.sql"
"${PSQL[@]}" -f "$TMP_DIR/rollback-proof.sql" >/dev/null
if [[ "$("${PSQL[@]}" -Atc "select pg_catalog.to_regclass('public.media_batches') is null")" != "t" ]]; then
  echo "Rollback proof left canonical media schema residue." >&2
  exit 1
fi
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260811225000_canonical_media_releases.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/tests/postgres/canonical-media-schema.behavior.sql" >/dev/null

# Re-run the fixture into the disposable database so two independent sessions can
# prove release approval and item insertion serialize on the parent release row.
"${PSQL[@]}" -v commit_fixture=1 -f "$ROOT/tests/postgres/canonical-media-schema.behavior.sql" >/dev/null
"${PSQL[@]}" -c "
  begin;
  update public.gallery_releases
     set state='approved', approved_by='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', approved_at=now()
   where id='71111111-1111-4111-8111-111111111102';
  select pg_catalog.pg_sleep(2);
  commit;
" >"$TMP_DIR/approval-session.log" 2>&1 &
APPROVAL_PID=$!
sleep 0.25
if "${PSQL[@]}" -c "
  insert into public.gallery_release_items (
    organization_id, property_id, batch_id, release_id, media_version_id,
    display_derivative_id, position, display_filename
  ) values (
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111101',
    '31111111-1111-4111-8111-111111111101',
    '71111111-1111-4111-8111-111111111102',
    '51111111-1111-4111-8111-111111111102',
    '61111111-1111-4111-8111-111111111102', 1, 'racing-pending.jpg'
  )
" >"$TMP_DIR/item-session.log" 2>&1; then
  echo "Concurrent pending release item bypassed approval serialization." >&2
  exit 1
fi
wait "$APPROVAL_PID"
if [[ "$("${PSQL[@]}" -Atc "
  select count(*) = 0
    from public.gallery_release_items item
    join public.gallery_releases release
      on release.organization_id=item.organization_id and release.id=item.release_id
   where release.id='71111111-1111-4111-8111-111111111102'
     and release.state='approved' and item.approval_state<>'approved'
")" != "t" ]]; then
  echo "Approved release retained an unapproved concurrent item." >&2
  exit 1
fi

# A release transition must serialize against an active listing insert.
"${PSQL[@]}" -c "
  begin;
  update public.gallery_releases set state='withdrawn', withdrawn_at=now()
   where id='71111111-1111-4111-8111-111111111102';
  select pg_catalog.pg_sleep(1);
  commit;
" >"$TMP_DIR/listing-transition-session.log" 2>&1 &
LISTING_TRANSITION_PID=$!
sleep 0.2
if "${PSQL[@]}" -c "
  insert into public.listing_gallery_items (
    organization_id, listing_website_id, property_id, batch_id, release_id,
    release_item_id, media_version_id, derivative_id, position
  ) values (
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111103',
    '11111111-1111-4111-8111-111111111101',
    '31111111-1111-4111-8111-111111111101',
    '71111111-1111-4111-8111-111111111102',
    '81111111-1111-4111-8111-111111111102',
    '51111111-1111-4111-8111-111111111101',
    '61111111-1111-4111-8111-111111111101', 1
  )
" >"$TMP_DIR/listing-insert-session.log" 2>&1; then
  echo "Concurrent listing insert bypassed release withdrawal serialization." >&2
  exit 1
fi
wait "$LISTING_TRANSITION_PID"
if [[ "$("${PSQL[@]}" -Atc "
  select count(*) = 0
    from public.listing_gallery_items item
    join public.gallery_releases release
      on release.organization_id=item.organization_id and release.id=item.release_id
   where release.state in ('withdrawn','superseded') and item.removed_at is null
")" != "t" ]]; then
  echo "Withdrawn release retained a concurrently inserted active listing." >&2
  exit 1
fi

# A release transition must likewise serialize against a new download grant.
"${PSQL[@]}" -c "
  update public.download_grants set revoked_at=now()
   where id='b1111111-1111-4111-8111-111111111101';
" >/dev/null
"${PSQL[@]}" -c "
  begin;
  update public.gallery_releases set state='withdrawn', withdrawn_at=now()
   where id='71111111-1111-4111-8111-111111111101';
  select pg_catalog.pg_sleep(1);
  commit;
" >"$TMP_DIR/grant-transition-session.log" 2>&1 &
GRANT_TRANSITION_PID=$!
sleep 0.2
if "${PSQL[@]}" -c "
  insert into public.download_grants (
    organization_id, property_id, batch_id, release_id, package_id,
    grantee_email_hash, token_key_id, token_hash, expires_at
  ) values (
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111101',
    '31111111-1111-4111-8111-111111111101',
    '71111111-1111-4111-8111-111111111101',
    'a1111111-1111-4111-8111-111111111101',
    decode(repeat('88',32),'hex'), 'key-v1', decode(repeat('89',32),'hex'),
    now() + interval '1 hour'
  )
" >"$TMP_DIR/grant-insert-session.log" 2>&1; then
  echo "Concurrent download grant bypassed release withdrawal serialization." >&2
  exit 1
fi
wait "$GRANT_TRANSITION_PID"
if [[ "$("${PSQL[@]}" -Atc "
  select count(*) = 0
    from public.download_grants grant_row
    join public.gallery_releases release
      on release.organization_id=grant_row.organization_id and release.id=grant_row.release_id
   where release.state in ('withdrawn','superseded') and grant_row.revoked_at is null
")" != "t" ]]; then
  echo "Withdrawn release retained a concurrently created active grant." >&2
  exit 1
fi

echo "Canonical media PostgreSQL behavior suite passed."
