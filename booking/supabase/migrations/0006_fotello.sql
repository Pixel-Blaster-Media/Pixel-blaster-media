-- ============================================================================
-- Pixel Blaster Booking — Phase 5: Fotello integration
--
-- Models the link between one of our bookings and Fotello's `Listing`
-- concept. Each enhance (photo batch) becomes a row in `deliverables`
-- with source = 'fotello' and external_id = the enhance id; this
-- migration only needs to track the parent listing_id per booking.
--
-- Why listing_id on bookings instead of deliverables: a single shoot
-- usually produces one Fotello Listing that contains multiple batches
-- (interior + exterior enhances, re-runs, etc.). Keeping it at the
-- booking level means all those batches can be grouped under the same
-- listing, and the admin only has to paste the listing id once per shoot.
-- ============================================================================

alter table public.bookings
  add column if not exists fotello_listing_id text;

create index if not exists bookings_fotello_listing_idx
  on public.bookings(fotello_listing_id)
  where fotello_listing_id is not null;
