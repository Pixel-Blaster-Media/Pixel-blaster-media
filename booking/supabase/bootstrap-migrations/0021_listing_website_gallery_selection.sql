-- ============================================================================
-- Pixel Blaster Booking — listing website gallery photo selection
-- ============================================================================

alter table public.listing_websites
  add column if not exists gallery_image_urls text[];
