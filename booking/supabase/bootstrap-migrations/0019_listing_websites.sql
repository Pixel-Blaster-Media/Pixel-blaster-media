-- ============================================================================
-- Pixel Blaster Booking — public listing websites
--
-- Stores one lightweight launch-page config per property/listing. Core booking
-- and media data stay in their own tables; this table only controls the
-- public page template, copy, contact details, and publish state.
-- ============================================================================

create table if not exists public.listing_websites (
  id                 uuid primary key default gen_random_uuid(),
  property_id        uuid not null references public.properties(id) on delete cascade,
  booking_id         uuid references public.bookings(id) on delete set null,
  owner_id           uuid not null references public.profiles(id) on delete restrict,
  template           text not null default 'clean_mls_plus',
  slug               text not null,
  is_published       boolean not null default false,
  headline           text,
  description        text,
  feature_bullets    text[] not null default '{}',
  hero_image_url     text,
  agent_name         text,
  agent_email        text,
  agent_phone        text,
  brokerage_name     text,
  cta_text           text,
  cta_url            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint listing_websites_template_check check (
    template in (
      'estate_cinematic',
      'clean_mls_plus',
      'modern_forest',
      'editorial_magazine'
    )
  ),
  constraint listing_websites_slug_check check (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

create unique index if not exists listing_websites_property_idx
  on public.listing_websites(property_id);

create unique index if not exists listing_websites_slug_idx
  on public.listing_websites(slug);

create index if not exists listing_websites_owner_idx
  on public.listing_websites(owner_id);

create index if not exists listing_websites_published_idx
  on public.listing_websites(is_published);

drop trigger if exists listing_websites_set_updated_at on public.listing_websites;
create trigger listing_websites_set_updated_at
  before update on public.listing_websites
  for each row execute function public.set_updated_at();

alter table public.listing_websites enable row level security;

drop policy if exists "listing_websites: public published read"
  on public.listing_websites;
create policy "listing_websites: public published read"
  on public.listing_websites for select
  using (is_published = true or owner_id = auth.uid() or public.is_admin());

drop policy if exists "listing_websites: owner insert"
  on public.listing_websites;
create policy "listing_websites: owner insert"
  on public.listing_websites for insert
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "listing_websites: owner update"
  on public.listing_websites;
create policy "listing_websites: owner update"
  on public.listing_websites for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
