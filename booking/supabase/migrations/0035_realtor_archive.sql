-- ============================================================================
-- Realtor archive / remove from active list
-- ----------------------------------------------------------------------------
-- Keep booking, property, listing, and delivery history intact while letting an
-- organization remove a realtor from active admin lists and portal access.
-- ============================================================================

alter table public.profiles
  add column if not exists archived_at timestamptz;

create index if not exists profiles_org_role_active_idx
  on public.profiles(organization_id, role, full_name, email)
  where archived_at is null;

comment on column public.profiles.archived_at is
  'Soft-delete marker for realtor profiles removed from active use. Historical bookings remain attached.';
