-- ============================================================================
-- Pixel Blaster Booking — catalog merchandising columns (recovery)
--
-- Adds lightweight sales guidance to the catalog so the booking flow can steer
-- realtors toward the best-fit package without hard-coding marketing labels in
-- React components. This originally used the same 0012 version prefix as the
-- integration-credentials migration and was never applied to production. The
-- timestamped version repairs that history collision without replaying older
-- migrations. Every schema change and data default is safe to rerun.
-- ============================================================================

-- Fail quickly rather than queue behind a long transaction and block requests.
set lock_timeout = '5s';

alter table public.catalog_items
  add column if not exists badge text,
  add column if not exists highlight boolean not null default false,
  add column if not exists ideal_for text;

update public.catalog_items
set badge = 'Essential',
    highlight = false,
    ideal_for = 'Photos + iGUIDE basics for standard listings'
where slug = 'blue_print'
  and organization_id = '00000000-0000-0000-0000-000000000001'
  and badge is null
  and ideal_for is null
  and highlight = false;

update public.catalog_items
set badge = 'Most popular',
    highlight = true,
    ideal_for = 'Realtors who want photos, drone, reels, and iGUIDE in one package'
where slug = 'social_media_special'
  and organization_id = '00000000-0000-0000-0000-000000000001'
  and badge is null
  and ideal_for is null
  and highlight = false;

update public.catalog_items
set badge = 'Best value',
    highlight = true,
    ideal_for = 'Listings that need stronger video/social coverage'
where slug = 'social_media_plus'
  and organization_id = '00000000-0000-0000-0000-000000000001'
  and badge is null
  and ideal_for is null
  and highlight = false;

update public.catalog_items
set badge = 'Luxury',
    highlight = false,
    ideal_for = 'High-end listings that need the full media push'
where slug = 'ultimate'
  and organization_id = '00000000-0000-0000-0000-000000000001'
  and badge is null
  and ideal_for is null
  and highlight = false;

-- PostgREST normally reloads after DDL, but notify explicitly so the pricing
-- server action can write the new fields immediately after this migration.
notify pgrst, 'reload schema';
