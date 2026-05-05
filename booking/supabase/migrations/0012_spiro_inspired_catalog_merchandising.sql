-- ============================================================================
-- Pixel Blaster Booking — Spiro-inspired merchandising fields
--
-- Adds lightweight sales guidance to the catalog so the booking flow can steer
-- realtors toward the best-fit package without hard-coding marketing labels in
-- React components.
-- ============================================================================

alter table public.catalog_items
  add column if not exists badge text,
  add column if not exists highlight boolean not null default false,
  add column if not exists ideal_for text;

update public.catalog_items
set badge = 'Essential',
    highlight = false,
    ideal_for = 'Photos + iGUIDE basics for standard listings'
where slug = 'blue_print';

update public.catalog_items
set badge = 'Most popular',
    highlight = true,
    ideal_for = 'Realtors who want photos, drone, reels, and iGUIDE in one package'
where slug = 'social_media_special';

update public.catalog_items
set badge = 'Best value',
    highlight = true,
    ideal_for = 'Listings that need stronger video/social coverage'
where slug = 'social_media_plus';

update public.catalog_items
set badge = 'Luxury',
    highlight = false,
    ideal_for = 'High-end listings that need the full media push'
where slug = 'ultimate';
