alter table public.organizations
  add column if not exists booking_hero_image_url text,
  add column if not exists booking_hero_secondary_image_url text;

comment on column public.organizations.booking_hero_image_url is
  'Primary visual used in the public booking page hero.';

comment on column public.organizations.booking_hero_secondary_image_url is
  'Secondary visual used in the public booking page hero.';
