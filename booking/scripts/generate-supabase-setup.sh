#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$ROOT_DIR/supabase/setup.sql"

{
  printf '%s\n' '-- ============================================================================'
  printf '%s\n' '-- Pixel Booking — one-paste Supabase setup'
  printf '%s\n' '--'
  printf '%s\n' '-- Generated from supabase/migrations/*.sql. Keep this file in sync whenever'
  printf '%s\n' '-- migrations change. For production teams, the migrations folder remains the'
  printf '%s\n' '-- source of truth; this file exists only as a convenient fresh-project setup.'
  printf '%s\n' '--'
  printf '%s\n' '-- First-time use:'
  printf '%s\n' '--   1. Paste this whole file into the Supabase SQL Editor.'
  printf '%s\n' '--   2. Run it once on an empty project database.'
  printf '%s\n' '--   3. Deploy the app, then create the first company account at /start.'
  printf '%s\n' '--'
  printf '%s\n' '-- Do not run this against a live database that already has user/customer data.'
  printf '%s\n' '-- Apply new files in supabase/migrations/ instead.'
  printf '%s\n' '-- ============================================================================'
  printf '\n'

  while IFS= read -r migration; do
    printf '\n-- ============================================================================\n'
    printf -- '-- Begin %s\n' "${migration#$ROOT_DIR/}"
    printf -- '-- ============================================================================\n\n'
    sed 's/[[:space:]]*$//' "$migration"
    printf '\n-- ============================================================================\n'
    printf -- '-- End %s\n' "${migration#$ROOT_DIR/}"
    printf -- '-- ============================================================================\n'
  done < <(find "$ROOT_DIR/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | sort)
} > "$OUTPUT"

printf 'Regenerated %s\n' "$OUTPUT"
