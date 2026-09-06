#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d /tmp/pixel-inbox.XXXXXX)
trap 'pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
initdb -D "$TMP/data" -A trust --no-locale >/dev/null
pg_ctl -D "$TMP/data" -l "$TMP/server.log" -o "-k $TMP -p 55439 -c listen_addresses=''" start >/dev/null
export PGHOST="$TMP" PGPORT=55439 PGDATABASE=postgres
psql -X -v ON_ERROR_STOP=1 -c 'create role anon; create role authenticated; create role service_role bypassrls; create table public.organizations(id uuid primary key); insert into public.organizations values ($$11111111-1111-4111-8111-111111111111$$);'
MIGRATION=supabase/migrations/20260906110000_public_booking_inbox_proof.sql
if [ -f "$MIGRATION" ]; then psql -X -v ON_ERROR_STOP=1 -f "$MIGRATION"; fi
psql -X -v ON_ERROR_STOP=1 -f tests/public-inbox-postgres.sql
