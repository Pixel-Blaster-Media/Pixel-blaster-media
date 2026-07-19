#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$ROOT_DIR/supabase/setup.sql"
BOOTSTRAP_DIR="$ROOT_DIR/supabase/bootstrap-migrations"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"
CANONICAL_CUTOVER="20260716141227"

emit_migration() {
  local migration="$1"
  printf '\n-- ============================================================================\n'
  printf -- '-- Begin %s\n' "${migration#$ROOT_DIR/}"
  printf -- '-- ============================================================================\n\n'
  sed 's/[[:space:]]*$//' "$migration"
  printf '\n-- ============================================================================\n'
  printf -- '-- End %s\n' "${migration#$ROOT_DIR/}"
  printf -- '-- ============================================================================\n'
}

{
  printf '%s\n' '-- ============================================================================'
  printf '%s\n' '-- Pixel Booking — one-paste Supabase setup'
  printf '%s\n' '--'
  printf '%s\n' '-- Generated from the pre-ledger bootstrap history plus canonical migrations'
  printf '%s\n' "-- from version $CANONICAL_CUTOVER onward. The production migration directory"
  printf '%s\n' '-- mirrors the linked production ledger; bootstrap-migrations exists only to'
  printf '%s\n' '-- reconstruct fresh projects whose original schema predates that ledger.'
  printf '%s\n' '--'
  printf '%s\n' '-- First-time use:'
  printf '%s\n' '--   1. Paste this whole file into the Supabase SQL Editor.'
  printf '%s\n' '--   2. Run it once on an empty project database.'
  printf '%s\n' '--   3. Disable public Auth signup before exposing the project.'
  printf '%s\n' '--   4. Follow docs/auth-rollout.md and run the guarded first-company bootstrap.'
  printf '%s\n' '--'
  printf '%s\n' '-- Do not run this against a live database that already has user/customer data.'
  printf '%s\n' '-- Apply only new files from supabase/migrations/ to linked production.'
  printf '%s\n' '-- ============================================================================'
  printf '\n'

  while IFS= read -r migration; do
    emit_migration "$migration"
  done < <(find "$BOOTSTRAP_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

  while IFS= read -r migration; do
    version="$(basename "$migration" | cut -d_ -f1)"
    if [[ "$version" < "$CANONICAL_CUTOVER" ]]; then
      continue
    fi
    emit_migration "$migration"
  done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
} > "$OUTPUT"

printf 'Regenerated %s\n' "$OUTPUT"
