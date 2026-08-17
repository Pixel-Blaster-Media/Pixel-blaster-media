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
  name text not null
);
create table public.catalog_items (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null
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

echo "Catalog item examples PostgreSQL 17 schema, tenant boundary, privilege, constraint, rollback, and restricted-deletion suite passed."
