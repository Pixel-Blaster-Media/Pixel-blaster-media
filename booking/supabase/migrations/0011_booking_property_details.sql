-- ============================================================================
-- Pixel Blaster Booking — Phase 11: property details on bookings
-- ----------------------------------------------------------------------------
-- Adds the wizard-flow property fields the realtor fills in at booking time:
--   - unit_number        — suite / apt number, stored separately from the
--                          street address so admin can sort / display cleanly
--   - is_vacant          — 'vacant' | 'occupied' | 'partial' | null
--                          (null = not asked; we leave the pre-wizard rows
--                          untouched rather than backfilling)
--   - include_basement   — whether the realtor wants the basement shot
--
-- square_footage already exists on bookings (migration 0001), so no change
-- to that column.
-- ============================================================================

alter table public.bookings
  add column if not exists unit_number      text,
  add column if not exists is_vacant        text,
  add column if not exists include_basement boolean;

-- Enforce the allowed is_vacant values at the DB level. text + check is
-- simpler than an enum (easier to evolve later without a migration dance).
alter table public.bookings
  drop constraint if exists bookings_is_vacant_check;
alter table public.bookings
  add constraint bookings_is_vacant_check
  check (is_vacant is null or is_vacant in ('vacant', 'occupied', 'partial'));

comment on column public.bookings.unit_number      is 'Suite / apt number; separate from street_address on properties.';
comment on column public.bookings.is_vacant        is 'vacant | occupied | partial. Null for pre-wizard bookings.';
comment on column public.bookings.include_basement is 'Whether the realtor wants the basement included in the shoot.';
