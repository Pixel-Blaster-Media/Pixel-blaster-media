-- ============================================================================
-- Catalog square-footage pricing
--
-- Adds configurable overage rules for services like iGUIDE where the base
-- price includes a fixed amount of measuring and larger homes are billed in
-- increments.
-- ============================================================================

alter table public.catalog_items
  add column if not exists sqft_pricing_enabled boolean not null default false,
  add column if not exists included_sqft int,
  add column if not exists overage_increment_sqft int,
  add column if not exists overage_price_cents int;

alter table public.catalog_items
  drop constraint if exists catalog_items_included_sqft_check,
  add constraint catalog_items_included_sqft_check
    check (included_sqft is null or included_sqft > 0),
  drop constraint if exists catalog_items_overage_increment_sqft_check,
  add constraint catalog_items_overage_increment_sqft_check
    check (overage_increment_sqft is null or overage_increment_sqft > 0),
  drop constraint if exists catalog_items_overage_price_cents_check,
  add constraint catalog_items_overage_price_cents_check
    check (overage_price_cents is null or overage_price_cents >= 0);

-- Pixel Blaster default: every package/service containing iGUIDE includes
-- 2,500 sq ft, then bills $40 per additional 500 sq ft.
update public.catalog_items
set sqft_pricing_enabled = true,
    included_sqft = 2500,
    overage_increment_sqft = 500,
    overage_price_cents = 4000
where slug in (
  'blue_print',
  'social_media_special',
  'social_media_plus',
  'ultimate',
  'iguide_measurements'
);
