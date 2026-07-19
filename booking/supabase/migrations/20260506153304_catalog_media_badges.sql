alter table public.catalog_items
  add column if not exists is_photo boolean not null default false;

update public.catalog_items
set is_photo = true
where slug in (
  'blue_print',
  'social_media_special',
  'social_media_plus',
  'ultimate',
  'residential_photography',
  'aerial_photography',
  'interior_retakes',
  'exterior_retakes'
);;
