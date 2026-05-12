-- ============================================================================
-- Pixel Blaster Booking — Phase 9: Catalog (packages, a-la-carte, add-ons)
--
-- Replaces the hardcoded catalog in lib/booking/services.ts with a DB-backed
-- catalog the admin can edit at /admin/settings/pricing without a deploy.
--
-- Three kinds of items share one table so the admin UI and QB invoice code
-- don't have to branch:
--
--   bundle     — pick one. Fixed package (duration + price + inclusions).
--   a_la_carte — pick multiples with quantity. Each line adds its own duration.
--   addon      — side purchases like "put me on camera." Some are conditional
--                on the cart containing a video item (require_has_video).
--
-- Each booking now has a child `booking_line_items` table that snapshots the
-- unit price + duration at booking time. That way, if the admin edits a
-- package price next month, existing bookings + invoices keep their original
-- numbers. No silent rewriting of history.
--
-- Legacy `bookings.services text[]` / `bookings.add_ons text[]` stay in place
-- so old bookings still render. New bookings write line items; the booking
-- detail page and the QB invoice reader check line items first and fall back
-- to the legacy arrays.
-- ============================================================================

create type public.catalog_item_kind as enum ('bundle', 'a_la_carte', 'addon');

create table public.catalog_items (
  id                    uuid primary key default gen_random_uuid(),
  kind                  public.catalog_item_kind not null,
  -- Stable machine identifier. Used for QB invoice line refs and any future
  -- code that needs to reference a specific item. Lowercase snake_case.
  slug                  text not null unique,
  name                  text not null,
  -- Markdown bullet list of what's included. Shown to realtors on the
  -- booking form and to you on the admin pricing page.
  description           text not null default '',
  duration_minutes      int not null default 0 check (duration_minutes >= 0),
  price_cents           int not null default 0 check (price_cents >= 0),
  taxable               boolean not null default true,
  active                boolean not null default true,
  display_order         int not null default 0,
  -- True if picking this item counts the cart as "video" (so the on-camera
  -- add-on becomes available). Only meaningful for bundle + a_la_carte.
  is_video              boolean not null default false,
  -- True if this add-on only appears when the cart already contains a video
  -- item. Only meaningful for addon.
  require_has_video     boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger catalog_items_set_updated_at
  before update on public.catalog_items
  for each row execute function public.set_updated_at();

create index catalog_items_kind_idx   on public.catalog_items(kind);
create index catalog_items_active_idx on public.catalog_items(active) where active;

alter table public.catalog_items enable row level security;

-- Public read: the booking form is accessible to anonymous visitors, so the
-- catalog must be readable without auth. Price + duration are the same info
-- that would be shown on a pricing page anyway.
create policy "catalog_items: public read"
  on public.catalog_items for select
  using (true);

create policy "catalog_items: admin write"
  on public.catalog_items for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- booking_line_items — one row per package, a-la-carte item, or add-on the
-- realtor selected. Snapshots unit price + duration so price changes later
-- don't rewrite history.
-- ---------------------------------------------------------------------------
create table public.booking_line_items (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null references public.bookings(id) on delete cascade,
  catalog_item_id          uuid not null references public.catalog_items(id) on delete restrict,
  quantity                 int not null default 1 check (quantity > 0),
  unit_price_cents         int not null check (unit_price_cents >= 0),
  unit_duration_minutes    int not null check (unit_duration_minutes >= 0),
  created_at               timestamptz not null default now()
);

create index booking_line_items_booking_idx on public.booking_line_items(booking_id);

alter table public.booking_line_items enable row level security;

-- Realtors read line items for their own bookings (via the bookings RLS
-- join); admins read everything.
create policy "booking_line_items: owner or admin read"
  on public.booking_line_items for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = booking_id and b.owner_id = auth.uid()
    )
  );

-- Write goes through server actions with the service role; no end-user
-- writes needed.
create policy "booking_line_items: admin write"
  on public.booking_line_items for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Seed — real Acuity packages from pixelblastermedia.com
--
-- display_order increments by 10 so admins can insert new items between
-- existing ones without renumbering everything.
-- ---------------------------------------------------------------------------

-- Bundles
insert into public.catalog_items
  (kind, slug, name, description, duration_minutes, price_cents, is_video, display_order)
values
  (
    'bundle', 'blue_print', 'The Blue Print',
    E'- Up to 50 Photos\n- iGuide Virtual Tour\n- Floor plans\n- Room Measurements\n- Outside Sq Ft.\n- Weekly analytics and more\n\nUp to 2,500 sq ft of measuring included. Extra billed $40 per 500 sq ft ($50 for iGuide Premium).',
    80, 35000, false, 10
  ),
  (
    'bundle', 'social_media_special', 'Social Media Special',
    E'- Up to 50 Photos\n- One Take Reel video complemented by drone video\n- Up to 7 drone photos\n- iGuide Virtual Tour\n- Floor plans\n- Room Measurements\n- Outside Sq Ft.\n- Weekly analytics\n\nUp to 2,500 sq ft of measuring included. Extra billed $40 per 500 sq ft ($50 for iGuide Premium). Houses over 2,500 sq ft: +$50 video overage.',
    120, 60000, true, 20
  ),
  (
    'bundle', 'social_media_plus', 'Social Media PLUS',
    E'- Up to 50 Photos\n- 5 to 10 detail Photos\n- Video Tour complemented by drone video (vertical or horizontal)\n- Up to 7 drone photos\n- iGuide Virtual Tour\n- Floor plans\n- Room Measurements\n- Outside Sq Ft.\n- Weekly analytics\n\nUp to 2,500 sq ft of measuring included. Extra billed $40 per 500 sq ft ($50 for iGuide Premium). Houses over 2,500 sq ft: +$50 video overage.',
    180, 72500, true, 30
  ),
  (
    'bundle', 'ultimate', 'The Ultimate',
    E'- Up to 50 Photos\n- 5 to 10 detail Photos\n- One Take Reel video complemented by drone video\n- Video Tour complemented by drone video\n- Up to 7 drone photos\n- iGuide Virtual Tour\n- Floor plans\n- Room Measurements\n- Outside Sq Ft.\n- Weekly analytics\n\nUp to 2,500 sq ft of measuring included. Extra billed $40 per 500 sq ft ($50 for iGuide Premium). Houses over 3,000 sq ft: +$50 video overage.',
    240, 95000, true, 40
  );

-- A-la-carte
insert into public.catalog_items
  (kind, slug, name, description, duration_minutes, price_cents, is_video, display_order)
values
  (
    'a_la_carte', 'residential_photography', 'Residential Photography',
    'Up to 50 fully edited photos of your listing.',
    45, 20000, false, 10
  ),
  (
    'a_la_carte', 'aerial_photography', 'Aerial Photography',
    'Up to 25 drone photos.',
    60, 20000, false, 20
  ),
  (
    'a_la_carte', 'iguide_measurements', 'iGuide + Measurements',
    E'- iGuide Virtual Tour\n- Floor plans\n- Room Measurements\n- Outside Sq Ft.\n- Weekly analytics\n\nUp to 2,500 sq ft of measuring included. Extra billed $40 per 500 sq ft.',
    30, 20000, false, 30
  ),
  (
    'a_la_carte', 'social_media_reel', 'Social Media Reel',
    'Short vertical reel, edited for social.',
    30, 18000, true, 40
  ),
  (
    'a_la_carte', 'video_tour', 'Video Tour',
    E'Horizontal or vertical, up to 2,500 sq ft. Houses over 3,000 sq ft: +$50 video overage.',
    60, 32500, true, 50
  ),
  (
    'a_la_carte', 'interior_retakes', 'Interior Retakes',
    'Interior-only return shoot for retakes or missed rooms.',
    40, 12500, false, 60
  ),
  (
    'a_la_carte', 'exterior_retakes', 'Exterior Retakes',
    'Exterior-only return shoot for retakes or different-season shots.',
    40, 12500, false, 70
  );

-- Add-ons
insert into public.catalog_items
  (kind, slug, name, description, duration_minutes, price_cents, require_has_video, display_order)
values
  (
    'addon', 'on_camera', 'Put me on camera',
    'Agent appears on camera in the video (intro / outro / walk-and-talk).',
    0, 5000, true, 10
  );
