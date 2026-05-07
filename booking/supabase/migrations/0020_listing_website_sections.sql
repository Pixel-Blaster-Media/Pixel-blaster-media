-- ============================================================================
-- Pixel Blaster Booking — listing website included sections
-- ============================================================================

alter table public.listing_websites
  add column if not exists included_sections text[] not null default
    '{photos,tour,floor_plans,video,property_websites}'::text[];
