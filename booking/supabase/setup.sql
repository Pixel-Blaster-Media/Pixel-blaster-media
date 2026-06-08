-- ============================================================================
-- Pixel Booking — one-paste Supabase setup
--
-- Generated from supabase/migrations/*.sql. Keep this file in sync whenever
-- migrations change. For production teams, the migrations folder remains the
-- source of truth; this file exists only as a convenient fresh-project setup.
--
-- First-time use:
--   1. Paste this whole file into the Supabase SQL Editor.
--   2. Run it once on an empty project database.
--   3. Deploy the app, then create the first company account at /start.
--
-- Do not run this against a live database that already has user/customer data.
-- Apply new files in supabase/migrations/ instead.
-- ============================================================================


-- ============================================================================
-- Begin supabase/migrations/0001_init.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — initial schema (Phase 1)
--
-- Designed for Supabase Postgres. Auth is handled by Supabase Auth, so the
-- canonical user identity lives in `auth.users`; we mirror profile metadata
-- and role into `public.profiles` (1:1 with auth.users).
--
-- All tables enable Row Level Security. Realtors can only see their own
-- properties / bookings / deliverables. Admins (profiles.role = 'admin') see
-- everything. Service-role inserts (e.g. webhook ingest from iGuide/Fotello)
-- bypass RLS by design.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('realtor', 'admin');

create type public.booking_status as enum (
  'requested',   -- realtor submitted, not yet confirmed
  'confirmed',   -- date locked in
  'shot',        -- on-site capture complete
  'editing',     -- in post-production
  'delivered',   -- all deliverables published to portal
  'cancelled'
);

create type public.deliverable_type as enum (
  'photo_gallery',
  'virtual_tour',
  'floor_plan',
  'video',
  'aerial'
);

create type public.deliverable_source as enum (
  'fotello',
  'iguide',
  'manual'
);

-- ---------------------------------------------------------------------------
-- profiles  — 1:1 with auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text,
  phone        text,
  brokerage    text,
  role         public.user_role not null default 'realtor',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);

-- ---------------------------------------------------------------------------
-- properties  — one address; many bookings (re-shoots) and deliverables
-- ---------------------------------------------------------------------------
create table public.properties (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles(id) on delete restrict,
  street_address  text not null,
  city            text,
  province        text default 'ON',
  postal_code     text,
  mls_number      text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index properties_owner_idx on public.properties(owner_id);
create index properties_mls_idx   on public.properties(mls_number);

-- ---------------------------------------------------------------------------
-- bookings  — one shoot session; can produce multiple deliverables
-- ---------------------------------------------------------------------------
create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references public.properties(id) on delete cascade,
  owner_id        uuid not null references public.profiles(id) on delete restrict,
  status          public.booking_status not null default 'requested',
  scheduled_at    timestamptz,
  services        text[] not null default '{}',  -- e.g. {'photos','iguide_tour','floor_plan','drone'}
  add_ons         text[] not null default '{}',  -- e.g. {'twilight','virtual_staging'}
  square_footage  integer,
  internal_notes  text,
  client_notes    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index bookings_owner_idx     on public.bookings(owner_id);
create index bookings_property_idx  on public.bookings(property_id);
create index bookings_status_idx    on public.bookings(status);
create index bookings_scheduled_idx on public.bookings(scheduled_at);

-- ---------------------------------------------------------------------------
-- deliverables  — gallery / tour / floor plan etc., delivered to the realtor
--
-- external_id + source let us idempotently upsert from iGuide/Fotello webhooks
-- (so the same iGuide tour ID never gets duplicated in our DB).
-- ---------------------------------------------------------------------------
create table public.deliverables (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.bookings(id) on delete cascade,
  property_id     uuid not null references public.properties(id) on delete cascade,
  type            public.deliverable_type not null,
  source          public.deliverable_source not null,
  external_id     text,           -- e.g. iGuide tour id, Fotello gallery id
  url             text not null,  -- viewer / embed / download URL
  embed_html      text,           -- optional iframe / embed snippet
  thumbnail_url   text,
  metadata        jsonb not null default '{}'::jsonb,
  ready_at        timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source, external_id)
);

create index deliverables_booking_idx  on public.deliverables(booking_id);
create index deliverables_property_idx on public.deliverables(property_id);
create index deliverables_type_idx     on public.deliverables(type);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

create trigger deliverables_set_updated_at
  before update on public.deliverables
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile row whenever a new auth.users row is inserted.
-- New sign-ups default to 'realtor'. Promote to 'admin' manually in SQL.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Helper: is the current request from an admin?
-- Defined as SECURITY DEFINER so RLS policies on `profiles` itself don't
-- recurse when the helper queries it.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.properties   enable row level security;
alter table public.bookings     enable row level security;
alter table public.deliverables enable row level security;

-- profiles: users see/update their own row; admins see all
create policy "profiles: self read"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles: self update"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles: admin update"
  on public.profiles for update
  using (public.is_admin());

-- properties
create policy "properties: owner read"
  on public.properties for select
  using (owner_id = auth.uid() or public.is_admin());

create policy "properties: owner write"
  on public.properties for insert
  with check (owner_id = auth.uid() or public.is_admin());

create policy "properties: owner update"
  on public.properties for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- bookings
create policy "bookings: owner read"
  on public.bookings for select
  using (owner_id = auth.uid() or public.is_admin());

create policy "bookings: owner insert"
  on public.bookings for insert
  with check (owner_id = auth.uid() or public.is_admin());

create policy "bookings: admin update"
  on public.bookings for update
  using (public.is_admin())
  with check (public.is_admin());

-- deliverables — read-only for realtors; admins (and service role) write
create policy "deliverables: owner read"
  on public.deliverables for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = deliverables.booking_id and b.owner_id = auth.uid()
    )
  );

create policy "deliverables: admin write"
  on public.deliverables for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- End supabase/migrations/0001_init.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0002_booking_requests.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 2: public booking requests
--
-- The public booking form on /book writes to this table. Submissions are
-- intentionally decoupled from auth.users / profiles — anyone can request a
-- shoot without signing up first. An admin promotes a `booking_request` into
-- a real `booking` (and creates the property + profile linkage) in Phase 3.
--
-- All inserts are performed server-side via a Server Action using the
-- service-role client, so RLS on this table is admin-read-only. No anon
-- INSERT policy is granted, which means the table cannot be written to
-- directly from the browser even if the anon key leaks.
-- ============================================================================

create type public.booking_request_status as enum (
  'new',         -- just submitted
  'reviewing',   -- admin has eyes on it
  'accepted',    -- promoted to a real booking
  'declined'
);

create table public.booking_requests (
  id              uuid primary key default gen_random_uuid(),
  status          public.booking_request_status not null default 'new',

  -- Contact
  contact_name    text not null,
  contact_email   text not null,
  contact_phone   text,
  brokerage       text,

  -- Property
  street_address  text not null,
  city            text,
  province        text default 'ON',
  postal_code     text,
  square_footage  integer,

  -- Shoot
  services        text[] not null default '{}',
  add_ons         text[] not null default '{}',
  preferred_date  date,
  preferred_time  text,        -- 'morning' | 'afternoon' | 'evening' | 'flexible'
  notes           text,

  -- Linkage once accepted
  booking_id      uuid references public.bookings(id) on delete set null,

  -- Meta
  source          text default 'web',
  user_agent      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index booking_requests_status_idx  on public.booking_requests(status);
create index booking_requests_email_idx   on public.booking_requests(contact_email);
create index booking_requests_created_idx on public.booking_requests(created_at desc);

create trigger booking_requests_set_updated_at
  before update on public.booking_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: admin read/update only. Inserts happen via the service role from
-- the Server Action, which bypasses RLS by design.
-- ---------------------------------------------------------------------------
alter table public.booking_requests enable row level security;

create policy "booking_requests: admin read"
  on public.booking_requests for select
  using (public.is_admin());

create policy "booking_requests: admin update"
  on public.booking_requests for update
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- End supabase/migrations/0002_booking_requests.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0003_iguide.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 4: iGuide integration
--
-- Adds the minimum schema needed to associate an iGuide tour with one of
-- our bookings and to record an embeddable iframe snippet on each
-- deliverable so the realtor portal can render them inline.
-- ============================================================================

-- The iGuide URL slug for this booking, e.g. '1044_rest_acres_rd_brant_on'.
-- Nullable because it's set after the shoot is captured + uploaded.
-- Indexed because the webhook handler does `where iguide_id = $1` on every
-- incoming `ready` event.
alter table public.bookings
  add column if not exists iguide_id text;

create unique index if not exists bookings_iguide_id_key
  on public.bookings(iguide_id)
  where iguide_id is not null;

-- ============================================================================
-- End supabase/migrations/0003_iguide.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0004_calendar.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 8: private calendar / availability
--
-- Models the two inputs to the availability calculation:
--   1. `business_hours` — weekly recurring working windows
--   2. `calendar_blocks` — ad-hoc busy periods (vacation, personal appts,
--      holidays, etc.)
--
-- The actual "what slots are free?" computation runs server-side in
-- lib/booking/availability.ts — we intentionally *don't* expose raw blocks
-- to realtors (block labels can be private) and we subtract existing
-- confirmed bookings from the same calculation so realtors only ever see
-- "available" or "unavailable" per slot, never other clients' details.
--
-- No cross-shoot buffer is modeled here because shoot durations already
-- include drive + prep time per the photographer's service catalog.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- business_hours  — one row per day of week
-- day_of_week follows Postgres' extract(dow): 0 = Sunday, 6 = Saturday
-- ---------------------------------------------------------------------------
create table public.business_hours (
  day_of_week int primary key check (day_of_week between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  check (end_time > start_time)
);

create trigger business_hours_set_updated_at
  before update on public.business_hours
  for each row execute function public.set_updated_at();

-- Seed Mon–Fri 9–5, weekends off. Admin can edit via /admin/settings/availability.
insert into public.business_hours (day_of_week, start_time, end_time, enabled)
values
  (0, '09:00', '17:00', false),  -- Sunday
  (1, '09:00', '17:00', true),   -- Monday
  (2, '09:00', '17:00', true),   -- Tuesday
  (3, '09:00', '17:00', true),   -- Wednesday
  (4, '09:00', '17:00', true),   -- Thursday
  (5, '09:00', '17:00', true),   -- Friday
  (6, '09:00', '17:00', false)   -- Saturday
on conflict (day_of_week) do nothing;

-- ---------------------------------------------------------------------------
-- calendar_blocks  — ad-hoc busy periods
-- ---------------------------------------------------------------------------
create table public.calendar_blocks (
  id          uuid primary key default gen_random_uuid(),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  label       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index calendar_blocks_starts_idx on public.calendar_blocks(starts_at);
create index calendar_blocks_ends_idx   on public.calendar_blocks(ends_at);

create trigger calendar_blocks_set_updated_at
  before update on public.calendar_blocks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- business_hours: any authenticated user can read (realtors need it to know
-- when you're open for bookings). Admin-only write.
--
-- calendar_blocks: admin-only read AND write. Labels may contain personal
-- context ("doctor appointment", "kid pickup") that realtors shouldn't
-- see. The server computes availability using the service-role client so
-- block data never reaches the browser.
-- ---------------------------------------------------------------------------
alter table public.business_hours  enable row level security;
alter table public.calendar_blocks enable row level security;

create policy "business_hours: authenticated read"
  on public.business_hours for select
  to authenticated
  using (true);

create policy "business_hours: admin write"
  on public.business_hours for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "calendar_blocks: admin read"
  on public.calendar_blocks for select
  using (public.is_admin());

create policy "calendar_blocks: admin write"
  on public.calendar_blocks for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- End supabase/migrations/0004_calendar.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0005_quickbooks.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 7: QuickBooks Online integration
--
-- Three additions:
--
-- 1. `quickbooks_connection` — singleton row holding the OAuth refresh
--    token + current access token + realm (company) id. One row only;
--    if the admin ever needs to reconnect, we overwrite it in place.
--
-- 2. `service_prices` — a small lookup of service_id → price in cents.
--    Prices live in the DB rather than in code so the admin can edit
--    them in /admin/settings/pricing without a deploy.
--
-- 3. Invoice tracking columns on `bookings` — what invoice (if any) did
--    we create in QB for this shoot, what's its status, and the link
--    we can email the realtor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- quickbooks_connection (singleton)
-- ---------------------------------------------------------------------------
create table public.quickbooks_connection (
  -- Hardcoded primary key: there's only ever one QB connection per
  -- install. Using a fixed id lets us use .upsert() without worrying
  -- about stale rows.
  id                         int primary key default 1 check (id = 1),
  environment                text not null check (environment in ('sandbox','production')),
  realm_id                   text not null,
  refresh_token              text not null,
  access_token               text,
  access_token_expires_at    timestamptz,
  default_item_id            text,  -- QB Item (Service) used as the line-item ref
  connected_at               timestamptz not null default now(),
  connected_by               uuid references public.profiles(id) on delete set null,
  updated_at                 timestamptz not null default now()
);

create trigger quickbooks_connection_set_updated_at
  before update on public.quickbooks_connection
  for each row execute function public.set_updated_at();

-- RLS: admin-only. Server-side code uses the service role and bypasses
-- this anyway, but we gate the table hard because refresh_token is a
-- long-lived credential.
alter table public.quickbooks_connection enable row level security;

create policy "quickbooks_connection: admin read"
  on public.quickbooks_connection for select
  using (public.is_admin());

create policy "quickbooks_connection: admin write"
  on public.quickbooks_connection for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- service_prices
-- ---------------------------------------------------------------------------
create table public.service_prices (
  -- service_id matches lib/booking/services.ts (ServiceId | AddOnId). We
  -- deliberately don't FK-enforce against an enum here because the
  -- catalog lives in app code and can evolve faster than migrations.
  service_id      text primary key,
  price_cents     int not null default 0 check (price_cents >= 0),
  taxable         boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null
);

create trigger service_prices_set_updated_at
  before update on public.service_prices
  for each row execute function public.set_updated_at();

alter table public.service_prices enable row level security;

-- Any signed-in user can read prices (harmless — they'd see them on the
-- booking form anyway in a future phase). Only admins can write.
create policy "service_prices: authenticated read"
  on public.service_prices for select
  to authenticated
  using (true);

create policy "service_prices: admin write"
  on public.service_prices for all
  using (public.is_admin())
  with check (public.is_admin());

-- Seed every service + add-on from the current catalog with price = 0 so
-- the admin UI has rows to populate. Real prices are set in the admin
-- pricing page before the first invoice is created.
insert into public.service_prices (service_id, price_cents) values
  ('real_estate_photos', 0),
  ('iguide_tour',        0),
  ('floor_plan',         0),
  ('drone',              0),
  ('walkthrough_video',  0),
  ('twilight',           0),
  ('virtual_staging',    0),
  ('rush_24h',           0)
on conflict (service_id) do nothing;

-- ---------------------------------------------------------------------------
-- Invoice tracking on bookings
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists quickbooks_invoice_id          text,
  add column if not exists quickbooks_invoice_number      text,
  add column if not exists quickbooks_invoice_url         text,
  add column if not exists quickbooks_invoice_status      text,
  add column if not exists quickbooks_invoice_total_cents int,
  add column if not exists quickbooks_invoice_synced_at   timestamptz;

-- Uniqueness so re-running "Create invoice" on the same booking can't
-- accidentally duplicate the invoice in QB (the app-level code also
-- short-circuits, but this is a safety net).
create unique index if not exists bookings_qb_invoice_id_key
  on public.bookings(quickbooks_invoice_id)
  where quickbooks_invoice_id is not null;

-- ============================================================================
-- End supabase/migrations/0005_quickbooks.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0006_fotello.sql
-- ============================================================================

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

-- ============================================================================
-- End supabase/migrations/0006_fotello.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0007_iguide_portal_api.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — iGuide Portal API (Phase 4b)
--
-- When we first wired up iGuide we only knew the URL slug (the "alias":
-- e.g. `1044_rest_acres_rd_brant_on`), so `bookings.iguide_id` stores that.
-- The real Portal API speaks in terms of an *immutable* ID (e.g.
-- `igYGFV5GG6V8DD1`) that never changes even if the realtor renames or
-- re-slugs the tour.
--
-- This migration adds `iguide_portal_id` for that immutable handle. The
-- ready-event webhook populates it automatically; the manual paste flow
-- can still work off the alias alone.
-- ============================================================================

alter table public.bookings
  add column if not exists iguide_portal_id text;

create unique index if not exists bookings_iguide_portal_id_key
  on public.bookings(iguide_portal_id)
  where iguide_portal_id is not null;

comment on column public.bookings.iguide_id is
  'iGuide URL alias (slug). Mutable — set on paste or webhook.';

comment on column public.bookings.iguide_portal_id is
  'Immutable iGuide Portal ID (e.g. igYGFV5GG6V8DD1). Set by the ready webhook; required for Portal API calls.';

-- ============================================================================
-- End supabase/migrations/0007_iguide_portal_api.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0008_catalog.sql
-- ============================================================================

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

-- ============================================================================
-- End supabase/migrations/0008_catalog.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0009_request_cart.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 9: Cart on booking_requests
--
-- The /book form (and /portal/book) now write an ordered cart of catalog
-- items + quantities alongside the legacy services[] / add_ons[] arrays.
-- Storing it as JSON lets us capture a-la-carte quantities (e.g. 2x
-- Interior Retakes) without introducing another child table.
--
-- Shape: [{ "catalog_item_id": "uuid", "slug": "blue_print", "quantity": 1 }]
--
-- The slug is denormalized for display-without-a-join in the admin inbox.
-- The id is the source of truth for pricing + duration lookups.
-- ============================================================================

alter table public.booking_requests
  add column if not exists cart jsonb not null default '[]'::jsonb;

-- ============================================================================
-- End supabase/migrations/0009_request_cart.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0010_google_calendar.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 10: Google Calendar integration
--
-- Two additions:
--
-- 1. `google_calendar_connection` — singleton row holding the OAuth refresh
--    token (+ cached access token) for the admin's Google Calendar. Same
--    pattern as quickbooks_connection. One row only.
--
-- 2. Calendar-event tracking columns on `bookings` — when we push a new
--    booking onto your calendar, we remember Google's event id + html link
--    so we can update or delete it later (e.g. on cancellation).
-- ============================================================================

create table public.google_calendar_connection (
  -- Hardcoded pk: one connection per install.
  id                       int primary key default 1 check (id = 1),
  -- The Google account whose calendar we're reading + writing. Kept for
  -- display in the admin UI (so you can tell if you've connected the
  -- wrong account by accident).
  google_account_email     text not null,
  -- Calendar id we read free/busy from and write events to. Defaults to
  -- "primary" which resolves to the signed-in user's main calendar.
  calendar_id              text not null default 'primary',
  refresh_token            text not null,
  access_token             text,
  access_token_expires_at  timestamptz,
  connected_at             timestamptz not null default now(),
  connected_by             uuid references public.profiles(id) on delete set null,
  updated_at               timestamptz not null default now()
);

create trigger google_calendar_connection_set_updated_at
  before update on public.google_calendar_connection
  for each row execute function public.set_updated_at();

-- RLS: admin-only. Server-side code uses the service role and bypasses
-- this anyway, but we gate hard because the refresh token is a long-
-- lived credential for your calendar.
alter table public.google_calendar_connection enable row level security;

create policy "google_calendar_connection: admin read"
  on public.google_calendar_connection for select
  using (public.is_admin());

create policy "google_calendar_connection: admin write"
  on public.google_calendar_connection for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Event tracking on bookings
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists google_calendar_event_id   text,
  add column if not exists google_calendar_event_url  text;

-- ============================================================================
-- End supabase/migrations/0010_google_calendar.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0011_booking_property_details.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 11: property details on bookings
-- ----------------------------------------------------------------------------
-- Adds the wizard-flow property fields the realtor fills in at booking time:
--   - unit_number        — suite / apt number, stored separately from the
--                          street address so admin can sort / display cleanly
--   - is_vacant          — 'vacant' | 'occupied' | 'partial' | null
--                          (null = not asked; we leave the pre-wizard rows
--                          untouched rather than backfilling)
--   - include_basement   — whether the realtor wants the basement shot
--
-- square_footage already exists on bookings (migration 0001), so no change
-- to that column.
-- ============================================================================

alter table public.bookings
  add column if not exists unit_number      text,
  add column if not exists is_vacant        text,
  add column if not exists include_basement boolean;

-- Enforce the allowed is_vacant values at the DB level. text + check is
-- simpler than an enum (easier to evolve later without a migration dance).
alter table public.bookings
  drop constraint if exists bookings_is_vacant_check;
alter table public.bookings
  add constraint bookings_is_vacant_check
  check (is_vacant is null or is_vacant in ('vacant', 'occupied', 'partial'));

comment on column public.bookings.unit_number      is 'Suite / apt number; separate from street_address on properties.';
comment on column public.bookings.is_vacant        is 'vacant | occupied | partial. Null for pre-wizard bookings.';
comment on column public.bookings.include_basement is 'Whether the realtor wants the basement included in the shoot.';

-- ============================================================================
-- End supabase/migrations/0011_booking_property_details.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0012_integration_credentials.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 12: integration_credentials
-- ----------------------------------------------------------------------------
-- DB-managed home for static API credentials so the admin can rotate keys
-- without a Vercel env var dance + redeploy. Per-provider row holds an
-- opaque jsonb object; the runtime helper (lib/integrations/credentials.ts)
-- prefers the DB value but falls back to the matching env var when the row
-- is missing — so existing setups keep working until each key is migrated
-- through the admin UI.
--
-- Multi-tenant note: when we eventually make the booking system SaaS, this
-- table is one of the first to gain a tenant_id column + RLS policy on
-- it. The shape here (provider PK) keeps single-tenant simple while
-- leaving room for that evolution.
-- ============================================================================

create table public.integration_credentials (
  provider     text primary key,
  credentials  jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null
);

create trigger integration_credentials_set_updated_at
  before update on public.integration_credentials
  for each row execute function public.set_updated_at();

alter table public.integration_credentials enable row level security;

-- Admin-only — both reads and writes. Realtors should never have a way
-- to even see whether a credential is set. The runtime path uses the
-- service-role client so this RLS doesn't get in its own way.
create policy "integration_credentials: admin read"
  on public.integration_credentials for select
  using (public.is_admin());

create policy "integration_credentials: admin write"
  on public.integration_credentials for all
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.integration_credentials is
  'Per-provider API credentials editable from /admin/settings/integrations. JSONB shape varies by provider (e.g. {api_key: "..."} for Fotello, {app_id: "...", app_token: "...", webhook_secret: "..."} for iGuide).';

-- ============================================================================
-- End supabase/migrations/0012_integration_credentials.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0012_spiro_inspired_catalog_merchandising.sql
-- ============================================================================

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

-- ============================================================================
-- End supabase/migrations/0012_spiro_inspired_catalog_merchandising.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0013_booking_overlap_guard.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 13: transactional booking overlap guard
-- ----------------------------------------------------------------------------
-- The app already re-checks availability immediately before inserting a booking,
-- but that check and the insert were not one atomic operation. This migration
-- stores each booking's computed end time and lets Postgres reject overlapping
-- active bookings even when two submissions race.
-- ============================================================================

create extension if not exists btree_gist;

alter table public.bookings
  add column if not exists scheduled_ends_at timestamptz;

-- Conservative backfill for older rows whose exact catalog duration was not
-- snapshotted. New writes set scheduled_ends_at from the live catalog duration.
update public.bookings
set scheduled_ends_at = scheduled_at + interval '60 minutes'
where scheduled_at is not null
  and scheduled_ends_at is null;

alter table public.bookings
  drop constraint if exists bookings_schedule_order_check;

alter table public.bookings
  add constraint bookings_schedule_order_check
  check (
    scheduled_at is null
    or scheduled_ends_at is null
    or scheduled_ends_at > scheduled_at
  );

create index if not exists bookings_scheduled_ends_idx
  on public.bookings(scheduled_ends_at);

alter table public.bookings
  drop constraint if exists bookings_active_schedule_no_overlap;

alter table public.bookings
  add constraint bookings_active_schedule_no_overlap
  exclude using gist (
    tstzrange(scheduled_at, scheduled_ends_at, '[)') with &&
  )
  where (
    status in ('requested', 'confirmed', 'shot', 'editing', 'delivered')
    and scheduled_at is not null
    and scheduled_ends_at is not null
  );

-- ============================================================================
-- End supabase/migrations/0013_booking_overlap_guard.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0014_iguide_jobs_and_webhook_events.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — iGUIDE jobs + webhook event inbox
--
-- Jobs track iGUIDEs we create from a booking, which gives the webhook an
-- exact immutable match later. Webhook events keep portal-created iGUIDEs from
-- disappearing when they cannot be matched safely on first delivery.
-- ============================================================================

create table if not exists public.iguide_jobs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  iguide_id text not null,
  alias text,
  work_order_id text,
  default_view_id text,
  status text not null default 'created',
  match_source text not null default 'booking_created',
  raw_create_response jsonb not null default '{}'::jsonb,
  raw_ready_event jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists iguide_jobs_iguide_id_key
  on public.iguide_jobs(iguide_id);

create unique index if not exists iguide_jobs_booking_id_key
  on public.iguide_jobs(booking_id);

create index if not exists iguide_jobs_work_order_idx
  on public.iguide_jobs(work_order_id)
  where work_order_id is not null;

drop trigger if exists iguide_jobs_set_updated_at on public.iguide_jobs;
create trigger iguide_jobs_set_updated_at
  before update on public.iguide_jobs
  for each row execute function public.set_updated_at();

alter table public.iguide_jobs enable row level security;

drop policy if exists "iguide_jobs: admin read" on public.iguide_jobs;
create policy "iguide_jobs: admin read"
  on public.iguide_jobs for select
  using (public.is_admin());

drop policy if exists "iguide_jobs: admin write" on public.iguide_jobs;
create policy "iguide_jobs: admin write"
  on public.iguide_jobs for all
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.iguide_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  iguide_id text not null,
  work_order_id text,
  alias text,
  payload_json jsonb not null default '{}'::jsonb,
  match_status text not null default 'unmatched',
  matched_booking_id uuid references public.bookings(id) on delete set null,
  match_source text,
  processed_at timestamptz,
  last_error text,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists iguide_webhook_events_dedupe_key
  on public.iguide_webhook_events(
    event_type,
    iguide_id,
    (coalesce(work_order_id, ''))
  );

create index if not exists iguide_webhook_events_match_status_idx
  on public.iguide_webhook_events(match_status);

drop trigger if exists iguide_webhook_events_set_updated_at on public.iguide_webhook_events;
create trigger iguide_webhook_events_set_updated_at
  before update on public.iguide_webhook_events
  for each row execute function public.set_updated_at();

alter table public.iguide_webhook_events enable row level security;

drop policy if exists "iguide_webhook_events: admin read" on public.iguide_webhook_events;
create policy "iguide_webhook_events: admin read"
  on public.iguide_webhook_events for select
  using (public.is_admin());

drop policy if exists "iguide_webhook_events: admin write" on public.iguide_webhook_events;
create policy "iguide_webhook_events: admin write"
  on public.iguide_webhook_events for all
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.iguide_jobs is
  'iGUIDE Portal jobs tied to bookings. Used for exact webhook matching and work-order tracking.';

comment on table public.iguide_webhook_events is
  'Raw iGUIDE webhook inbox. Unmatched portal-created tours stay here for review instead of being dropped.';

-- ============================================================================
-- End supabase/migrations/0014_iguide_jobs_and_webhook_events.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0015_booking_notifications.sql
-- ============================================================================

-- ============================================================================
-- Booking notification log
--
-- Tracks one-off emails sent for a booking so admin actions and future cron
-- jobs can be idempotent.
-- ============================================================================

create table if not exists public.booking_notifications (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  recipient_email text not null,
  unique (booking_id, kind, recipient_email)
);

alter table public.booking_notifications enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'booking_notifications'
      and policyname = 'booking_notifications_admin_all'
  ) then
    create policy "booking_notifications_admin_all"
      on public.booking_notifications
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

-- ============================================================================
-- End supabase/migrations/0015_booking_notifications.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0016_catalog_sqft_pricing.sql
-- ============================================================================

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

-- ============================================================================
-- End supabase/migrations/0016_catalog_sqft_pricing.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0017_catalog_media_badges.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — catalog media badges
--
-- Adds a simple photo flag to match the existing video flag so package cards
-- can show clear "Photos" / "Video" badges in the booking flow.
-- ============================================================================

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
);

-- ============================================================================
-- End supabase/migrations/0017_catalog_media_badges.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0018_property_archive.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — realtor listing archive
--
-- Lets realtors hide old listings from their portal without deleting media,
-- bookings, invoices, or delivery history.
-- ============================================================================

alter table public.properties
  add column if not exists archived_at timestamptz;

create index if not exists properties_owner_archived_idx
  on public.properties(owner_id, archived_at);

-- ============================================================================
-- End supabase/migrations/0018_property_archive.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0019_listing_websites.sql
-- ============================================================================

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

-- ============================================================================
-- End supabase/migrations/0019_listing_websites.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0020_listing_website_sections.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — listing website included sections
-- ============================================================================

alter table public.listing_websites
  add column if not exists included_sections text[] not null default
    '{photos,tour,floor_plans,video,property_websites}'::text[];

-- ============================================================================
-- End supabase/migrations/0020_listing_website_sections.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0021_listing_website_gallery_selection.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — listing website gallery photo selection
-- ============================================================================

alter table public.listing_websites
  add column if not exists gallery_image_urls text[];

-- ============================================================================
-- End supabase/migrations/0021_listing_website_gallery_selection.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0022_realtor_profile_media.sql
-- ============================================================================

-- Pixel Blaster Booking — admin-managed realtor profile media
-- Adds public profile media fields and a small public Storage bucket for
-- headshots/logos. Writes happen server-side through admin-only actions.

alter table public.profiles
  add column if not exists profile_photo_url text,
  add column if not exists brokerage_logo_url text,
  add column if not exists website_url text,
  add column if not exists instagram_url text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-media',
  'profile-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================================
-- End supabase/migrations/0022_realtor_profile_media.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0023_realtor_delivery_cc_emails.sql
-- ============================================================================

-- Pixel Blaster Booking — account-level delivery CC recipients
-- Admins can store teammate/assistant emails on a realtor profile so every
-- delivery email automatically copies the right people.

alter table public.profiles
  add column if not exists delivery_cc_emails text[] not null default '{}';

-- ============================================================================
-- End supabase/migrations/0023_realtor_delivery_cc_emails.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0024_saas_calendar_foundation.sql
-- ============================================================================

-- ============================================================================
-- SaaS foundation: default organization + organization-scoped calendar
-- ----------------------------------------------------------------------------
-- Pixel Blaster remains the first/default tenant, but integrations should not
-- stay hard-coded as one global connection forever. This migration creates a
-- default organization and scopes Google Calendar connections to it while
-- keeping existing rows working.
-- ============================================================================

create table if not exists public.organizations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,
  primary_color     text,
  accent_color      text,
  logo_url          text,
  booking_hero_image_url text,
  booking_hero_secondary_image_url text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;

drop policy if exists "organizations: admin read" on public.organizations;
create policy "organizations: admin read"
  on public.organizations for select
  using (public.is_admin());

drop policy if exists "organizations: admin write" on public.organizations;
create policy "organizations: admin write"
  on public.organizations for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.organizations (id, name, slug, primary_color, accent_color)
values (
  '00000000-0000-0000-0000-000000000001',
  'Pixel Blaster Media',
  'pixel-blaster',
  '#3f7f5f',
  '#c9a35b'
)
on conflict (id) do update
set
  name = excluded.name,
  slug = excluded.slug,
  updated_at = now();

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  role            text not null default 'member'
                  check (role in ('owner', 'admin', 'member')),
  created_at      timestamptz not null default now(),
  primary key (organization_id, profile_id)
);

alter table public.organization_members enable row level security;

drop policy if exists "organization_members: self or admin read" on public.organization_members;
create policy "organization_members: self or admin read"
  on public.organization_members for select
  using (profile_id = auth.uid() or public.is_admin());

drop policy if exists "organization_members: admin write" on public.organization_members;
create policy "organization_members: admin write"
  on public.organization_members for all
  using (public.is_admin())
  with check (public.is_admin());

alter table public.profiles
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict;

update public.profiles
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.profiles
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists profiles_organization_idx
  on public.profiles(organization_id);

insert into public.organization_members (organization_id, profile_id, role)
select
  '00000000-0000-0000-0000-000000000001',
  id,
  case when role = 'admin' then 'admin' else 'member' end
from public.profiles
on conflict (organization_id, profile_id) do update
set role = excluded.role;

create or replace function public.sync_profile_organization_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is not null then
    insert into public.organization_members (organization_id, profile_id, role)
    values (
      new.organization_id,
      new.id,
      case when new.role = 'admin' then 'admin' else 'member' end
    )
    on conflict (organization_id, profile_id) do update
    set role = excluded.role;
  end if;

  if old.organization_id is not null
     and old.organization_id is distinct from new.organization_id then
    delete from public.organization_members
    where organization_id = old.organization_id
      and profile_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_profile_organization_membership()
  from public, anon, authenticated;

drop trigger if exists profiles_sync_organization_membership on public.profiles;
create trigger profiles_sync_organization_membership
  after insert or update of organization_id, role on public.profiles
  for each row execute function public.sync_profile_organization_membership();

alter table public.properties
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict;

update public.properties
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.properties
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists properties_organization_idx
  on public.properties(organization_id);

alter table public.bookings
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict;

update public.bookings
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.bookings
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists bookings_organization_idx
  on public.bookings(organization_id);

alter table public.google_calendar_connection
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.google_calendar_connection
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.google_calendar_connection
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.google_calendar_connection
    drop constraint if exists google_calendar_connection_id_check;
end $$;

create sequence if not exists public.google_calendar_connection_id_seq;

select setval(
  'public.google_calendar_connection_id_seq',
  greatest(
    1,
    coalesce((select max(id) from public.google_calendar_connection), 1)
  ),
  true
);

alter table public.google_calendar_connection
  alter column id set default nextval('public.google_calendar_connection_id_seq');

alter sequence public.google_calendar_connection_id_seq
  owned by public.google_calendar_connection.id;

create unique index if not exists google_calendar_connection_org_idx
  on public.google_calendar_connection(organization_id);

comment on table public.organizations is
  'SaaS tenant/business record. Pixel Blaster is the default first organization.';

comment on column public.google_calendar_connection.organization_id is
  'Organization/business that owns this Google Calendar OAuth connection.';

-- ============================================================================
-- End supabase/migrations/0024_saas_calendar_foundation.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0025_saas_tenant_isolation.sql
-- ============================================================================

-- ============================================================================
-- SaaS tenant isolation hardening
-- ----------------------------------------------------------------------------
-- 0024 created the first organization and scoped the largest records. This
-- migration continues that work by scoping operational settings, catalog,
-- credentials, and integration connections to an organization, then tightens
-- RLS so future company admins cannot see or edit another company's data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

create or replace function public.is_organization_admin(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.profile_id = auth.uid()
      and om.organization_id = target_org_id
      and om.role in ('owner', 'admin')
  );
$$;

revoke all on function public.current_organization_id()
  from public, anon, authenticated;
grant execute on function public.current_organization_id()
  to authenticated;

revoke all on function public.is_organization_admin(uuid)
  from public, anon, authenticated;
grant execute on function public.is_organization_admin(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Add organization_id to tenant-owned tables that were still single-business.
-- ---------------------------------------------------------------------------
alter table public.business_hours
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.business_hours
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.business_hours
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.business_hours
    drop constraint if exists business_hours_pkey;
end $$;

alter table public.business_hours
  add constraint business_hours_pkey primary key (organization_id, day_of_week);

alter table public.calendar_blocks
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.calendar_blocks
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.calendar_blocks
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists calendar_blocks_organization_idx
  on public.calendar_blocks(organization_id);

alter table public.catalog_items
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.catalog_items
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.catalog_items
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.catalog_items
    drop constraint if exists catalog_items_slug_key;
end $$;

create unique index if not exists catalog_items_org_slug_idx
  on public.catalog_items(organization_id, slug);

create index if not exists catalog_items_organization_idx
  on public.catalog_items(organization_id);

alter table public.integration_credentials
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.integration_credentials
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.integration_credentials
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.integration_credentials
    drop constraint if exists integration_credentials_pkey;
end $$;

alter table public.integration_credentials
  add constraint integration_credentials_pkey
  primary key (organization_id, provider);

alter table public.quickbooks_connection
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.quickbooks_connection
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.quickbooks_connection
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.quickbooks_connection
    drop constraint if exists quickbooks_connection_id_check;
end $$;

create sequence if not exists public.quickbooks_connection_id_seq;

select setval(
  'public.quickbooks_connection_id_seq',
  greatest(
    1,
    coalesce((select max(id) from public.quickbooks_connection), 1)
  ),
  true
);

alter table public.quickbooks_connection
  alter column id set default nextval('public.quickbooks_connection_id_seq');

alter sequence public.quickbooks_connection_id_seq
  owned by public.quickbooks_connection.id;

create unique index if not exists quickbooks_connection_org_idx
  on public.quickbooks_connection(organization_id);

alter table public.service_prices
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.service_prices
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.service_prices
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.service_prices
    drop constraint if exists service_prices_pkey;
end $$;

alter table public.service_prices
  add constraint service_prices_pkey
  primary key (organization_id, service_id);

create index if not exists service_prices_organization_idx
  on public.service_prices(organization_id);

alter table public.booking_requests
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict;

update public.booking_requests
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.booking_requests
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists booking_requests_organization_idx
  on public.booking_requests(organization_id);

alter table public.listing_websites
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.listing_websites lw
set organization_id = p.organization_id
from public.properties p
where lw.property_id = p.id
  and lw.organization_id is null;

update public.listing_websites
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.listing_websites
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists listing_websites_organization_idx
  on public.listing_websites(organization_id);

-- ---------------------------------------------------------------------------
-- RLS: org-aware policies.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: self read" on public.profiles;
drop policy if exists "profiles: self update" on public.profiles;
drop policy if exists "profiles: admin update" on public.profiles;

create policy "profiles: self or org admin read"
  on public.profiles for select
  using (id = auth.uid() or public.is_organization_admin(organization_id));

create policy "profiles: self update"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and organization_id = public.current_organization_id()
  );

create policy "profiles: org admin update"
  on public.profiles for update
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "properties: owner read" on public.properties;
drop policy if exists "properties: owner write" on public.properties;
drop policy if exists "properties: owner update" on public.properties;

create policy "properties: owner or org admin read"
  on public.properties for select
  using (owner_id = auth.uid() or public.is_organization_admin(organization_id));

create policy "properties: owner or org admin insert"
  on public.properties for insert
  with check (
    (owner_id = auth.uid() and organization_id = public.current_organization_id())
    or public.is_organization_admin(organization_id)
  );

create policy "properties: owner or org admin update"
  on public.properties for update
  using (owner_id = auth.uid() or public.is_organization_admin(organization_id))
  with check (
    (owner_id = auth.uid() and organization_id = public.current_organization_id())
    or public.is_organization_admin(organization_id)
  );

drop policy if exists "bookings: owner read" on public.bookings;
drop policy if exists "bookings: owner insert" on public.bookings;
drop policy if exists "bookings: admin update" on public.bookings;

create policy "bookings: owner or org admin read"
  on public.bookings for select
  using (owner_id = auth.uid() or public.is_organization_admin(organization_id));

create policy "bookings: owner or org admin insert"
  on public.bookings for insert
  with check (
    (owner_id = auth.uid() and organization_id = public.current_organization_id())
    or public.is_organization_admin(organization_id)
  );

create policy "bookings: org admin update"
  on public.bookings for update
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "deliverables: owner read" on public.deliverables;
drop policy if exists "deliverables: admin write" on public.deliverables;

create policy "deliverables: owner or org admin read"
  on public.deliverables for select
  using (
    exists (
      select 1 from public.bookings b
      where b.id = deliverables.booking_id
        and (
          b.owner_id = auth.uid()
          or public.is_organization_admin(b.organization_id)
        )
    )
  );

create policy "deliverables: org admin write"
  on public.deliverables for all
  using (
    exists (
      select 1 from public.bookings b
      where b.id = deliverables.booking_id
        and public.is_organization_admin(b.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.bookings b
      where b.id = deliverables.booking_id
        and public.is_organization_admin(b.organization_id)
    )
  );

drop policy if exists "booking_line_items: owner or admin read"
  on public.booking_line_items;
drop policy if exists "booking_line_items: admin write"
  on public.booking_line_items;

create policy "booking_line_items: owner or org admin read"
  on public.booking_line_items for select
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_line_items.booking_id
        and (
          b.owner_id = auth.uid()
          or public.is_organization_admin(b.organization_id)
        )
    )
  );

create policy "booking_line_items: org admin write"
  on public.booking_line_items for all
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_line_items.booking_id
        and public.is_organization_admin(b.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.bookings b
      where b.id = booking_line_items.booking_id
        and public.is_organization_admin(b.organization_id)
    )
  );

drop policy if exists "business_hours: authenticated read"
  on public.business_hours;
drop policy if exists "business_hours: admin write"
  on public.business_hours;

create policy "business_hours: org read"
  on public.business_hours for select
  to authenticated
  using (
    organization_id = public.current_organization_id()
    or public.is_organization_admin(organization_id)
  );

create policy "business_hours: org admin write"
  on public.business_hours for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "calendar_blocks: admin read"
  on public.calendar_blocks;
drop policy if exists "calendar_blocks: admin write"
  on public.calendar_blocks;

create policy "calendar_blocks: org admin read"
  on public.calendar_blocks for select
  using (public.is_organization_admin(organization_id));

create policy "calendar_blocks: org admin write"
  on public.calendar_blocks for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "catalog_items: public read" on public.catalog_items;
drop policy if exists "catalog_items: admin write" on public.catalog_items;

create policy "catalog_items: public default read"
  on public.catalog_items for select
  using (organization_id = '00000000-0000-0000-0000-000000000001');

create policy "catalog_items: org admin write"
  on public.catalog_items for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "integration_credentials: admin read"
  on public.integration_credentials;
drop policy if exists "integration_credentials: admin write"
  on public.integration_credentials;

create policy "integration_credentials: org admin read"
  on public.integration_credentials for select
  using (public.is_organization_admin(organization_id));

create policy "integration_credentials: org admin write"
  on public.integration_credentials for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "quickbooks_connection: admin read"
  on public.quickbooks_connection;
drop policy if exists "quickbooks_connection: admin write"
  on public.quickbooks_connection;

create policy "quickbooks_connection: org admin read"
  on public.quickbooks_connection for select
  using (public.is_organization_admin(organization_id));

create policy "quickbooks_connection: org admin write"
  on public.quickbooks_connection for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "service_prices: authenticated read"
  on public.service_prices;
drop policy if exists "service_prices: admin write"
  on public.service_prices;

create policy "service_prices: org read"
  on public.service_prices for select
  to authenticated
  using (
    organization_id = public.current_organization_id()
    or public.is_organization_admin(organization_id)
  );

create policy "service_prices: org admin write"
  on public.service_prices for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "booking_requests: admin read"
  on public.booking_requests;
drop policy if exists "booking_requests: admin update"
  on public.booking_requests;

create policy "booking_requests: org admin read"
  on public.booking_requests for select
  using (public.is_organization_admin(organization_id));

create policy "booking_requests: org admin update"
  on public.booking_requests for update
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "listing_websites: public published read"
  on public.listing_websites;
drop policy if exists "listing_websites: owner insert"
  on public.listing_websites;
drop policy if exists "listing_websites: owner update"
  on public.listing_websites;

create policy "listing_websites: public published or scoped read"
  on public.listing_websites for select
  using (
    is_published = true
    or owner_id = auth.uid()
    or public.is_organization_admin(organization_id)
  );

create policy "listing_websites: owner or org admin insert"
  on public.listing_websites for insert
  with check (
    (owner_id = auth.uid() and organization_id = public.current_organization_id())
    or public.is_organization_admin(organization_id)
  );

create policy "listing_websites: owner or org admin update"
  on public.listing_websites for update
  using (owner_id = auth.uid() or public.is_organization_admin(organization_id))
  with check (
    (owner_id = auth.uid() and organization_id = public.current_organization_id())
    or public.is_organization_admin(organization_id)
  );

comment on function public.is_organization_admin(uuid) is
  'True when the current authenticated user is an owner/admin of the target organization.';

comment on column public.catalog_items.organization_id is
  'Organization/business that owns this booking catalog item.';

comment on column public.integration_credentials.organization_id is
  'Organization/business that owns this integration credential.';

-- ============================================================================
-- End supabase/migrations/0025_saas_tenant_isolation.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0027_realtor_internal_notes.sql
-- ============================================================================

-- Pixel Blaster Booking — private agent preference notes
-- Admin-only notes for realtor preferences, delivery reminders, and workflow
-- gotchas. These are intentionally internal and should not render in the
-- realtor portal or public listing pages.

alter table public.profiles
  add column if not exists internal_notes text;

-- ============================================================================
-- End supabase/migrations/0027_realtor_internal_notes.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0028_organization_email_settings.sql
-- ============================================================================

alter table public.organizations
  add column if not exists email_from_name text,
  add column if not exists reply_to_email text,
  add column if not exists admin_notification_email text;

update public.organizations
set email_from_name = coalesce(email_from_name, name)
where email_from_name is null;

comment on column public.organizations.email_from_name is
  'Display name used on outbound emails. The verified sender address still comes from EMAIL_FROM.';

comment on column public.organizations.reply_to_email is
  'Company inbox used as Reply-To for client-facing emails.';

comment on column public.organizations.admin_notification_email is
  'Company inbox that receives booking and cancellation notifications.';

-- ============================================================================
-- End supabase/migrations/0028_organization_email_settings.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0029_iguide_tenant_isolation.sql
-- ============================================================================

-- ============================================================================
-- iGUIDE tenant isolation
-- ----------------------------------------------------------------------------
-- The main SaaS tenant pass scoped bookings, properties, deliverables, catalog,
-- credentials, and calendars. These two iGUIDE operational tables were still
-- single-business tables, so org admins could see another company's iGUIDE
-- webhook inbox/jobs once a second organization existed.
-- ============================================================================

alter table public.iguide_jobs
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.iguide_jobs ij
set organization_id = b.organization_id
from public.bookings b
where ij.booking_id = b.id
  and ij.organization_id is null;

update public.iguide_jobs
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.iguide_jobs
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

drop index if exists public.iguide_jobs_iguide_id_key;

create unique index if not exists iguide_jobs_org_iguide_id_key
  on public.iguide_jobs(organization_id, iguide_id);

create index if not exists iguide_jobs_organization_idx
  on public.iguide_jobs(organization_id);

alter table public.iguide_webhook_events
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.iguide_webhook_events iwe
set organization_id = b.organization_id
from public.bookings b
where iwe.matched_booking_id = b.id
  and iwe.organization_id is null;

update public.iguide_webhook_events
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.iguide_webhook_events
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

drop index if exists public.iguide_webhook_events_dedupe_key;

create unique index if not exists iguide_webhook_events_org_dedupe_key
  on public.iguide_webhook_events(
    organization_id,
    event_type,
    iguide_id,
    (coalesce(work_order_id, ''))
  );

create index if not exists iguide_webhook_events_organization_idx
  on public.iguide_webhook_events(organization_id);

drop policy if exists "iguide_jobs: admin read" on public.iguide_jobs;
drop policy if exists "iguide_jobs: admin write" on public.iguide_jobs;

create policy "iguide_jobs: org admin read"
  on public.iguide_jobs for select
  using (public.is_organization_admin(organization_id));

create policy "iguide_jobs: org admin write"
  on public.iguide_jobs for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "iguide_webhook_events: admin read"
  on public.iguide_webhook_events;
drop policy if exists "iguide_webhook_events: admin write"
  on public.iguide_webhook_events;

create policy "iguide_webhook_events: org admin read"
  on public.iguide_webhook_events for select
  using (public.is_organization_admin(organization_id));

create policy "iguide_webhook_events: org admin write"
  on public.iguide_webhook_events for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

comment on column public.iguide_jobs.organization_id is
  'Organization/business that owns this iGUIDE job.';

comment on column public.iguide_webhook_events.organization_id is
  'Organization/business that owns this iGUIDE webhook event.';

-- ============================================================================
-- End supabase/migrations/0029_iguide_tenant_isolation.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0030_assistant_action_logs.sql
-- ============================================================================

-- ============================================================================
-- Pixel Assistant action audit log
-- ----------------------------------------------------------------------------
-- Confirmed assistant actions can now change bookings, pricing, availability,
-- and realtor memory. Keep a tenant-scoped record of what an admin approved.
-- ============================================================================

create table if not exists public.assistant_action_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  actor_profile_id uuid
    references public.profiles(id) on delete set null,
  action_type text not null,
  target_booking_id uuid
    references public.bookings(id) on delete set null,
  target_realtor_id uuid
    references public.profiles(id) on delete set null,
  label text not null default '',
  details text not null default '',
  payload jsonb not null default '{}'::jsonb,
  result_status text not null
    check (result_status in ('success', 'failed')),
  result_message text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists assistant_action_logs_org_created_idx
  on public.assistant_action_logs(organization_id, created_at desc);

create index if not exists assistant_action_logs_actor_idx
  on public.assistant_action_logs(actor_profile_id, created_at desc);

create index if not exists assistant_action_logs_booking_idx
  on public.assistant_action_logs(target_booking_id, created_at desc);

alter table public.assistant_action_logs enable row level security;

drop policy if exists "assistant_action_logs: org admin read"
  on public.assistant_action_logs;
drop policy if exists "assistant_action_logs: org admin insert"
  on public.assistant_action_logs;

create policy "assistant_action_logs: org admin read"
  on public.assistant_action_logs for select
  using (public.is_organization_admin(organization_id));

create policy "assistant_action_logs: org admin insert"
  on public.assistant_action_logs for insert
  with check (public.is_organization_admin(organization_id));

comment on table public.assistant_action_logs is
  'Tenant-scoped audit history of confirmed Pixel Assistant actions.';

-- ============================================================================
-- End supabase/migrations/0030_assistant_action_logs.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0031_assistant_action_undo.sql
-- ============================================================================

-- ============================================================================
-- Pixel Assistant undo support
-- ----------------------------------------------------------------------------
-- Store enough before-state for confirmed assistant actions to be reversed.
-- Existing log rows remain valid; only new reversible actions get undo payloads.
-- ============================================================================

alter table public.assistant_action_logs
  add column if not exists undo_payload jsonb,
  add column if not exists undone_at timestamptz,
  add column if not exists undone_by uuid
    references public.profiles(id) on delete set null,
  add column if not exists undo_result_message text;

create index if not exists assistant_action_logs_undone_idx
  on public.assistant_action_logs(organization_id, undone_at)
  where undo_payload is not null;

comment on column public.assistant_action_logs.undo_payload is
  'Reversible before-state for assistant actions that support undo.';

comment on column public.assistant_action_logs.undone_at is
  'Timestamp when this assistant action was reversed, if applicable.';

-- ============================================================================
-- End supabase/migrations/0031_assistant_action_undo.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0032_realtor_ai_memory.sql
-- ============================================================================

-- ============================================================================
-- Structured realtor memory
-- ----------------------------------------------------------------------------
-- Keep admin-controlled client preferences in a structured JSON object so the
-- booking concierge, daily brief, and Pixel Assistant can use them safely.
-- The column lives on profiles, so existing tenant-scoped profile RLS applies.
-- ============================================================================

alter table public.profiles
  add column if not exists ai_memory jsonb not null default '{}'::jsonb;

comment on column public.profiles.ai_memory is
  'Admin-managed structured realtor preferences used by AI booking and workflow assistants.';

-- ============================================================================
-- End supabase/migrations/0032_realtor_ai_memory.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0033_ai_operator_guardrails.sql
-- ============================================================================

-- ============================================================================
-- AI operator guardrails
-- ----------------------------------------------------------------------------
-- Before Telegram/AI can safely act on bookings, the app needs:
--   - transactional booking acceptance for the core request -> booking write
--   - explicit notification delivery state
--   - a secure Telegram identity mapping table
-- Existing assistant_action_logs already records approved assistant actions.
-- ============================================================================

alter table public.booking_notifications
  add column if not exists status text not null default 'sent',
  add column if not exists provider_message_id text,
  add column if not exists error text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.booking_notifications
  drop constraint if exists booking_notifications_status_check;

alter table public.booking_notifications
  add constraint booking_notifications_status_check
  check (status in ('sent', 'skipped', 'failed'));

create index if not exists booking_notifications_status_idx
  on public.booking_notifications(status, sent_at desc);

create table if not exists public.telegram_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  profile_id uuid not null
    references public.profiles(id) on delete cascade,
  telegram_chat_id bigint,
  telegram_user_id bigint,
  username text,
  first_name text,
  last_name text,
  connect_token_hash text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists telegram_connections_active_profile_idx
  on public.telegram_connections(organization_id, profile_id)
  where revoked_at is null;

create unique index if not exists telegram_connections_active_chat_idx
  on public.telegram_connections(telegram_chat_id)
  where telegram_chat_id is not null and revoked_at is null;

create index if not exists telegram_connections_org_idx
  on public.telegram_connections(organization_id, connected_at desc);

drop trigger if exists telegram_connections_set_updated_at
  on public.telegram_connections;
create trigger telegram_connections_set_updated_at
  before update on public.telegram_connections
  for each row execute function public.set_updated_at();

alter table public.telegram_connections enable row level security;

grant select, insert, update, delete on public.telegram_connections to authenticated;

drop policy if exists "telegram_connections: owner read"
  on public.telegram_connections;
drop policy if exists "telegram_connections: org admin all"
  on public.telegram_connections;

create policy "telegram_connections: owner read"
  on public.telegram_connections for select
  using (
    profile_id = auth.uid()
    or public.is_organization_admin(organization_id)
  );

create policy "telegram_connections: org admin all"
  on public.telegram_connections for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

create or replace function public.create_booking_from_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_owner_id uuid,
  p_scheduled_at timestamptz,
  p_scheduled_ends_at timestamptz
)
returns uuid
language plpgsql
as $$
declare
  req public.booking_requests%rowtype;
  new_property_id uuid;
  new_booking_id uuid;
begin
  select *
    into req
    from public.booking_requests
    where id = p_request_id
      and organization_id = p_organization_id
    for update;

  if not found then
    raise exception 'Booking request not found'
      using errcode = 'P0002';
  end if;

  if req.status = 'accepted' then
    raise exception 'Booking request already accepted'
      using errcode = 'P0001';
  end if;

  update public.profiles
    set organization_id = p_organization_id,
        full_name = req.contact_name,
        phone = req.contact_phone,
        brokerage = req.brokerage
    where id = p_owner_id;

  insert into public.properties (
    organization_id,
    owner_id,
    street_address,
    city,
    province,
    postal_code
  ) values (
    p_organization_id,
    p_owner_id,
    req.street_address,
    req.city,
    coalesce(req.province, 'ON'),
    req.postal_code
  )
  returning id into new_property_id;

  insert into public.bookings (
    organization_id,
    property_id,
    owner_id,
    status,
    scheduled_at,
    scheduled_ends_at,
    services,
    add_ons,
    square_footage,
    client_notes
  ) values (
    p_organization_id,
    new_property_id,
    p_owner_id,
    'confirmed',
    p_scheduled_at,
    p_scheduled_ends_at,
    req.services,
    req.add_ons,
    req.square_footage,
    req.notes
  )
  returning id into new_booking_id;

  update public.booking_requests
    set status = 'accepted',
        booking_id = new_booking_id
    where id = p_request_id
      and organization_id = p_organization_id;

  return new_booking_id;
end;
$$;

revoke all on function public.create_booking_from_request(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.create_booking_from_request(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
) to service_role;

comment on table public.telegram_connections is
  'Tenant-scoped mapping between a photographer profile and their Telegram chat.';

comment on function public.create_booking_from_request(uuid, uuid, uuid, timestamptz, timestamptz) is
  'Atomically promotes a booking_request into property + confirmed booking + accepted request link.';

-- ============================================================================
-- End supabase/migrations/0033_ai_operator_guardrails.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0034_realtor_alternate_phones.sql
-- ============================================================================

-- Allow a realtor profile to match more than one phone number.
alter table public.profiles
  add column if not exists alternate_phones text[] not null default '{}';

comment on column public.profiles.alternate_phones is
  'Additional phone numbers that can identify this realtor during public booking lookup.';

-- ============================================================================
-- End supabase/migrations/0034_realtor_alternate_phones.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/0035_realtor_archive.sql
-- ============================================================================

-- ============================================================================
-- Realtor archive / remove from active list
-- ----------------------------------------------------------------------------
-- Keep booking, property, listing, and delivery history intact while letting an
-- organization remove a realtor from active admin lists and portal access.
-- ============================================================================

alter table public.profiles
  add column if not exists archived_at timestamptz;

create index if not exists profiles_org_role_active_idx
  on public.profiles(organization_id, role, full_name, email)
  where archived_at is null;

comment on column public.profiles.archived_at is
  'Soft-delete marker for realtor profiles removed from active use. Historical bookings remain attached.';

-- ============================================================================
-- End supabase/migrations/0035_realtor_archive.sql
-- ============================================================================
