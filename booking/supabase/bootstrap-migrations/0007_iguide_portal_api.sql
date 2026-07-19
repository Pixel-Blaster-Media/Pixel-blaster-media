-- ============================================================================
-- Pixel Blaster Booking — iGuide Portal API (Phase 4b)
--
-- When we first wired up iGuide we only knew the URL slug (the "alias":
-- e.g. `1044_rest_acres_rd_brant_on`), so `bookings.iguide_id` stores that.
-- The real Portal API speaks in terms of an *immutable* ID (e.g.
-- `igYGFV5GG6V8DD1`) that never changes even if the realtor renames or
-- re-slugs the tour.
--
-- This migration adds `iguide_portal_id` for that immutable handle. The
-- ready-event webhook populates it automatically; the manual paste flow
-- can still work off the alias alone.
-- ============================================================================

alter table public.bookings
  add column if not exists iguide_portal_id text;

create unique index if not exists bookings_iguide_portal_id_key
  on public.bookings(iguide_portal_id)
  where iguide_portal_id is not null;

comment on column public.bookings.iguide_id is
  'iGuide URL alias (slug). Mutable — set on paste or webhook.';

comment on column public.bookings.iguide_portal_id is
  'Immutable iGuide Portal ID (e.g. igYGFV5GG6V8DD1). Set by the ready webhook; required for Portal API calls.';
