-- ============================================================================
-- Pixel Blaster Booking — Phase 4: iGuide integration
--
-- Adds the minimum schema needed to associate an iGuide tour with one of
-- our bookings and to record an embeddable iframe snippet on each
-- deliverable so the realtor portal can render them inline.
-- ============================================================================

-- The iGuide URL slug for this booking, e.g. '1044_rest_acres_rd_brant_on'.
-- Nullable because it's set after the shoot is captured + uploaded.
-- Indexed because the webhook handler does `where iguide_id = $1` on every
-- incoming `ready` event.
alter table public.bookings
  add column if not exists iguide_id text;

create unique index if not exists bookings_iguide_id_key
  on public.bookings(iguide_id)
  where iguide_id is not null;
