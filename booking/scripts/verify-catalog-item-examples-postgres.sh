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
else
  echo "PostgreSQL 17 binaries are required (set POSTGRES_BIN)." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixel-catalog-examples-pg.XXXXXX")"
SOCKET_DIR="/tmp/pbexamples-$$"
PORT="$((60000 + ($$ % 500)))"
STARTED=0
cleanup() {
  if [[ "$STARTED" == 1 ]]; then
    "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$SOCKET_DIR" "$TMP_DIR"
}
trap cleanup EXIT
mkdir -p "$SOCKET_DIR"
"$PG_BIN/initdb" -D "$TMP_DIR/data" -A trust -U postgres --no-locale >/dev/null
"$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -l "$TMP_DIR/postgres.log" \
  -o "-F -p $PORT -k $SOCKET_DIR -c listen_addresses=''" -w start >/dev/null
STARTED=1
PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -U postgres -d postgres)

"${PSQL[@]}" >/dev/null <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table public.organizations (
  id uuid primary key,
  name text not null,
  slug text unique
);
create table public.catalog_items (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text,
  name text not null,
  description text not null default '',
  kind text not null default 'bundle',
  active boolean not null default true,
  taxable boolean not null default true,
  display_order integer not null default 0,
  is_photo boolean not null default false,
  is_video boolean not null default false,
  require_has_video boolean not null default false,
  duration_minutes integer not null default 0,
  price_cents integer not null default 0,
  unique (organization_id, slug)
);
grant select on table public.organizations, public.catalog_items to service_role;
SQL

MIGRATION="$ROOT/supabase/migrations/20260816120000_catalog_item_examples.sql"
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\nrollback;\n' "$MIGRATION" > "$TMP_DIR/rollback-proof.sql"
"${PSQL[@]}" -f "$TMP_DIR/rollback-proof.sql" >/dev/null
if [[ "$("${PSQL[@]}" -Atc "select to_regclass('public.catalog_item_examples') is null")" != "t" ]]; then
  echo "Rollback proof left catalog example schema residue." >&2
  exit 1
fi
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\ncommit;\n' "$MIGRATION" > "$TMP_DIR/apply.sql"
"${PSQL[@]}" -f "$TMP_DIR/apply.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/tests/postgres/catalog-item-examples.behavior.sql" >/dev/null

SHARED_MIGRATION="$ROOT/supabase/migrations/20260817143000_shared_catalog_video_placements.sql"
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\nrollback;\n' "$SHARED_MIGRATION" > "$TMP_DIR/shared-rollback-proof.sql"
"${PSQL[@]}" -f "$TMP_DIR/shared-rollback-proof.sql" >/dev/null
if [[ "$("${PSQL[@]}" -Atc "select to_regclass('public.catalog_item_example_placements') is null")" != "t" ]]; then
  echo "Rollback proof left shared catalog video schema residue." >&2
  exit 1
fi
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\ncommit;\n' "$SHARED_MIGRATION" > "$TMP_DIR/shared-apply.sql"
"${PSQL[@]}" -f "$TMP_DIR/shared-apply.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/tests/postgres/shared-catalog-videos.behavior.sql" >/dev/null

DIMENSIONS_MIGRATION="$ROOT/supabase/migrations/20260817173000_catalog_video_dimensions.sql"
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\nrollback;\n' "$DIMENSIONS_MIGRATION" > "$TMP_DIR/dimensions-rollback-proof.sql"
"${PSQL[@]}" -f "$TMP_DIR/dimensions-rollback-proof.sql" >/dev/null
if [[ "$("${PSQL[@]}" -Atc "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'catalog_item_examples' and column_name in ('video_width', 'video_height')")" != "0" ]]; then
  echo "Rollback proof left catalog video dimension schema residue." >&2
  exit 1
fi
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\ncommit;\n' "$DIMENSIONS_MIGRATION" > "$TMP_DIR/dimensions-apply.sql"
"${PSQL[@]}" -f "$TMP_DIR/dimensions-apply.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/tests/postgres/catalog-video-dimensions.behavior.sql" >/dev/null

GROUPS_MIGRATION="$ROOT/supabase/migrations/20260817190000_grouped_catalog_sample_pills.sql"
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\nrollback;\n' "$GROUPS_MIGRATION" > "$TMP_DIR/groups-rollback-proof.sql"
"${PSQL[@]}" -f "$TMP_DIR/groups-rollback-proof.sql" >/dev/null
if [[ "$("${PSQL[@]}" -Atc "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'catalog_item_examples' and column_name in ('sample_group_key', 'sample_group_label')")" != "0" ]]; then
  echo "Rollback proof left grouped catalog sample schema residue." >&2
  exit 1
fi
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\ncommit;\n' "$GROUPS_MIGRATION" > "$TMP_DIR/groups-apply.sql"
"${PSQL[@]}" -f "$TMP_DIR/groups-apply.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/tests/postgres/grouped-catalog-sample-pills.behavior.sql" >/dev/null

RESUMABLE_MIGRATION="$ROOT/supabase/migrations/20261007173355_catalog_resumable_stream_uploads.sql"
printf '\\set ON_ERROR_STOP on\nbegin;\n\\ir %s\nrollback;\n' "$RESUMABLE_MIGRATION" > "$TMP_DIR/resumable-rollback-proof.sql"
"${PSQL[@]}" -f "$TMP_DIR/resumable-rollback-proof.sql" >/dev/null
if [[ "$("${PSQL[@]}" -Atc "select count(*) from information_schema.columns where table_schema='public' and table_name='catalog_stream_upload_claims' and column_name='upload_protocol'")" != "0" ]]; then
  echo "Rollback proof left resumable upload metadata residue." >&2
  exit 1
fi
# Direct-file autocommit transport, matching the linked migration CLI.
"${PSQL[@]}" -f "$RESUMABLE_MIGRATION" >/dev/null
"${PSQL[@]}" -f "$ROOT/tests/postgres/catalog-resumable-uploads.behavior.sql" >/dev/null
"${PSQL[@]}" >/dev/null <<'SQL'
insert into public.organizations(id,name,slug) values ('99000000-0000-4000-8000-000000000003','Concurrent upload fixture','upload-concurrent');
insert into public.catalog_items(id,organization_id,slug,name) values ('99000000-0000-4000-8000-000000000013','99000000-0000-4000-8000-000000000003','upload-concurrent','Concurrent upload');
SQL
"${PSQL[@]}" > "$TMP_DIR/resumable-first.log" <<'SQL' &
begin;
set local role service_role;
select public.claim_catalog_resumable_upload('99000000-0000-4000-8000-000000000031','99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000013',500000000,repeat('d',64));
select pg_sleep(0.5);
commit;
SQL
FIRST_RESUME_PID=$!
"${PSQL[@]}" > "$TMP_DIR/resumable-second.log" <<'SQL' &
set role service_role;
select public.claim_catalog_resumable_upload('99000000-0000-4000-8000-000000000032','99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000013',500000000,repeat('d',64));
SQL
SECOND_RESUME_PID=$!
wait "$FIRST_RESUME_PID"
wait "$SECOND_RESUME_PID"
if [[ "$("${PSQL[@]}" -Atc "select count(*) from public.catalog_stream_upload_claims where organization_id='99000000-0000-4000-8000-000000000003'")" != "1" ]]; then
  echo "Concurrent resume allocated duplicate provider work." >&2
  exit 1
fi
echo "Catalog examples, shared placements, dimensions, groups and resumable reservation/rollback/concurrency PostgreSQL 17 suites passed."
