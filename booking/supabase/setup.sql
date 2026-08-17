-- ============================================================================
-- Pixel Booking — one-paste Supabase setup
--
-- Generated from the pre-ledger bootstrap history plus canonical migrations
-- from version 20260716141227 onward. The production migration directory
-- mirrors the linked production ledger; bootstrap-migrations exists only to
-- reconstruct fresh projects whose original schema predates that ledger.
--
-- First-time use:
--   1. Paste this whole file into the Supabase SQL Editor.
--   2. Run it once on an empty project database.
--   3. Disable public Auth signup before exposing the project.
--   4. Follow docs/auth-rollout.md and run the guarded first-company bootstrap.
--
-- Do not run this against a live database that already has user/customer data.
-- Apply only new files from supabase/migrations/ to linked production.
-- ============================================================================


-- ============================================================================
-- Begin supabase/bootstrap-migrations/0001_init.sql
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
-- End supabase/bootstrap-migrations/0001_init.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0002_booking_requests.sql
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
-- End supabase/bootstrap-migrations/0002_booking_requests.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0003_iguide.sql
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
-- End supabase/bootstrap-migrations/0003_iguide.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0004_calendar.sql
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
-- End supabase/bootstrap-migrations/0004_calendar.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0005_quickbooks.sql
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
-- End supabase/bootstrap-migrations/0005_quickbooks.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0006_fotello.sql
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
-- End supabase/bootstrap-migrations/0006_fotello.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0007_iguide_portal_api.sql
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
-- End supabase/bootstrap-migrations/0007_iguide_portal_api.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0008_catalog.sql
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
-- End supabase/bootstrap-migrations/0008_catalog.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0009_request_cart.sql
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
-- End supabase/bootstrap-migrations/0009_request_cart.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0010_google_calendar.sql
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
-- End supabase/bootstrap-migrations/0010_google_calendar.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0011_booking_property_details.sql
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
-- End supabase/bootstrap-migrations/0011_booking_property_details.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0012_integration_credentials.sql
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
-- End supabase/bootstrap-migrations/0012_integration_credentials.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0013_booking_overlap_guard.sql
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
-- End supabase/bootstrap-migrations/0013_booking_overlap_guard.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0014_iguide_jobs_and_webhook_events.sql
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
-- End supabase/bootstrap-migrations/0014_iguide_jobs_and_webhook_events.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0015_booking_notifications.sql
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
-- End supabase/bootstrap-migrations/0015_booking_notifications.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0016_catalog_sqft_pricing.sql
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
-- End supabase/bootstrap-migrations/0016_catalog_sqft_pricing.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0017_catalog_media_badges.sql
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
-- End supabase/bootstrap-migrations/0017_catalog_media_badges.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0018_property_archive.sql
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
-- End supabase/bootstrap-migrations/0018_property_archive.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0019_listing_websites.sql
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
-- End supabase/bootstrap-migrations/0019_listing_websites.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0020_listing_website_sections.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — listing website included sections
-- ============================================================================

alter table public.listing_websites
  add column if not exists included_sections text[] not null default
    '{photos,tour,floor_plans,video,property_websites}'::text[];

-- ============================================================================
-- End supabase/bootstrap-migrations/0020_listing_website_sections.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0021_listing_website_gallery_selection.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — listing website gallery photo selection
-- ============================================================================

alter table public.listing_websites
  add column if not exists gallery_image_urls text[];

-- ============================================================================
-- End supabase/bootstrap-migrations/0021_listing_website_gallery_selection.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0022_realtor_profile_media.sql
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
-- End supabase/bootstrap-migrations/0022_realtor_profile_media.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0023_realtor_delivery_cc_emails.sql
-- ============================================================================

-- Pixel Blaster Booking — account-level delivery CC recipients
-- Admins can store teammate/assistant emails on a realtor profile so every
-- delivery email automatically copies the right people.

alter table public.profiles
  add column if not exists delivery_cc_emails text[] not null default '{}';

-- ============================================================================
-- End supabase/bootstrap-migrations/0023_realtor_delivery_cc_emails.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0024_saas_calendar_foundation.sql
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
-- End supabase/bootstrap-migrations/0024_saas_calendar_foundation.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0025_saas_tenant_isolation.sql
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
-- End supabase/bootstrap-migrations/0025_saas_tenant_isolation.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0027_realtor_internal_notes.sql
-- ============================================================================

-- Pixel Blaster Booking — private agent preference notes
-- Admin-only notes for realtor preferences, delivery reminders, and workflow
-- gotchas. These are intentionally internal and should not render in the
-- realtor portal or public listing pages.

alter table public.profiles
  add column if not exists internal_notes text;

-- ============================================================================
-- End supabase/bootstrap-migrations/0027_realtor_internal_notes.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0028_organization_email_settings.sql
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
-- End supabase/bootstrap-migrations/0028_organization_email_settings.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0029_iguide_tenant_isolation.sql
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
-- End supabase/bootstrap-migrations/0029_iguide_tenant_isolation.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0030_assistant_action_logs.sql
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
-- End supabase/bootstrap-migrations/0030_assistant_action_logs.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0031_assistant_action_undo.sql
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
-- End supabase/bootstrap-migrations/0031_assistant_action_undo.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0032_realtor_ai_memory.sql
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
-- End supabase/bootstrap-migrations/0032_realtor_ai_memory.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0033_ai_operator_guardrails.sql
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
-- End supabase/bootstrap-migrations/0033_ai_operator_guardrails.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0034_realtor_alternate_phones.sql
-- ============================================================================

-- Allow a realtor profile to match more than one phone number.
alter table public.profiles
  add column if not exists alternate_phones text[] not null default '{}';

comment on column public.profiles.alternate_phones is
  'Additional phone numbers that can identify this realtor during public booking lookup.';

-- ============================================================================
-- End supabase/bootstrap-migrations/0034_realtor_alternate_phones.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0035_realtor_archive.sql
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
-- End supabase/bootstrap-migrations/0035_realtor_archive.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0036_organization_booking_hero_media.sql
-- ============================================================================

alter table public.organizations
  add column if not exists booking_hero_image_url text,
  add column if not exists booking_hero_secondary_image_url text;

comment on column public.organizations.booking_hero_image_url is
  'Primary visual used in the public booking page hero.';

comment on column public.organizations.booking_hero_secondary_image_url is
  'Secondary visual used in the public booking page hero.';

-- ============================================================================
-- End supabase/bootstrap-migrations/0036_organization_booking_hero_media.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0037_allow_admin_overlap.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 37: allow intentional admin double-booking
-- ----------------------------------------------------------------------------
-- The Phase 13 exclusion constraint rejected ANY overlapping active bookings
-- at the database level. In practice the photographer intentionally overlaps
-- shoots (e.g. books over the tail of a job that won't use its full slot), so
-- the hard constraint blocks a legitimate workflow.
--
-- Overlap protection for realtor-facing flows is unchanged: the public
-- booking flow only offers slots the availability engine says are free, and
-- both the public flow and the self-serve manage page re-check for conflicts
-- in application code before writing. Dropping the constraint only removes
-- the atomic backstop (a sub-second race between two simultaneous public
-- submissions), which is an accepted trade-off for admin flexibility.
-- ============================================================================

alter table public.bookings
  drop constraint if exists bookings_active_schedule_no_overlap;

-- ============================================================================
-- End supabase/bootstrap-migrations/0037_allow_admin_overlap.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0038_invoice_timing.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 38: invoice timing setting
-- ----------------------------------------------------------------------------
-- The photographer bills after a job is delivered, so the QuickBooks payment
-- link is emailed automatically with the "media ready" email by default.
-- Some companies prefer collecting up front, so the timing can be switched to
-- "at booking" — the invoice is then created when the public booking lands
-- and the payment link rides along in the confirmation email.
--
-- Billing stays best-effort everywhere: if QuickBooks is not connected or
-- invoice creation fails, booking and delivery emails go out unchanged.
-- ============================================================================

alter table public.organizations
  add column if not exists invoice_timing text not null default 'on_delivery'
    check (invoice_timing in ('on_delivery', 'at_booking'));

comment on column public.organizations.invoice_timing is
  'When the QuickBooks invoice payment link is emailed automatically: after media delivery (default) or as soon as the booking is made.';

-- ============================================================================
-- End supabase/bootstrap-migrations/0038_invoice_timing.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0039_booking_reminders.sql
-- ============================================================================

-- ============================================================================
-- Pixel Blaster Booking — Phase 39: day-before shoot reminders
-- ----------------------------------------------------------------------------
-- Realtors too often forget the shoot is happening and the property isn't
-- photo-ready (or accessible) when the photographer shows up. A daily Vercel
-- cron (/api/cron/reminders) emails every realtor whose shoot lands on
-- tomorrow's calendar date in the business timezone.
--
-- `reminder_sent_at` is the idempotency stamp: null means "not reminded yet",
-- and the cron only ever picks up rows where it is null, so retries and
-- overlapping runs can't double-email anyone.
-- ============================================================================

alter table public.bookings
  add column if not exists reminder_sent_at timestamptz;

comment on column public.bookings.reminder_sent_at is
  'When the day-before shoot reminder email was sent. Null = not yet sent; the reminders cron only considers null rows.';

-- Partial index matching the cron query shape (pending reminders scanned by
-- shoot time). Indexing reminder_sent_at alone would be near-useless — it is
-- null for almost every row — so index scheduled_at over the pending subset.
create index if not exists bookings_reminder_pending_idx
  on public.bookings (scheduled_at)
  where reminder_sent_at is null;

-- ============================================================================
-- End supabase/bootstrap-migrations/0039_booking_reminders.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0040_external_calendar_sources.sql
-- ============================================================================

-- ============================================================================
-- External calendar sources
-- ----------------------------------------------------------------------------
-- Keep the existing Google Calendar OAuth connection as the write target for
-- Pixel Blaster bookings, while allowing additional shared calendars to show
-- in the admin calendar and/or block public booking availability.
-- ============================================================================

alter table public.google_calendar_connection
  add column if not exists display_name text,
  add column if not exists source_type text not null default 'primary'
    check (source_type in ('primary', 'external')),
  add column if not exists show_on_admin_calendar boolean not null default true,
  add column if not exists block_availability boolean not null default true,
  add column if not exists write_bookings boolean not null default true;

update public.google_calendar_connection
set
  display_name = coalesce(display_name, 'Main booking calendar'),
  source_type = coalesce(source_type, 'primary'),
  show_on_admin_calendar = coalesce(show_on_admin_calendar, true),
  block_availability = coalesce(block_availability, true),
  write_bookings = coalesce(write_bookings, true);

drop index if exists public.google_calendar_connection_org_idx;

create unique index if not exists google_calendar_connection_org_calendar_idx
  on public.google_calendar_connection(organization_id, calendar_id);

create unique index if not exists google_calendar_connection_write_target_idx
  on public.google_calendar_connection(organization_id)
  where write_bookings is true;

create index if not exists google_calendar_connection_admin_sources_idx
  on public.google_calendar_connection(organization_id, show_on_admin_calendar);

create index if not exists google_calendar_connection_block_sources_idx
  on public.google_calendar_connection(organization_id, block_availability);

comment on column public.google_calendar_connection.display_name is
  'Human label for this calendar source in admin UI.';

comment on column public.google_calendar_connection.show_on_admin_calendar is
  'Whether events from this source are rendered in /admin/calendar.';

comment on column public.google_calendar_connection.block_availability is
  'Whether busy windows from this source remove public booking slots.';

comment on column public.google_calendar_connection.write_bookings is
  'The one source per organization where newly created Pixel Blaster bookings are written.';

-- ============================================================================
-- End supabase/bootstrap-migrations/0040_external_calendar_sources.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/0041_calendar_source_colours.sql
-- ============================================================================

-- Calendar source colours for the Apple Calendar-style admin sidebar.

alter table public.google_calendar_connection
  add column if not exists source_color text not null default '#2f80b7'
    check (source_color ~ '^#[0-9A-Fa-f]{6}$');

update public.google_calendar_connection
set source_color = case
  when write_bookings is true then '#3f7356'
  else coalesce(source_color, '#2f80b7')
end;

comment on column public.google_calendar_connection.source_color is
  'Hex colour used for this Google Calendar source in admin calendar views.';

-- ============================================================================
-- End supabase/bootstrap-migrations/0041_calendar_source_colours.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/20260611175858_autoenhance_booking_workflow.sql
-- ============================================================================

-- ============================================================================
-- Autoenhance booking workflow
-- ----------------------------------------------------------------------------
-- Tracks Autoenhance orders created from a booking, then records which finished
-- images have been pushed into the linked iGUIDE gallery. This lets the admin
-- page resume after a refresh and keeps the future background worker path
-- idempotent.
-- ============================================================================

create table if not exists public.autoenhance_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  booking_id uuid not null
    references public.bookings(id) on delete cascade,
  property_id uuid not null
    references public.properties(id) on delete cascade,
  order_id text not null,
  order_name text not null,
  upload_mode text not null default 'hdr'
    check (upload_mode in ('hdr', 'single')),
  status text not null default 'uploading',
  process_status text,
  brackets_per_image integer not null default 3,
  settings jsonb not null default '{}'::jsonb,
  bracket_ids text[] not null default '{}',
  uploaded_image_ids text[] not null default '{}',
  finished_image_ids text[] not null default '{}',
  iguide_portal_id text,
  iguide_uploaded_image_ids text[] not null default '{}',
  iguide_failed_image_ids text[] not null default '{}',
  last_iguide_push_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists autoenhance_batches_org_order_key
  on public.autoenhance_batches(organization_id, order_id);

create index if not exists autoenhance_batches_booking_idx
  on public.autoenhance_batches(booking_id, created_at desc);

create index if not exists autoenhance_batches_org_status_idx
  on public.autoenhance_batches(organization_id, status);

drop trigger if exists autoenhance_batches_set_updated_at
  on public.autoenhance_batches;
create trigger autoenhance_batches_set_updated_at
  before update on public.autoenhance_batches
  for each row execute function public.set_updated_at();

alter table public.autoenhance_batches enable row level security;

drop policy if exists "autoenhance_batches: org admin read"
  on public.autoenhance_batches;
create policy "autoenhance_batches: org admin read"
  on public.autoenhance_batches for select
  using (public.is_organization_admin(organization_id));

drop policy if exists "autoenhance_batches: org admin write"
  on public.autoenhance_batches;
create policy "autoenhance_batches: org admin write"
  on public.autoenhance_batches for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

create table if not exists public.autoenhance_iguide_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  batch_id uuid not null
    references public.autoenhance_batches(id) on delete cascade,
  booking_id uuid not null
    references public.bookings(id) on delete cascade,
  iguide_portal_id text not null,
  autoenhance_image_id text not null,
  filename text not null,
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'failed')),
  iguide_asset_name text,
  iguide_job_id text,
  process_complete boolean,
  warning text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists autoenhance_iguide_uploads_image_key
  on public.autoenhance_iguide_uploads(
    organization_id,
    batch_id,
    iguide_portal_id,
    autoenhance_image_id
  );

create index if not exists autoenhance_iguide_uploads_booking_idx
  on public.autoenhance_iguide_uploads(booking_id, created_at desc);

drop trigger if exists autoenhance_iguide_uploads_set_updated_at
  on public.autoenhance_iguide_uploads;
create trigger autoenhance_iguide_uploads_set_updated_at
  before update on public.autoenhance_iguide_uploads
  for each row execute function public.set_updated_at();

alter table public.autoenhance_iguide_uploads enable row level security;

drop policy if exists "autoenhance_iguide_uploads: org admin read"
  on public.autoenhance_iguide_uploads;
create policy "autoenhance_iguide_uploads: org admin read"
  on public.autoenhance_iguide_uploads for select
  using (public.is_organization_admin(organization_id));

drop policy if exists "autoenhance_iguide_uploads: org admin write"
  on public.autoenhance_iguide_uploads;
create policy "autoenhance_iguide_uploads: org admin write"
  on public.autoenhance_iguide_uploads for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

comment on table public.autoenhance_batches is
  'Autoenhance orders created from booking media uploads.';

comment on table public.autoenhance_iguide_uploads is
  'Per-photo Autoenhance-to-iGUIDE upload attempts for idempotency and diagnostics.';

-- ============================================================================
-- End supabase/bootstrap-migrations/20260611175858_autoenhance_booking_workflow.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/20260709193816_booking_schedule_race_guard.sql
-- ============================================================================

-- Keep public/realtor booking writes race-safe while preserving the admin's
-- deliberate ability to overlap shoots. Migration 0037 removed the exclusion
-- constraint globally, which also removed the atomic protection from two
-- simultaneous public submissions.

alter table public.bookings
  add column if not exists allow_schedule_overlap boolean not null default false;

-- Preserve any deliberate overlaps that already exist, so ordinary status
-- changes on those bookings do not fail after the trigger is installed.
update public.bookings booking
set allow_schedule_overlap = true
where booking.status in ('requested', 'confirmed', 'shot', 'editing', 'delivered')
  and booking.scheduled_at is not null
  and booking.scheduled_ends_at is not null
  and exists (
    select 1
    from public.bookings other
    where other.organization_id = booking.organization_id
      and other.id <> booking.id
      and other.status in (
        'requested', 'confirmed', 'shot', 'editing', 'delivered'
      )
      and other.scheduled_at is not null
      and other.scheduled_ends_at is not null
      and pg_catalog.tstzrange(
        other.scheduled_at,
        other.scheduled_ends_at,
        '[)'
      ) && pg_catalog.tstzrange(
        booking.scheduled_at,
        booking.scheduled_ends_at,
        '[)'
      )
  );

create or replace function public.guard_booking_schedule_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('requested', 'confirmed', 'shot', 'editing', 'delivered')
     and new.scheduled_at is not null
     and new.scheduled_ends_at is not null then
    -- Serialize schedule writes per tenant so the check and write are atomic,
    -- including across separate Vercel/serverless invocations.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.organization_id::text, 0)
    );

    if not new.allow_schedule_overlap and exists (
      select 1
      from public.bookings existing
      where existing.organization_id = new.organization_id
        and existing.id <> new.id
        and existing.status in (
          'requested', 'confirmed', 'shot', 'editing', 'delivered'
        )
        and existing.scheduled_at is not null
        and existing.scheduled_ends_at is not null
        and pg_catalog.tstzrange(
          existing.scheduled_at,
          existing.scheduled_ends_at,
          '[)'
        ) && pg_catalog.tstzrange(
          new.scheduled_at,
          new.scheduled_ends_at,
          '[)'
        )
    ) then
      raise exception 'Booking overlaps an active booking'
        using errcode = '23P01';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_schedule_overlap_guard on public.bookings;
create trigger bookings_schedule_overlap_guard
before insert or update of
  organization_id,
  status,
  scheduled_at,
  scheduled_ends_at,
  allow_schedule_overlap
on public.bookings
for each row execute function public.guard_booking_schedule_overlap();

revoke all on function public.guard_booking_schedule_overlap()
  from public, anon, authenticated;

-- A realtor writing through the authenticated API can never opt into the
-- admin-only overlap escape hatch. Organization admins retain that ability.
drop policy if exists "bookings: owner or org admin insert" on public.bookings;
create policy "bookings: owner or org admin insert"
  on public.bookings for insert
  to authenticated
  with check (
    (
      owner_id = (select auth.uid())
      and organization_id = public.current_organization_id()
      and allow_schedule_overlap = false
    )
    or public.is_organization_admin(organization_id)
  );

comment on column public.bookings.allow_schedule_overlap is
  'Admin-only escape hatch for an intentional overlap. Public writes remain serialized and overlap-checked by trigger.';

comment on function public.guard_booking_schedule_overlap() is
  'Serializes schedule writes per organization and rejects overlapping non-admin bookings atomically.';

-- ============================================================================
-- End supabase/bootstrap-migrations/20260709193816_booking_schedule_race_guard.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/20260709200031_database_security_and_indexes.sql
-- ============================================================================

-- Security-advisor cleanup for helper functions. Every referenced relation is
-- schema-qualified, so an empty search_path removes object-shadowing risk.
alter function public.set_updated_at() set search_path = '';
alter function public.handle_new_auth_user() set search_path = '';
alter function public.is_admin() set search_path = '';
alter function public.current_organization_id() set search_path = '';
alter function public.is_organization_admin(uuid) set search_path = '';
alter function public.create_booking_from_request(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
) set search_path = '';

-- The old exclusion constraint installed btree_gist in the public API schema.
-- Keep the extension available, but move its objects out of the exposed schema.
create schema if not exists extensions;
do $$
declare
  extension_schema name;
begin
  select ns.nspname
    into extension_schema
    from pg_catalog.pg_extension ext
    join pg_catalog.pg_namespace ns
      on ns.oid = ext.extnamespace
    where ext.extname = 'btree_gist';

  if extension_schema is not null and extension_schema <> 'extensions' then
    alter extension btree_gist set schema extensions;
  end if;
end;
$$;

-- Trigger helpers do not need to be callable through PostgREST. The legacy
-- is_admin helper remains available only to authenticated users because a few
-- older RLS policies still reference it.
revoke all on function public.set_updated_at()
  from public, anon, authenticated;
revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;
revoke all on function public.is_admin()
  from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- Index foreign-key columns used by tenant dashboards and cleanup jobs. These
-- are small, mechanical indexes identified by the database performance advisor.
create index if not exists assistant_action_logs_target_realtor_idx
  on public.assistant_action_logs(target_realtor_id);
create index if not exists assistant_action_logs_undone_by_idx
  on public.assistant_action_logs(undone_by);
create index if not exists autoenhance_batches_created_by_idx
  on public.autoenhance_batches(created_by);
create index if not exists autoenhance_batches_property_idx
  on public.autoenhance_batches(property_id);
create index if not exists autoenhance_iguide_uploads_batch_idx
  on public.autoenhance_iguide_uploads(batch_id);
create index if not exists booking_line_items_catalog_item_idx
  on public.booking_line_items(catalog_item_id);
create index if not exists booking_requests_booking_idx
  on public.booking_requests(booking_id);
create index if not exists google_calendar_connection_connected_by_idx
  on public.google_calendar_connection(connected_by);
create index if not exists iguide_jobs_property_idx
  on public.iguide_jobs(property_id);
create index if not exists iguide_webhook_events_matched_booking_idx
  on public.iguide_webhook_events(matched_booking_id);
create index if not exists integration_credentials_updated_by_idx
  on public.integration_credentials(updated_by);
create index if not exists listing_websites_booking_idx
  on public.listing_websites(booking_id);
create index if not exists organization_members_profile_idx
  on public.organization_members(profile_id);
create index if not exists quickbooks_connection_connected_by_idx
  on public.quickbooks_connection(connected_by);
create index if not exists service_prices_updated_by_idx
  on public.service_prices(updated_by);
create index if not exists telegram_connections_profile_idx
  on public.telegram_connections(profile_id);

-- ============================================================================
-- End supabase/bootstrap-migrations/20260709200031_database_security_and_indexes.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/20260710142242_push_notifications.sql
-- ============================================================================

-- One row per browser/device that an authenticated admin explicitly allows to
-- receive app notifications. Endpoints and encryption keys are secrets: the
-- browser may manage only its own rows, and the service role handles sends.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_organization_idx
  on public.push_subscriptions(organization_id);
create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions(profile_id);

drop trigger if exists push_subscriptions_set_updated_at
  on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions
  from public, anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions
  to authenticated;
grant all on table public.push_subscriptions to service_role;

drop policy if exists "push_subscriptions: owner read"
  on public.push_subscriptions;
create policy "push_subscriptions: owner read"
  on public.push_subscriptions
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and profile_id = (select auth.uid())
    and organization_id = public.current_organization_id()
  );

drop policy if exists "push_subscriptions: owner insert"
  on public.push_subscriptions;
create policy "push_subscriptions: owner insert"
  on public.push_subscriptions
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and profile_id = (select auth.uid())
    and organization_id = public.current_organization_id()
    and public.is_organization_admin(organization_id)
  );

drop policy if exists "push_subscriptions: owner update"
  on public.push_subscriptions;
create policy "push_subscriptions: owner update"
  on public.push_subscriptions
  for update
  to authenticated
  using (
    profile_id = (select auth.uid())
    and organization_id = public.current_organization_id()
  )
  with check (
    profile_id = (select auth.uid())
    and organization_id = public.current_organization_id()
    and public.is_organization_admin(organization_id)
  );

drop policy if exists "push_subscriptions: owner delete"
  on public.push_subscriptions;
create policy "push_subscriptions: owner delete"
  on public.push_subscriptions
  for delete
  to authenticated
  using (
    profile_id = (select auth.uid())
    and organization_id = public.current_organization_id()
  );

comment on table public.push_subscriptions is
  'Tenant-scoped Web Push endpoints for admins who enabled app notifications.';

-- ============================================================================
-- End supabase/bootstrap-migrations/20260710142242_push_notifications.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/bootstrap-migrations/20260710153500_harden_push_subscription_grants.sql
-- ============================================================================

-- Supabase projects can grant broad table privileges through default
-- privileges. Keep browser clients to the four operations covered by RLS.
revoke all on table public.push_subscriptions from authenticated;
grant select, insert, update, delete on table public.push_subscriptions
  to authenticated;

-- ============================================================================
-- End supabase/bootstrap-migrations/20260710153500_harden_push_subscription_grants.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260716141227_catalog_merchandising_columns.sql
-- ============================================================================

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

-- ============================================================================
-- End supabase/migrations/20260716141227_catalog_merchandising_columns.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260716183000_emergency_tenant_authorization_hardening.sql
-- ============================================================================

-- Emergency tenant authorization hardening.
--
-- This migration closes two release-blocking SaaS isolation defects:
-- 1. authenticated browser clients could change privileged profile fields;
-- 2. legacy global is_admin() policies crossed organization boundaries.

create or replace function public.prevent_profile_authorization_self_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and (
       old.role is distinct from new.role
       or old.organization_id is distinct from new.organization_id
       or old.email is distinct from new.email
       or old.archived_at is distinct from new.archived_at
     ) then
    raise exception 'Profile authorization fields cannot be changed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_profile_authorization_self_change()
  from public, anon, authenticated;

drop trigger if exists profiles_prevent_authorization_self_change
  on public.profiles;
create trigger profiles_prevent_authorization_self_change
  before update of role, organization_id, email, archived_at
  on public.profiles
  for each row execute function public.prevent_profile_authorization_self_change();

-- Browser RLS authority requires all three facts to agree: the caller has an
-- unarchived profile, that profile's active organization matches the target,
-- and a privileged membership exists in that same organization.
create or replace function public.is_organization_admin(target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      join public.organization_members om
        on om.profile_id = p.id
       and om.organization_id = p.organization_id
     where p.id = (select auth.uid())
       and p.organization_id = target_org_id
       and p.archived_at is null
       and om.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_organization_admin(uuid)
  from public, anon;
grant execute on function public.is_organization_admin(uuid)
  to authenticated;

-- organization_members represents the active organization selected on profiles.
-- Enforce that invariant for service-role and browser writes alike. The lock
-- closes the gap between validating existing rows and installing the trigger.
lock table public.organization_members in share row exclusive mode;

do $$
begin
  if exists (
    select 1
      from public.organization_members om
      left join public.profiles p on p.id = om.profile_id
     where p.id is null
        or p.organization_id is distinct from om.organization_id
  ) then
    raise exception 'Existing organization membership does not match profile organization'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.enforce_membership_organization_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.profiles p
     where p.id = new.profile_id
       and p.organization_id = new.organization_id
  ) then
    raise exception 'Membership organization must match profile organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_membership_organization_match()
  from public, anon, authenticated;

drop trigger if exists organization_members_enforce_profile_organization
  on public.organization_members;
create trigger organization_members_enforce_profile_organization
  before insert or update of organization_id, profile_id
  on public.organization_members
  for each row execute function public.enforce_membership_organization_match();

-- Organizations are visible and editable only inside the caller's membership.
-- Platform-wide creation/listing continues through server-only service-role code.
drop policy if exists "organizations: admin read" on public.organizations;
drop policy if exists "organizations: admin write" on public.organizations;
drop policy if exists "organizations: org admin read" on public.organizations;
drop policy if exists "organizations: org admin update" on public.organizations;

create policy "organizations: org admin read"
  on public.organizations for select
  to authenticated
  using (public.is_organization_admin(id));

create policy "organizations: org admin update"
  on public.organizations for update
  to authenticated
  using (public.is_organization_admin(id))
  with check (public.is_organization_admin(id));

-- Membership reads stay available to the member and that organization's
-- administrators. Writes can only target an organization the caller already
-- administers, preventing creation of a membership in another tenant.
drop policy if exists "organization_members: self or admin read"
  on public.organization_members;
drop policy if exists "organization_members: admin write"
  on public.organization_members;
drop policy if exists "organization_members: self or org admin read"
  on public.organization_members;
drop policy if exists "organization_members: org admin insert"
  on public.organization_members;
drop policy if exists "organization_members: org admin update"
  on public.organization_members;
drop policy if exists "organization_members: org admin delete"
  on public.organization_members;

create policy "organization_members: self or org admin read"
  on public.organization_members for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.is_organization_admin(organization_id)
  );

create policy "organization_members: org admin insert"
  on public.organization_members for insert
  to authenticated
  with check (public.is_organization_admin(organization_id));

create policy "organization_members: org admin update"
  on public.organization_members for update
  to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

create policy "organization_members: org admin delete"
  on public.organization_members for delete
  to authenticated
  using (public.is_organization_admin(organization_id));

-- These tables contain OAuth tokens, provider API credentials, or notification
-- recipient PII. Runtime management already goes through requireAdmin() plus the
-- service-role client, so authenticated browser clients need no direct policy.
drop policy if exists "google_calendar_connection: admin read"
  on public.google_calendar_connection;
drop policy if exists "google_calendar_connection: admin write"
  on public.google_calendar_connection;

drop policy if exists "booking_notifications_admin_all"
  on public.booking_notifications;

drop policy if exists "integration_credentials: admin read"
  on public.integration_credentials;
drop policy if exists "integration_credentials: admin write"
  on public.integration_credentials;
drop policy if exists "integration_credentials: org admin read"
  on public.integration_credentials;
drop policy if exists "integration_credentials: org admin write"
  on public.integration_credentials;

drop policy if exists "quickbooks_connection: admin read"
  on public.quickbooks_connection;
drop policy if exists "quickbooks_connection: admin write"
  on public.quickbooks_connection;
drop policy if exists "quickbooks_connection: org admin read"
  on public.quickbooks_connection;
drop policy if exists "quickbooks_connection: org admin write"
  on public.quickbooks_connection;

-- No remaining policy depends on the legacy global helper. Keep it unavailable
-- through PostgREST so tenant users cannot invoke a platform-wide role oracle.
revoke all on function public.is_admin()
  from public, anon, authenticated;

-- ============================================================================
-- End supabase/migrations/20260716183000_emergency_tenant_authorization_hardening.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260716210000_tenant_scope_deliverable_external_ids.sql
-- ============================================================================

-- Tenant-scope provider identities stored on deliverables.
-- A provider may reuse the same external ID in two unrelated accounts; those
-- rows must not conflict across organizations.

alter table public.deliverables
  add column if not exists organization_id uuid
  references public.organizations(id) on delete cascade;

-- Keep the backfill, validation, trigger installation, and constraint swap in
-- one migration transaction without a concurrent-write gap.
lock table public.deliverables in share row exclusive mode;

update public.deliverables d
set organization_id = b.organization_id
from public.bookings b
where b.id = d.booking_id
  and d.organization_id is distinct from b.organization_id;

do $$
begin
  if exists (
    select 1
    from public.deliverables d
    left join public.bookings b on b.id = d.booking_id
    left join public.properties p on p.id = d.property_id
    where b.id is null
       or p.id is null
       or b.property_id is distinct from d.property_id
       or b.organization_id is distinct from p.organization_id
       or d.organization_id is distinct from b.organization_id
  ) then
    raise exception 'Cannot tenant-scope deliverables: booking/property organization mismatch exists';
  end if;
end;
$$;

create or replace function public.set_deliverable_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking_organization_id uuid;
  booking_property_id uuid;
  property_organization_id uuid;
begin
  select b.organization_id, b.property_id
    into booking_organization_id, booking_property_id
  from public.bookings b
  where b.id = new.booking_id;

  select p.organization_id
    into property_organization_id
  from public.properties p
  where p.id = new.property_id;

  if booking_organization_id is null or property_organization_id is null then
    raise exception 'Deliverable booking and property must exist';
  end if;

  if new.property_id is distinct from booking_property_id then
    raise exception 'Deliverable property must match its booking property';
  end if;

  if booking_organization_id is distinct from property_organization_id then
    raise exception 'Deliverable booking and property must belong to the same organization';
  end if;

  if new.organization_id is null then
    new.organization_id := booking_organization_id;
  elsif new.organization_id is distinct from booking_organization_id then
    raise exception 'Deliverable organization must match its booking and property';
  end if;

  return new;
end;
$$;

revoke all on function public.set_deliverable_organization() from public;
revoke all on function public.set_deliverable_organization() from anon;
revoke all on function public.set_deliverable_organization() from authenticated;

drop trigger if exists deliverables_set_organization on public.deliverables;
create trigger deliverables_set_organization
before insert or update of organization_id, booking_id, property_id
on public.deliverables
for each row execute function public.set_deliverable_organization();

alter table public.deliverables
  alter column organization_id set not null;

alter table public.deliverables
  drop constraint if exists deliverables_source_external_id_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.deliverables'::regclass
      and conname = 'deliverables_organization_source_external_id_key'
      and contype = 'u'
  ) then
    alter table public.deliverables
      add constraint deliverables_organization_source_external_id_key
      unique (organization_id, source, external_id);
  end if;
end;
$$;

create index if not exists deliverables_organization_idx
  on public.deliverables(organization_id);

-- ============================================================================
-- End supabase/migrations/20260716210000_tenant_scope_deliverable_external_ids.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260716223000_company_invitation_auth_recovery.sql
-- ============================================================================

-- Quarantine pending company owners, recover ambiguous Auth mutations, and
-- atomically claim tenant membership only after workspace provisioning succeeds.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Pending invitation users must not inherit the default organization. Without
  -- a profile, all normal application authorization paths fail closed.
  if new.raw_app_meta_data ? 'company_invitation_id' then
    return new;
  end if;

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

create or replace function public.find_company_invitation_auth_user(
  p_invitation_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matching_ids uuid[];
begin
  select array_agg(u.id order by u.id)
  into matching_ids
  from auth.users u
  where u.raw_app_meta_data ->> 'company_invitation_id' = p_invitation_id::text;

  if coalesce(cardinality(matching_ids), 0) = 0 then
    return null;
  end if;
  if cardinality(matching_ids) <> 1 then
    raise exception 'company invitation marker is not unique';
  end if;
  return matching_ids[1];
end;
$$;

create or replace function public.claim_company_invitation_owner(
  p_invitation_id uuid,
  p_user_id uuid,
  p_organization_id uuid,
  p_email text,
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_profile_org uuid;
  profile_exists boolean;
begin
  if not exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and lower(u.email) = lower(p_email)
      and u.raw_app_meta_data ->> 'company_invitation_id' = p_invitation_id::text
  ) then
    raise exception 'invitation identity mismatch';
  end if;

  select p.organization_id
  into existing_profile_org
  from public.profiles p
  where p.id = p_user_id
  for update;
  profile_exists := found;

  if profile_exists and existing_profile_org is distinct from p_organization_id then
    raise exception 'invitation user already belongs to another organization';
  end if;

  if exists (
    select 1
    from public.organization_members om
    where om.profile_id = p_user_id
      and om.organization_id <> p_organization_id
  ) then
    raise exception 'invitation user already has another organization membership';
  end if;

  if profile_exists then
    update public.profiles
    set email = lower(p_email),
        full_name = p_full_name,
        role = 'admin'
    where id = p_user_id
      and organization_id = p_organization_id;
  else
    insert into public.profiles (
      id,
      organization_id,
      email,
      full_name,
      role
    ) values (
      p_user_id,
      p_organization_id,
      lower(p_email),
      p_full_name,
      'admin'
    );
  end if;

  insert into public.organization_members (
    organization_id,
    profile_id,
    role
  ) values (
    p_organization_id,
    p_user_id,
    'owner'
  )
  on conflict (organization_id, profile_id)
  do update set role = 'owner';
end;
$$;

revoke all on function public.find_company_invitation_auth_user(uuid) from public;
revoke all on function public.find_company_invitation_auth_user(uuid) from anon;
revoke all on function public.find_company_invitation_auth_user(uuid) from authenticated;
grant execute on function public.find_company_invitation_auth_user(uuid) to service_role;

revoke all on function public.claim_company_invitation_owner(uuid, uuid, uuid, text, text) from public;
revoke all on function public.claim_company_invitation_owner(uuid, uuid, uuid, text, text) from anon;
revoke all on function public.claim_company_invitation_owner(uuid, uuid, uuid, text, text) from authenticated;
grant execute on function public.claim_company_invitation_owner(uuid, uuid, uuid, text, text) to service_role;

-- ============================================================================
-- End supabase/migrations/20260716223000_company_invitation_auth_recovery.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260717140806_quarantine_unprovisioned_auth_users.sql
-- ============================================================================

-- Close generic Supabase Auth signup at the database boundary and make realtor
-- provisioning explicitly tenant-bound. Existing legitimate realtors are marked
-- only when they have booking provenance; any ambiguous historical profile aborts
-- this migration for manual review instead of being guessed or deleted.

-- Historical booking-created realtors predate the trusted app_metadata marker.
-- A booking owned by the profile is durable evidence that the account was used in
-- the realtor workflow. Keep the profile organization as the trusted tenant.
do $$
declare
  mismatch_count integer;
begin
  select count(*)
  into mismatch_count
  from public.bookings b
  join public.profiles p on p.id = b.owner_id
  where b.organization_id is distinct from p.organization_id;

  if mismatch_count > 0 then
    raise exception 'cross-tenant booking owner/profile mismatch(es) remain: %', mismatch_count
      using errcode = 'P0001',
            hint = 'Reconcile booking and profile organizations before applying this migration.';
  end if;
end;
$$;

update auth.users u
set raw_app_meta_data =
  coalesce(u.raw_app_meta_data, '{}'::jsonb) ||
  jsonb_build_object('realtor_organization_id', p.organization_id::text)
from public.profiles p
where p.id = u.id
  and p.role = 'realtor'
  and not (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'realtor_organization_id')
  and exists (
    select 1
    from public.bookings b
    where b.owner_id = p.id
      and b.organization_id = p.organization_id
  );

-- Fail closed if a realtor profile still lacks reviewed provenance. Operations
-- must remove an unauthorized profile and its memberships or set a reviewed
-- matching marker before retrying. Never auto-classify an account with no booking.
do $$
declare
  unreviewed_count integer;
  marker record;
  parsed_organization_id uuid;
begin
  for marker in
    select
      p.id,
      p.organization_id,
      u.raw_app_meta_data ->> 'realtor_organization_id' as marker_value
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'realtor'
      and coalesce(u.raw_app_meta_data, '{}'::jsonb) ?
        'realtor_organization_id'
  loop
    begin
      parsed_organization_id := marker.marker_value::uuid;
    exception
      when invalid_text_representation then
        raise exception 'realtor % has malformed organization provenance', marker.id
          using errcode = '22023';
    end;

    if parsed_organization_id is distinct from marker.organization_id then
      raise exception 'realtor % provenance does not match profile organization', marker.id
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1
      from public.organizations o
      where o.id = parsed_organization_id
    ) then
      raise exception 'realtor % provenance references a missing organization', marker.id
        using errcode = '23503';
    end if;
  end loop;

  select count(*)
  into unreviewed_count
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'realtor'
    and not (
      coalesce(u.raw_app_meta_data, '{}'::jsonb) ?
      'realtor_organization_id'
    );

  if unreviewed_count > 0 then
    raise exception 'unreviewed realtor profile(s) remain: %', unreviewed_count
      using errcode = 'P0001',
            hint = 'Review each unmarked realtor before applying this migration.';
  end if;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  realtor_organization_id uuid;
begin
  -- Owner invitations intentionally remain profile-less until their token is
  -- claimed atomically by the invitation workflow.
  if new.raw_app_meta_data ? 'company_invitation_id' then
    return new;
  end if;

  -- raw_app_meta_data is controlled by Supabase admin/service-role operations.
  -- Rejecting here rolls back the auth.users insert, so direct anon signup/OAuth
  -- cannot reserve an email or create an unassigned Auth identity.
  if not (new.raw_app_meta_data ? 'realtor_organization_id') then
    raise exception 'public signup is disabled; trusted provisioning marker required'
      using errcode = '42501';
  end if;

  begin
    realtor_organization_id :=
      nullif(new.raw_app_meta_data ->> 'realtor_organization_id', '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'invalid realtor organization marker'
        using errcode = '22023';
  end;

  if realtor_organization_id is null or not exists (
    select 1
    from public.organizations o
    where o.id = realtor_organization_id
  ) then
    raise exception 'realtor organization does not exist'
      using errcode = '23503';
  end if;

  insert into public.profiles (
    id,
    email,
    full_name,
    organization_id,
    role
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    realtor_organization_id,
    'realtor'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;

-- The service-only request-acceptance RPC must not move or reactivate an Auth
-- identity. Its owner must already be an active realtor in the requested tenant.
create or replace function public.create_booking_from_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_owner_id uuid,
  p_scheduled_at timestamptz,
  p_scheduled_ends_at timestamptz
)
returns uuid
language plpgsql
set search_path = ''
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

  perform 1
  from public.profiles p
  where p.id = p_owner_id
    and p.organization_id = p_organization_id
    and p.role = 'realtor'
    and p.archived_at is null
  for update;

  if not found then
    raise exception 'booking owner is not an active realtor in this organization'
      using errcode = '42501';
  end if;

  update public.profiles
    set full_name = req.contact_name,
        phone = req.contact_phone,
        brokerage = req.brokerage
    where id = p_owner_id
      and organization_id = p_organization_id;

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

create table if not exists public.auth_recovery_grants (
  jti_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.auth_recovery_grants enable row level security;
revoke all on table public.auth_recovery_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_recovery_grants to service_role;

create or replace function public.consume_auth_recovery_grant(
  p_jti_hash text,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.auth_recovery_grants
  set consumed_at = now()
  where jti_hash = p_jti_hash
    and user_id = p_user_id
    and consumed_at is null
    and expires_at > now();
  return found;
end;
$$;

revoke all on function public.consume_auth_recovery_grant(text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_auth_recovery_grant(text, uuid)
  to service_role;

create table if not exists public.provisioning_cleanup_events (
  id uuid primary key,
  auth_user_id uuid,
  provisioning_id uuid,
  property_id uuid,
  status text not null check (status in ('quarantined', 'retained', 'failed')),
  context text not null,
  detail text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.provisioning_cleanup_events enable row level security;
revoke all on table public.provisioning_cleanup_events from public, anon, authenticated;
grant select, insert, update on table public.provisioning_cleanup_events to service_role;

create or replace function public.find_realtor_provisioning_auth_user(
  p_provisioning_id uuid,
  p_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_ids uuid[];
begin
  select array_agg(u.id order by u.created_at)
  into matched_ids
  from auth.users u
  where u.raw_app_meta_data ->> 'realtor_provisioning_id' = p_provisioning_id::text
    and u.raw_app_meta_data ->> 'realtor_organization_id' = p_organization_id::text;

  if coalesce(array_length(matched_ids, 1), 0) > 1 then
    raise exception 'Provisioning marker is not unique.';
  end if;
  return matched_ids[1];
end;
$$;

revoke all on function public.find_realtor_provisioning_auth_user(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.find_realtor_provisioning_auth_user(uuid, uuid)
  to service_role;

create or replace function public.bootstrap_first_company_owner(
  p_invitation_id uuid,
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_company_name text,
  p_company_slug text,
  p_primary_color text,
  p_accent_color text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_organization_id constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  perform pg_advisory_xact_lock(hashtext('pixel-blaster-first-company-bootstrap'));

  if exists (select 1 from public.profiles)
     or exists (
       select 1 from public.organization_members where role in ('owner', 'admin')
     ) then
    raise exception 'first company already bootstrapped';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id
      and lower(u.email) = lower(p_email)
      and u.raw_app_meta_data ->> 'company_invitation_id' = p_invitation_id::text
  ) then
    raise exception 'bootstrap identity mismatch';
  end if;

  insert into public.profiles (
    id, organization_id, email, full_name, role
  ) values (
    p_user_id, default_organization_id, lower(p_email), p_full_name, 'admin'
  );

  insert into public.organization_members (
    organization_id, profile_id, role
  ) values (
    default_organization_id, p_user_id, 'owner'
  );

  update public.organizations
  set name = p_company_name,
      slug = p_company_slug,
      primary_color = p_primary_color,
      accent_color = p_accent_color
  where id = default_organization_id;

  if not found then
    raise exception 'default organization missing';
  end if;
end;
$$;

revoke all on function public.bootstrap_first_company_owner(
  uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.bootstrap_first_company_owner(
  uuid, uuid, text, text, text, text, text, text
) to service_role;

-- Quarantine a synthetic realtor only when no successful or concurrent work
-- depends on that identity. FK checks keep a concurrent insert from racing the
-- profile deletion; any such race aborts this transaction instead of deleting
-- an identity that another request has committed.
create or replace function public.quarantine_unbooked_realtor(
  p_user_id uuid,
  p_property_id uuid,
  p_provisioning_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id
      and u.raw_app_meta_data ->> 'realtor_provisioning_id' = p_provisioning_id::text
  ) then
    return 'retained';
  end if;

  if exists (
    select 1 from public.bookings where owner_id = p_user_id
  ) or exists (
    select 1
    from public.organization_members
    where profile_id = p_user_id
      and role in ('owner', 'admin')
  ) then
    return 'retained';
  end if;

  if p_property_id is not null then
    delete from public.properties
    where id = p_property_id
      and owner_id = p_user_id
      and not exists (
        select 1 from public.bookings where property_id = p_property_id
      );
  end if;

  if exists (
    select 1 from public.properties where owner_id = p_user_id
  ) then
    return 'retained';
  end if;

  delete from public.organization_members
  where profile_id = p_user_id;

  delete from public.profiles
  where id = p_user_id
    and role = 'realtor';

  if found or not exists (
    select 1 from public.profiles where id = p_user_id
  ) then
    return 'quarantined';
  end if;

  return 'retained';
end;
$$;

revoke all on function public.quarantine_unbooked_realtor(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.quarantine_unbooked_realtor(uuid, uuid, uuid)
  to service_role;

-- ============================================================================
-- End supabase/migrations/20260717140806_quarantine_unprovisioned_auth_users.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260717211142_auth_user_metadata_update_provisioning.sql
-- ============================================================================

-- Supabase Auth applies admin app_metadata after the initial auth.users insert.
-- Keep the initial identity quarantined/profile-less, then provision only when
-- protected metadata is present. Public signup remains disabled at Auth config.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  realtor_organization_id uuid;
begin
  -- Owner invitations remain profile-less until atomic invitation claim.
  if coalesce(new.raw_app_meta_data, '{}'::jsonb) ? 'company_invitation_id' then
    return new;
  end if;

  -- A marker-less identity has no tenant authority and remains quarantined.
  -- Supabase Admin createUser writes protected app_metadata after INSERT, so an
  -- UPDATE trigger below performs trusted realtor provisioning.
  if not (
    coalesce(new.raw_app_meta_data, '{}'::jsonb) ?
    'realtor_organization_id'
  ) then
    return new;
  end if;

  begin
    realtor_organization_id :=
      nullif(new.raw_app_meta_data ->> 'realtor_organization_id', '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'invalid realtor organization marker'
        using errcode = '22023';
  end;

  if realtor_organization_id is null or not exists (
    select 1
    from public.organizations o
    where o.id = realtor_organization_id
  ) then
    raise exception 'realtor organization does not exist'
      using errcode = '23503';
  end if;

  insert into public.profiles (
    id,
    email,
    full_name,
    organization_id,
    role
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    realtor_organization_id,
    'realtor'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of raw_app_meta_data on auth.users
for each row execute function public.handle_new_auth_user();

-- ============================================================================
-- End supabase/migrations/20260717211142_auth_user_metadata_update_provisioning.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260718202432_atomic_public_booking_outbox.sql
-- ============================================================================

-- Commit the public booking aggregate and its consequential integration work in
-- one Postgres transaction. The RPCs are service-role-only and SECURITY INVOKER;
-- the function still independently verifies tenant, profile, membership, cart,
-- schedule, and request-idempotency invariants.

alter table public.bookings
  add column if not exists public_request_id uuid,
  add column if not exists public_request_fingerprint text;

alter table public.booking_line_items
  add column if not exists item_name text,
  add column if not exists item_slug text,
  add column if not exists item_kind text;

update public.booking_line_items line
set item_name = catalog.name,
    item_slug = catalog.slug,
    item_kind = catalog.kind::text
from public.catalog_items catalog
where catalog.id = line.catalog_item_id
  and (
    line.item_name is null
    or line.item_slug is null
    or line.item_kind is null
  );

create or replace function public.snapshot_booking_line_item_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.catalog_item_id is distinct from old.catalog_item_id then
      raise exception 'Booking line catalog identity is immutable'
        using errcode = '23514';
    end if;
    new.item_name := old.item_name;
    new.item_slug := old.item_slug;
    new.item_kind := old.item_kind;
    new.unit_price_cents := old.unit_price_cents;
    new.unit_duration_minutes := old.unit_duration_minutes;
    return new;
  end if;

  select catalog.name, catalog.slug, catalog.kind::text
    into new.item_name, new.item_slug, new.item_kind
  from public.catalog_items catalog
  where catalog.id = new.catalog_item_id;

  if not found then
    raise exception 'Catalog item does not exist'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger snapshot_booking_line_item_identity_trigger
before insert or update on public.booking_line_items
for each row execute function public.snapshot_booking_line_item_identity();

alter table public.booking_line_items
  alter column item_name set not null,
  alter column item_slug set not null,
  alter column item_kind set not null,
  add constraint booking_line_items_item_kind_check
    check (item_kind in ('bundle', 'a_la_carte', 'addon'));

create unique index if not exists bookings_public_request_org_idx
  on public.bookings(organization_id, public_request_id)
  where public_request_id is not null;

create unique index if not exists bookings_organization_id_id_idx
  on public.bookings(organization_id, id);

create or replace function public.is_valid_booking_integration_payload(
  p_payload jsonb,
  p_organization_id uuid,
  p_booking_id uuid
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  org jsonb;
  realtor jsonb;
  property_snapshot jsonb;
  booking_snapshot jsonb;
  item jsonb;
  cc jsonb;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if coalesce((jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload->'schema_version') <> 'number'
    or (p_payload->>'schema_version')::numeric <> 1
    or jsonb_typeof(p_payload->'booking_id') <> 'string'
    or p_payload->>'booking_id' <> p_booking_id::text
    or jsonb_typeof(p_payload->'organization_id') <> 'string'
    or p_payload->>'organization_id' <> p_organization_id::text
    or jsonb_typeof(p_payload->'public_request_id') <> 'string'
    or p_payload->>'public_request_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_payload->'app_url') <> 'string'
    or p_payload->>'app_url' ~* '^https?://[^/[:space:]]*@'
    or not (
      p_payload->>'app_url' = ''
      or p_payload->>'app_url' ~* '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?([/?#][^[:space:]<>"'']*)?$'
      or p_payload->>'app_url' ~* '^http://(localhost|127\.0\.0\.1)(:(0|[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?([/?#][^[:space:]<>"'']*)?$'
    )
  ), true) then return false;
  end if;

  org := p_payload->'organization';
  realtor := p_payload->'realtor';
  property_snapshot := p_payload->'property';
  booking_snapshot := p_payload->'booking';
  if coalesce((jsonb_typeof(org) <> 'object'
    or jsonb_typeof(org->'name') <> 'string'
    or nullif(pg_catalog.btrim(org->>'name'), '') is null
    or jsonb_typeof(org->'from_name') <> 'string'
    or nullif(pg_catalog.btrim(org->>'from_name'), '') is null
    or not (org ?& array['reply_to_email', 'admin_notification_email'])
    or (jsonb_typeof(org->'reply_to_email') <> 'null' and (
      jsonb_typeof(org->'reply_to_email') <> 'string'
      or org->>'reply_to_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ))
    or (jsonb_typeof(org->'admin_notification_email') <> 'null' and (
      jsonb_typeof(org->'admin_notification_email') <> 'string'
      or org->>'admin_notification_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ))
  ), true) then return false;
  end if;

  if coalesce((jsonb_typeof(realtor) <> 'object'
    or jsonb_typeof(realtor->'id') <> 'string'
    or realtor->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(realtor->'email') <> 'string'
    or realtor->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or jsonb_typeof(realtor->'full_name') <> 'string'
    or nullif(pg_catalog.btrim(realtor->>'full_name'), '') is null
    or not (realtor ?& array['phone', 'brokerage', 'delivery_cc_emails'])
    or jsonb_typeof(realtor->'phone') not in ('string', 'null')
    or jsonb_typeof(realtor->'brokerage') not in ('string', 'null')
    or jsonb_typeof(realtor->'delivery_cc_emails') <> 'array'
  ), true) then return false;
  end if;
  for cc in select value from jsonb_array_elements(realtor->'delivery_cc_emails') loop
    if jsonb_typeof(cc) <> 'string'
      or (cc #>> '{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then return false;
    end if;
  end loop;

  if coalesce((jsonb_typeof(property_snapshot) <> 'object'
    or jsonb_typeof(property_snapshot->'street_address') <> 'string'
    or nullif(pg_catalog.btrim(property_snapshot->>'street_address'), '') is null
    or not (property_snapshot ?& array['city', 'postal_code', 'unit_number'])
    or jsonb_typeof(property_snapshot->'city') not in ('string', 'null')
    or jsonb_typeof(property_snapshot->'postal_code') not in ('string', 'null')
    or jsonb_typeof(property_snapshot->'unit_number') not in ('string', 'null')
  ), true) then return false;
  end if;

  if coalesce((jsonb_typeof(booking_snapshot) <> 'object'
    or not (booking_snapshot ?& array[
      'scheduled_at', 'scheduled_ends_at', 'square_footage',
      'is_vacant', 'include_basement', 'client_notes'
    ])
    or jsonb_typeof(booking_snapshot->'scheduled_at') <> 'string'
    or booking_snapshot->>'scheduled_at' !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$'
    or jsonb_typeof(booking_snapshot->'scheduled_ends_at') <> 'string'
    or booking_snapshot->>'scheduled_ends_at' !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$'
    or jsonb_typeof(booking_snapshot->'square_footage') not in ('number', 'null')
    or (jsonb_typeof(booking_snapshot->'square_footage') = 'number' and (
      (booking_snapshot->>'square_footage')::numeric < 0
      or (booking_snapshot->>'square_footage')::numeric <> pg_catalog.trunc((booking_snapshot->>'square_footage')::numeric)
      or (booking_snapshot->>'square_footage')::numeric > 9007199254740991
    ))
    or jsonb_typeof(booking_snapshot->'is_vacant') not in ('string', 'null')
    or (jsonb_typeof(booking_snapshot->'is_vacant') = 'string'
      and booking_snapshot->>'is_vacant' not in ('vacant', 'occupied', 'partial'))
    or jsonb_typeof(booking_snapshot->'include_basement') not in ('boolean', 'null')
    or jsonb_typeof(booking_snapshot->'client_notes') <> 'string'
  ), true) then return false;
  end if;
  starts_at := (booking_snapshot->>'scheduled_at')::timestamptz;
  ends_at := (booking_snapshot->>'scheduled_ends_at')::timestamptz;
  if not pg_catalog.isfinite(starts_at)
    or not pg_catalog.isfinite(ends_at)
    or ends_at <= starts_at
  then return false;
  end if;

  if coalesce((jsonb_typeof(p_payload->'line_items') <> 'array'
    or jsonb_array_length(p_payload->'line_items') = 0
  ), true) then return false;
  end if;
  for item in select value from jsonb_array_elements(p_payload->'line_items') loop
    if coalesce((jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'catalog_item_id') <> 'string'
      or item->>'catalog_item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'name') <> 'string'
      or nullif(pg_catalog.btrim(item->>'name'), '') is null
      or jsonb_typeof(item->'slug') <> 'string'
      or nullif(pg_catalog.btrim(item->>'slug'), '') is null
      or jsonb_typeof(item->'kind') <> 'string'
      or item->>'kind' not in ('bundle', 'a_la_carte', 'addon')
      or jsonb_typeof(item->'quantity') <> 'number'
      or (item->>'quantity')::numeric < 1
      or (item->>'quantity')::numeric <> pg_catalog.trunc((item->>'quantity')::numeric)
      or (item->>'quantity')::numeric > 9007199254740991
      or jsonb_typeof(item->'unit_price_cents') <> 'number'
      or (item->>'unit_price_cents')::numeric < 0
      or (item->>'unit_price_cents')::numeric <> pg_catalog.trunc((item->>'unit_price_cents')::numeric)
      or (item->>'unit_price_cents')::numeric > 9007199254740991
      or jsonb_typeof(item->'unit_duration_minutes') <> 'number'
      or (item->>'unit_duration_minutes')::numeric < 0
      or (item->>'unit_duration_minutes')::numeric <> pg_catalog.trunc((item->>'unit_duration_minutes')::numeric)
      or (item->>'unit_duration_minutes')::numeric > 9007199254740991
    ), true) then return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

create table public.integration_jobs (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  booking_id            uuid not null,
  job_type              text not null check (job_type in (
                          'quickbooks.invoice.create',
                          'google_calendar.event.create',
                          'email.booking.confirmation',
                          'email.admin.new_booking',
                          'push.admin.new_booking'
                        )),
  idempotency_key       text not null,
  payload_version       integer not null default 1 check (payload_version = 1),
  payload               jsonb not null check (
                          public.is_valid_booking_integration_payload(
                            payload, organization_id, booking_id
                          )
                        ),
  status                text not null default 'pending'
                        check (status in (
                          'pending',
                          'processing',
                          'retryable',
                          'completed',
                          'skipped',
                          'cancelled',
                          'dead_letter'
                        )),
  attempts              integer not null default 0 check (attempts >= 0),
  max_attempts          integer not null default 8 check (max_attempts > 0),
  next_attempt_at       timestamptz not null default now(),
  lease_token           uuid,
  locked_by             text,
  locked_at             timestamptz,
  lease_expires_at      timestamptz,
  provider_external_id  text,
  provider_result       jsonb,
  last_error_code       text,
  last_error_message    text,
  last_error_at         timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint integration_jobs_booking_tenant_fk
    foreign key (organization_id, booking_id)
    references public.bookings(organization_id, id)
    on delete restrict,
  unique (organization_id, idempotency_key),
  unique (organization_id, booking_id, job_type),
  check (
    status <> 'processing'
    or (
      lease_token is not null
      and locked_by is not null
      and locked_at is not null
      and lease_expires_at is not null
    )
  ),
  check (
    status not in ('completed', 'skipped', 'cancelled', 'dead_letter')
    or completed_at is not null
  )
);

create index integration_jobs_ready_idx
  on public.integration_jobs(next_attempt_at, created_at)
  where status in ('pending', 'retryable');

create index integration_jobs_booking_idx
  on public.integration_jobs(organization_id, booking_id, created_at);

create index integration_jobs_processing_idx
  on public.integration_jobs(lease_expires_at)
  where status = 'processing';

alter table public.integration_jobs enable row level security;

revoke all on table public.integration_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_jobs to service_role;

create or replace function public.preserve_integration_job_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.booking_id is distinct from old.booking_id
     or new.job_type is distinct from old.job_type
     or new.idempotency_key is distinct from old.idempotency_key
     or new.payload_version is distinct from old.payload_version
     or new.payload is distinct from old.payload then
    raise exception 'Integration job identity and payload are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger integration_jobs_preserve_identity_trigger
before update on public.integration_jobs
for each row execute function public.preserve_integration_job_identity();

comment on table public.integration_jobs is
  'Tenant-scoped durable outbox for consequential booking and delivery integrations.';
comment on column public.integration_jobs.idempotency_key is
  'Stable logical-effect key reused for provider idempotency and reconciliation.';
comment on column public.bookings.public_request_id is
  'Client-generated retry key for one public confirmation-page submission.';
comment on column public.bookings.public_request_fingerprint is
  'Normalized payload fingerprint; the same request id cannot silently accept changed booking data.';

create or replace function public.create_public_booking_with_jobs(
  p_request_id uuid,
  p_organization_id uuid,
  p_owner_id uuid,
  p_street_address text,
  p_city text,
  p_postal_code text,
  p_unit_number text,
  p_scheduled_at timestamptz,
  p_square_footage integer,
  p_is_vacant text,
  p_include_basement boolean,
  p_client_notes text,
  p_service_item_ids uuid[],
  p_add_on_item_ids uuid[],
  p_admin_notification_email text default null,
  p_app_url text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_booking record;
  has_existing_booking boolean := false;
  new_property_id uuid;
  new_booking_id uuid;
  scheduled_ends_at timestamptz;
  total_duration_minutes integer;
  service_slugs text[];
  add_on_slugs text[];
  has_video boolean;
  request_fingerprint text;
  invoice_timing text;
  job_payload jsonb;
begin
  if p_request_id is null or p_organization_id is null or p_owner_id is null then
    raise exception 'Required public booking identity is missing'
      using errcode = 'PB003';
  end if;

  -- Resolve the durable request identity before mutable catalog and schedule
  -- validation. Active tenant membership is still required before returning a
  -- committed replay, and the normalized fingerprint rejects changed input.
  request_fingerprint := pg_catalog.md5(pg_catalog.concat_ws(
    E'\x1f',
    p_owner_id::text,
    pg_catalog.lower(pg_catalog.btrim(p_street_address)),
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_city, ''))),
    pg_catalog.upper(pg_catalog.btrim(coalesce(p_postal_code, ''))),
    pg_catalog.btrim(coalesce(p_unit_number, '')),
    coalesce(p_scheduled_at::text, ''),
    coalesce(p_square_footage::text, ''),
    coalesce(p_is_vacant, ''),
    coalesce(p_include_basement::text, ''),
    coalesce(p_client_notes, ''),
    coalesce((
      select pg_catalog.string_agg(item_id::text, ',' order by item_id)
      from pg_catalog.unnest(coalesce(p_service_item_ids, '{}'::uuid[])) item_id
    ), ''),
    coalesce((
      select pg_catalog.string_agg(item_id::text, ',' order by item_id)
      from pg_catalog.unnest(coalesce(p_add_on_item_ids, '{}'::uuid[])) item_id
    ), '')
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'public-booking-request:' || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  select b.id, b.property_id, b.scheduled_ends_at, b.public_request_fingerprint
    into existing_booking
  from public.bookings b
  where b.organization_id = p_organization_id
    and b.public_request_id = p_request_id
  limit 1;

  has_existing_booking := found;

  -- Service-role invocation is not authority by itself. Only an active realtor
  -- with an ordinary member relationship in this exact tenant may own a public
  -- booking. Company owner/admin identities remain forbidden booking owners.
  perform 1
  from public.profiles p
  join public.organization_members om
    on om.profile_id = p.id
   and om.organization_id = p.organization_id
  where p.id = p_owner_id
    and p.organization_id = p_organization_id
    and p.role = 'realtor'
    and p.archived_at is null
    and om.organization_id = p_organization_id
    and om.role = 'member'
  for update of p;

  if not found then
    raise exception 'Active tenant realtor membership required'
      using errcode = 'PB001';
  end if;

  if has_existing_booking then
    if existing_booking.public_request_fingerprint is distinct from request_fingerprint then
      raise exception 'Public booking request was already used with different data'
        using errcode = 'PB004';
    end if;
    return pg_catalog.jsonb_build_object(
      'booking_id', existing_booking.id,
      'property_id', existing_booking.property_id,
      'scheduled_ends_at', existing_booking.scheduled_ends_at,
      'replayed', true
    );
  end if;

  if nullif(pg_catalog.btrim(p_street_address), '') is null
     or p_scheduled_at is null
     or p_scheduled_at <= pg_catalog.now()
     or p_square_footage is not null and p_square_footage < 0
     or p_is_vacant is not null
        and p_is_vacant not in ('vacant', 'occupied', 'partial') then
    raise exception 'Malformed public booking input'
      using errcode = 'PB003';
  end if;

  if pg_catalog.cardinality(coalesce(p_service_item_ids, '{}'::uuid[])) = 0
     or (
       select pg_catalog.count(distinct item_id)
       from pg_catalog.unnest(coalesce(p_service_item_ids, '{}'::uuid[])) item_id
     ) <> pg_catalog.cardinality(coalesce(p_service_item_ids, '{}'::uuid[]))
     or (
       select pg_catalog.count(distinct item_id)
       from pg_catalog.unnest(coalesce(p_add_on_item_ids, '{}'::uuid[])) item_id
     ) <> pg_catalog.cardinality(coalesce(p_add_on_item_ids, '{}'::uuid[]))
     or exists (
       select 1
       from pg_catalog.unnest(coalesce(p_service_item_ids, '{}'::uuid[])) item_id
       left join public.catalog_items catalog
         on catalog.id = item_id
        and catalog.organization_id = p_organization_id
        and catalog.active = true
        and catalog.kind in ('bundle', 'a_la_carte')
       where catalog.id is null
     )
     or exists (
       select 1
       from pg_catalog.unnest(coalesce(p_add_on_item_ids, '{}'::uuid[])) item_id
       left join public.catalog_items catalog
         on catalog.id = item_id
        and catalog.organization_id = p_organization_id
        and catalog.active = true
        and catalog.kind = 'addon'
       where catalog.id is null
     )
     or exists (
       select 1
       from pg_catalog.unnest(coalesce(p_service_item_ids, '{}'::uuid[])) item_id
       where item_id = any(coalesce(p_add_on_item_ids, '{}'::uuid[]))
     )
     or (
       select pg_catalog.count(*)
       from public.catalog_items catalog
       where catalog.id = any(coalesce(p_service_item_ids, '{}'::uuid[]))
         and catalog.organization_id = p_organization_id
         and catalog.active = true
         and catalog.kind = 'bundle'
     ) > 1 then
    raise exception 'Invalid tenant catalog selection'
      using errcode = 'PB002';
  end if;

  select coalesce(pg_catalog.bool_or(catalog.is_video), false)
    into has_video
  from public.catalog_items catalog
  where catalog.id = any(p_service_item_ids)
    and catalog.organization_id = p_organization_id
    and catalog.active = true;

  if not has_video and exists (
    select 1
    from public.catalog_items catalog
    where catalog.id = any(coalesce(p_add_on_item_ids, '{}'::uuid[]))
      and catalog.organization_id = p_organization_id
      and catalog.active = true
      and catalog.require_has_video = true
  ) then
    raise exception 'Selected add-on requires a video service'
      using errcode = 'PB002';
  end if;

  select pg_catalog.array_agg(
    catalog.slug order by pg_catalog.array_position(p_service_item_ids, catalog.id)
  )
  into service_slugs
  from public.catalog_items catalog
  where catalog.id = any(p_service_item_ids)
    and catalog.organization_id = p_organization_id
    and catalog.active = true;

  select greatest(coalesce(pg_catalog.sum(catalog.duration_minutes), 0), 60)
  into total_duration_minutes
  from public.catalog_items catalog
  where catalog.id = any(
      p_service_item_ids || coalesce(p_add_on_item_ids, '{}'::uuid[])
    )
    and catalog.organization_id = p_organization_id
    and catalog.active = true;

  select coalesce(
    pg_catalog.array_agg(
      catalog.slug order by pg_catalog.array_position(p_add_on_item_ids, catalog.id)
    ),
    '{}'::text[]
  )
  into add_on_slugs
  from public.catalog_items catalog
  where catalog.id = any(coalesce(p_add_on_item_ids, '{}'::uuid[]))
    and catalog.organization_id = p_organization_id
    and catalog.active = true;

  scheduled_ends_at := p_scheduled_at
    + pg_catalog.make_interval(mins => total_duration_minutes);

  -- Serialize normalized property reuse without imposing a risky unique index on
  -- historical address data.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_owner_id::text || ':' ||
      pg_catalog.lower(pg_catalog.btrim(p_street_address)),
      1
    )
  );

  select property.id
    into new_property_id
  from public.properties property
  where property.organization_id = p_organization_id
    and property.owner_id = p_owner_id
    and pg_catalog.lower(pg_catalog.btrim(property.street_address)) =
        pg_catalog.lower(pg_catalog.btrim(p_street_address))
  order by property.created_at asc, property.id asc
  limit 1
  for update;

  if new_property_id is null then
    insert into public.properties (
      organization_id,
      owner_id,
      street_address,
      city,
      postal_code
    ) values (
      p_organization_id,
      p_owner_id,
      pg_catalog.btrim(p_street_address),
      nullif(pg_catalog.btrim(p_city), ''),
      nullif(pg_catalog.btrim(p_postal_code), '')
    )
    returning id into new_property_id;
  end if;

  insert into public.bookings (
    organization_id,
    property_id,
    owner_id,
    public_request_id,
    public_request_fingerprint,
    status,
    scheduled_at,
    scheduled_ends_at,
    allow_schedule_overlap,
    services,
    add_ons,
    client_notes,
    unit_number,
    square_footage,
    is_vacant,
    include_basement
  ) values (
    p_organization_id,
    new_property_id,
    p_owner_id,
    p_request_id,
    request_fingerprint,
    'confirmed',
    p_scheduled_at,
    scheduled_ends_at,
    false,
    service_slugs,
    add_on_slugs,
    nullif(p_client_notes, ''),
    nullif(pg_catalog.btrim(p_unit_number), ''),
    p_square_footage,
    p_is_vacant,
    p_include_basement
  )
  returning id into new_booking_id;

  insert into public.booking_line_items (
    booking_id,
    catalog_item_id,
    item_name,
    item_slug,
    item_kind,
    quantity,
    unit_price_cents,
    unit_duration_minutes
  )
  select
    new_booking_id,
    catalog.id,
    catalog.name,
    catalog.slug,
    catalog.kind::text,
    1,
    catalog.price_cents + case
      when catalog.sqft_pricing_enabled
       and catalog.included_sqft is not null
       and catalog.included_sqft > 0
       and catalog.overage_increment_sqft is not null
       and catalog.overage_increment_sqft > 0
       and catalog.overage_price_cents is not null
       and catalog.overage_price_cents > 0
       and p_square_footage is not null
       and p_square_footage > catalog.included_sqft
      then pg_catalog.ceil(
        (p_square_footage - catalog.included_sqft)::numeric
        / catalog.overage_increment_sqft
      )::integer * catalog.overage_price_cents
      else 0
    end,
    catalog.duration_minutes
  from public.catalog_items catalog
  where catalog.organization_id = p_organization_id
    and catalog.active = true
    and catalog.id = any(
      p_service_item_ids || coalesce(p_add_on_item_ids, '{}'::uuid[])
    );

  if (select pg_catalog.count(*)
      from public.booking_line_items line
      where line.booking_id = new_booking_id)
      <> pg_catalog.cardinality(
        p_service_item_ids || coalesce(p_add_on_item_ids, '{}'::uuid[])
      ) then
    raise exception 'Booking line item snapshot count mismatch'
      using errcode = 'PB002';
  end if;

  select
    organization.invoice_timing,
    pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'booking_id', new_booking_id,
      'organization_id', p_organization_id,
      'public_request_id', p_request_id,
      'app_url', coalesce(nullif(pg_catalog.btrim(p_app_url), ''), ''),
      'organization', pg_catalog.jsonb_build_object(
        'name', organization.name,
        'from_name', coalesce(nullif(organization.email_from_name, ''), organization.name),
        'reply_to_email', coalesce(
          nullif(organization.reply_to_email, ''),
          nullif(organization.admin_notification_email, ''),
          nullif(pg_catalog.btrim(p_admin_notification_email), '')
        ),
        'admin_notification_email', coalesce(
          nullif(organization.admin_notification_email, ''),
          nullif(pg_catalog.btrim(p_admin_notification_email), '')
        )
      ),
      'realtor', pg_catalog.jsonb_build_object(
        'id', profile.id,
        'email', profile.email,
        'full_name', coalesce(nullif(profile.full_name, ''), profile.email),
        'phone', profile.phone,
        'brokerage', profile.brokerage,
        'delivery_cc_emails', coalesce(profile.delivery_cc_emails, '{}'::text[])
      ),
      'property', pg_catalog.jsonb_build_object(
        'street_address', p_street_address,
        'city', nullif(p_city, ''),
        'postal_code', nullif(p_postal_code, ''),
        'unit_number', nullif(pg_catalog.btrim(p_unit_number), '')
      ),
      'booking', pg_catalog.jsonb_build_object(
        'scheduled_at', p_scheduled_at,
        'scheduled_ends_at', scheduled_ends_at,
        'square_footage', p_square_footage,
        'is_vacant', p_is_vacant,
        'include_basement', p_include_basement,
        'client_notes', coalesce(p_client_notes, '')
      ),
      'line_items', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'catalog_item_id', line.catalog_item_id,
            'name', line.item_name,
            'slug', line.item_slug,
            'kind', line.item_kind,
            'quantity', line.quantity,
            'unit_price_cents', line.unit_price_cents,
            'unit_duration_minutes', line.unit_duration_minutes
          ) order by
            case
              when line.item_kind = 'addon' then
                pg_catalog.cardinality(p_service_item_ids)
                + pg_catalog.array_position(p_add_on_item_ids, line.catalog_item_id)
              else pg_catalog.array_position(p_service_item_ids, line.catalog_item_id)
            end
        )
        from public.booking_line_items line
        where line.booking_id = new_booking_id
      ), '[]'::jsonb)
    )
    into invoice_timing, job_payload
  from public.organizations organization
  join public.profiles profile
    on profile.id = p_owner_id
   and profile.organization_id = organization.id
  where organization.id = p_organization_id;

  if job_payload is null then
    raise exception 'Unable to derive immutable integration payload'
      using errcode = 'PB001';
  end if;

  insert into public.integration_jobs (
    organization_id,
    booking_id,
    job_type,
    idempotency_key,
    payload
  )
  select
    p_organization_id,
    new_booking_id,
    job.job_type,
    'booking:' || new_booking_id::text || ':' || job.job_type || ':v1',
    job_payload
  from (
    values
      ('quickbooks.invoice.create'::text),
      ('google_calendar.event.create'::text),
      ('email.booking.confirmation'::text),
      ('email.admin.new_booking'::text),
      ('push.admin.new_booking'::text)
  ) as job(job_type)
  where job.job_type <> 'quickbooks.invoice.create'
     or invoice_timing = 'at_booking';

  return pg_catalog.jsonb_build_object(
    'booking_id', new_booking_id,
    'property_id', new_property_id,
    'scheduled_ends_at', scheduled_ends_at,
    'replayed', false
  );
end;
$$;

create or replace function public.claim_integration_job(
  p_organization_id uuid,
  p_booking_id uuid,
  p_job_type text,
  p_worker_id text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed record;
begin
  if p_lease_token is null or nullif(pg_catalog.btrim(p_worker_id), '') is null then
    raise exception 'Integration job lease identity is required'
      using errcode = 'PB003';
  end if;

  -- Expired ambiguous provider attempts are terminalized for reconciliation instead
  -- of being blindly replayed. Email attempts are reclaimable because Resend is
  -- called with the durable provider idempotency key.
  update public.integration_jobs job
  set status = 'dead_letter',
      completed_at = pg_catalog.now(),
      last_error_code = 'lease_expired_ambiguous',
      last_error_message = 'Provider attempt lease expired; manual reconciliation required',
      last_error_at = pg_catalog.now(),
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.status = 'processing'
    and job.lease_expires_at <= pg_catalog.now()
    and (
      job.job_type not in (
        'email.booking.confirmation',
        'email.admin.new_booking'
      )
      or job.attempts >= job.max_attempts
      or job.created_at <= pg_catalog.now() - interval '23 hours'
    );

  -- Retryable means a provider attempt already happened. Once Resend's
  -- idempotency window is near expiry, another email attempt is unsafe.
  update public.integration_jobs job
  set status = 'dead_letter',
      completed_at = pg_catalog.now(),
      last_error_code = 'provider_idempotency_window_expired',
      last_error_message = 'Email retry exceeded the safe provider idempotency window',
      last_error_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.status = 'retryable'
    and job.job_type in ('email.booking.confirmation', 'email.admin.new_booking')
    and job.created_at <= pg_catalog.now() - interval '23 hours';

  update public.integration_jobs job
  set status = 'processing',
      attempts = job.attempts + 1,
      lease_token = p_lease_token,
      locked_by = pg_catalog.btrim(p_worker_id),
      locked_at = pg_catalog.now(),
      lease_expires_at = pg_catalog.now() + interval '10 minutes',
      completed_at = null,
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.attempts < job.max_attempts
    and (
      job.job_type <> 'email.booking.confirmation'
      or not exists (
        select 1
        from public.integration_jobs invoice_job
        where invoice_job.organization_id = job.organization_id
          and invoice_job.booking_id = job.booking_id
          and invoice_job.job_type = 'quickbooks.invoice.create'
          and invoice_job.status not in ('completed', 'skipped', 'cancelled', 'dead_letter')
      )
    )
    and (
      (
        (
          job.status = 'pending'
          or (
            job.status = 'retryable'
            and (
              job.job_type not in ('email.booking.confirmation', 'email.admin.new_booking')
              or job.created_at > pg_catalog.now() - interval '23 hours'
            )
          )
        )
        and job.next_attempt_at <= pg_catalog.now()
      )
      or (
        job.status = 'processing'
        and job.lease_expires_at <= pg_catalog.now()
        and job.created_at > pg_catalog.now() - interval '23 hours'
        and job.job_type in (
          'email.booking.confirmation',
          'email.admin.new_booking'
        )
      )
    )
  returning job.* into claimed;

  if not found then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', claimed.id,
    'organization_id', claimed.organization_id,
    'booking_id', claimed.booking_id,
    'job_type', claimed.job_type,
    'payload_version', claimed.payload_version,
    'idempotency_key', claimed.idempotency_key,
    'payload', claimed.payload,
    'dependency_result', case
      when claimed.job_type = 'email.booking.confirmation' then (
        select invoice_job.provider_result
        from public.integration_jobs invoice_job
        where invoice_job.organization_id = claimed.organization_id
          and invoice_job.booking_id = claimed.booking_id
          and invoice_job.job_type = 'quickbooks.invoice.create'
          and invoice_job.status = 'completed'
        limit 1
      )
      else null
    end,
    'attempts', claimed.attempts,
    'max_attempts', claimed.max_attempts,
    'lease_token', p_lease_token
  );
end;
$$;

create or replace function public.finish_integration_job(
  p_organization_id uuid,
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_provider_external_id text,
  p_provider_result jsonb,
  p_error_code text,
  p_error_message text,
  p_next_attempt_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_id uuid;
  current_attempts integer;
  current_max_attempts integer;
  final_status text;
begin
  if p_status not in ('completed', 'skipped', 'retryable', 'dead_letter') then
    raise exception 'Invalid integration job completion status'
      using errcode = 'PB003';
  end if;

  select job.attempts, job.max_attempts
    into current_attempts, current_max_attempts
  from public.integration_jobs job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.status = 'processing'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > pg_catalog.now()
  for update;

  if not found then
    return false;
  end if;

  final_status := case
    when p_status = 'retryable' and current_attempts >= current_max_attempts
      then 'dead_letter'
    else p_status
  end;

  update public.integration_jobs job
  set status = final_status,
      provider_external_id = nullif(p_provider_external_id, ''),
      provider_result = coalesce(p_provider_result, '{}'::jsonb),
      last_error_code = case
        when final_status in ('retryable', 'dead_letter') then nullif(p_error_code, '')
        else null
      end,
      last_error_message = case
        when final_status in ('retryable', 'dead_letter') then nullif(p_error_message, '')
        else null
      end,
      last_error_at = case
        when final_status in ('retryable', 'dead_letter') then pg_catalog.now()
        else null
      end,
      next_attempt_at = case
        when final_status = 'retryable'
          then coalesce(p_next_attempt_at, pg_catalog.now() + interval '5 minutes')
        else job.next_attempt_at
      end,
      completed_at = case
        when final_status in ('completed', 'skipped', 'dead_letter') then pg_catalog.now()
        else null
      end,
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.status = 'processing'
    and job.lease_token = p_lease_token
  returning job.id into changed_id;

  return changed_id is not null;
end;
$$;

revoke all on function public.is_valid_booking_integration_payload(jsonb, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.is_valid_booking_integration_payload(jsonb, uuid, uuid)
  to service_role;

revoke all on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) to service_role;

revoke all on function public.claim_integration_job(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_integration_job(uuid, uuid, text, text, uuid)
  to service_role;

revoke all on function public.finish_integration_job(
  uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.finish_integration_job(
  uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz
) to service_role;

comment on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) is
  'Atomically derives tenant catalog pricing/duration, reuses or creates property, creates booking + snapshots, and commits durable integration jobs.';
comment on function public.claim_integration_job(uuid, uuid, text, text, uuid) is
  'Leases pending/retryable work, reclaims expired idempotent email attempts only inside a 23-hour provider window, and terminalizes older or ambiguous attempts.';
comment on function public.finish_integration_job(
  uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz
) is
  'Completes a leased integration job only when tenant, job, and lease token all match.';

-- ============================================================================
-- End supabase/migrations/20260718202432_atomic_public_booking_outbox.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260719124500_integration_outbox_recovery_reconciliation.sql
-- ============================================================================

-- Add scheduled recovery discovery and operator reconciliation without changing
-- immutable job identity, lease fencing, provider idempotency, or ambiguity rules.

alter table public.integration_jobs
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciled_by uuid,
  add column if not exists reconciliation_category text,
  add column if not exists reconciliation_note text;

alter table public.integration_jobs
  add constraint integration_jobs_reconciliation_audit_check check (
    (reconciled_at is null
      and reconciled_by is null
      and reconciliation_category is null
      and reconciliation_note is null)
    or
    (reconciled_at is not null
      and reconciled_by is not null
      and reconciliation_category in (
        'provider_confirmed_completed',
        'provider_confirmed_absent',
        'duplicate_resolved',
        'accepted_manual_resolution'
      )
      and pg_catalog.char_length(reconciliation_note) between 10 and 2000)
  );

create or replace function public.preserve_integration_job_reconciliation_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.reconciled_at is not null
    and (
      new.reconciled_at,
      new.reconciled_by,
      new.reconciliation_category,
      new.reconciliation_note
    ) is distinct from (
      old.reconciled_at,
      old.reconciled_by,
      old.reconciliation_category,
      old.reconciliation_note
    )
  then
    raise exception 'Completed integration reconciliation audit is immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger preserve_integration_job_reconciliation_audit_trigger
before update on public.integration_jobs
for each row execute function public.preserve_integration_job_reconciliation_audit();

-- A retryable state means a mutation can be attempted again automatically.
-- Only Resend jobs have a durable provider idempotency key and bounded window.
update public.integration_jobs job
set status = 'dead_letter',
    completed_at = pg_catalog.now(),
    last_error_code = 'unsafe_retryable_status',
    last_error_message = 'Non-email provider work cannot be automatically retried',
    last_error_at = pg_catalog.now(),
    lease_token = null,
    locked_by = null,
    locked_at = null,
    lease_expires_at = null,
    updated_at = pg_catalog.now()
where job.status = 'retryable'
  and job.job_type not in (
    'email.booking.confirmation',
    'email.admin.new_booking'
  );

alter table public.integration_jobs
  add constraint integration_jobs_retryable_email_only_check check (
    status <> 'retryable'
    or job_type in (
      'email.booking.confirmation',
      'email.admin.new_booking'
    )
  );

create index integration_jobs_unresolved_exceptions_idx
  on public.integration_jobs(organization_id, updated_at desc, id)
  where reconciled_at is null
    and status in ('retryable', 'dead_letter', 'processing');

create or replace function public.list_due_integration_jobs(
  p_limit integer,
  p_dispatch_not_before timestamptz
)
returns table (
  organization_id uuid,
  booking_id uuid,
  job_type text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Integration dispatch limit must be between 1 and 50'
      using errcode = 'PB003';
  end if;
  if p_dispatch_not_before is null
    or not pg_catalog.isfinite(p_dispatch_not_before)
  then
    raise exception 'Integration dispatch watermark is required'
      using errcode = 'PB003';
  end if;

  return query
  with eligible as (
    select
      job.organization_id,
      job.booking_id,
      job.job_type,
      job.id,
      job.created_at,
      case
        when job.status = 'processing' then job.lease_expires_at
        else job.next_attempt_at
      end as due_at,
      case job.job_type
        when 'quickbooks.invoice.create' then 1
        when 'google_calendar.event.create' then 2
        when 'email.booking.confirmation' then 3
        when 'email.admin.new_booking' then 4
        when 'push.admin.new_booking' then 5
        else 99
      end as job_priority
    from public.integration_jobs job
    join public.bookings booking
      on booking.organization_id = job.organization_id
     and booking.id = job.booking_id
    where job.created_at >= p_dispatch_not_before
      and (
        (
          job.status = 'pending'
          and job.attempts < job.max_attempts
          and job.next_attempt_at <= pg_catalog.now()
        )
        or (
          job.status = 'retryable'
          and job.attempts < job.max_attempts
          and job.job_type in (
            'email.booking.confirmation',
            'email.admin.new_booking'
          )
          and job.next_attempt_at <= pg_catalog.now()
        )
        or (
          job.status = 'processing'
          and job.lease_expires_at <= pg_catalog.now()
        )
      )
  ), booking_heads as (
    select eligible.*,
      pg_catalog.row_number() over (
        partition by eligible.organization_id, eligible.booking_id
        order by eligible.job_priority, eligible.due_at, eligible.created_at, eligible.id
      ) as booking_position
    from eligible
  ), tenant_ranked as (
    select booking_heads.*,
      pg_catalog.row_number() over (
        partition by booking_heads.organization_id
        order by booking_heads.booking_position, booking_heads.due_at,
          booking_heads.job_priority, booking_heads.created_at,
          booking_heads.booking_id, booking_heads.id
      ) as tenant_position
    from booking_heads
  )
  select
    tenant_ranked.organization_id,
    tenant_ranked.booking_id,
    tenant_ranked.job_type
  from tenant_ranked
  order by
    tenant_ranked.tenant_position,
    tenant_ranked.due_at,
    tenant_ranked.job_priority,
    tenant_ranked.organization_id,
    tenant_ranked.booking_id
  limit p_limit;
end;
$$;

create or replace function public.reconcile_integration_job(
  p_organization_id uuid,
  p_job_id uuid,
  p_category text,
  p_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  changed_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;
  if pg_catalog.btrim(coalesce(p_category, '')) not in (
    'provider_confirmed_completed',
    'provider_confirmed_absent',
    'duplicate_resolved',
    'accepted_manual_resolution'
  ) then
    raise exception 'A valid reconciliation category is required'
      using errcode = 'PB003';
  end if;
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_note, ''))) not between 10 and 2000 then
    raise exception 'Reconciliation note must be between 10 and 2000 characters'
      using errcode = 'PB003';
  end if;
  if not exists (
    select 1
    from public.organization_members membership
    join public.profiles profile
      on profile.id = membership.profile_id
     and profile.organization_id = membership.organization_id
     and profile.archived_at is null
    where membership.organization_id = p_organization_id
      and membership.profile_id = actor_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception 'Organization admin access is required'
      using errcode = '42501';
  end if;

  update public.integration_jobs job
  set reconciled_at = pg_catalog.now(),
      reconciled_by = actor_id,
      reconciliation_category = pg_catalog.btrim(p_category),
      reconciliation_note = pg_catalog.btrim(p_note),
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.id = p_job_id
    and job.status = 'dead_letter'
    and job.reconciled_at is null
  returning job.id into changed_id;

  return changed_id is not null;
end;
$$;

-- Preserve the existing claim behavior while bounding stored worker identity.
create or replace function public.claim_integration_job(
  p_organization_id uuid,
  p_booking_id uuid,
  p_job_type text,
  p_worker_id text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed record;
begin
  if p_lease_token is null
    or nullif(pg_catalog.btrim(p_worker_id), '') is null
    or pg_catalog.char_length(p_worker_id) > 96
  then
    raise exception 'Integration job lease identity is required and bounded'
      using errcode = 'PB003';
  end if;

  -- Cancellation is authoritative at claim time. Unleased work is terminalized
  -- without a provider call; an expired processing lease remains ambiguous.
  update public.integration_jobs job
  set status = 'cancelled',
      completed_at = pg_catalog.now(),
      last_error_code = 'booking_cancelled',
      last_error_message = 'Booking was cancelled before integration dispatch',
      last_error_at = pg_catalog.now(),
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  from public.bookings booking
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and booking.organization_id = job.organization_id
    and booking.id = job.booking_id
    and booking.status = 'cancelled'
    and job.status in ('pending', 'retryable');

  update public.integration_jobs job
  set status = 'dead_letter',
      completed_at = pg_catalog.now(),
      last_error_code = 'lease_expired_ambiguous',
      last_error_message = 'Provider attempt lease expired after booking cancellation; reconciliation required',
      last_error_at = pg_catalog.now(),
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  from public.bookings booking
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and booking.organization_id = job.organization_id
    and booking.id = job.booking_id
    and booking.status = 'cancelled'
    and job.status = 'processing'
    and job.lease_expires_at <= pg_catalog.now();

  update public.integration_jobs job
  set status = 'dead_letter',
      completed_at = pg_catalog.now(),
      last_error_code = 'lease_expired_ambiguous',
      last_error_message = 'Provider attempt lease expired; manual reconciliation required',
      last_error_at = pg_catalog.now(),
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.status = 'processing'
    and job.lease_expires_at <= pg_catalog.now()
    and (
      job.job_type not in (
        'email.booking.confirmation',
        'email.admin.new_booking'
      )
      or job.attempts >= job.max_attempts
      or job.created_at <= pg_catalog.now() - interval '23 hours'
    );

  update public.integration_jobs job
  set status = 'dead_letter',
      completed_at = pg_catalog.now(),
      last_error_code = 'provider_idempotency_window_expired',
      last_error_message = 'Email retry exceeded the safe provider idempotency window',
      last_error_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.status = 'retryable'
    and job.job_type in ('email.booking.confirmation', 'email.admin.new_booking')
    and job.created_at <= pg_catalog.now() - interval '23 hours';

  update public.integration_jobs job
  set status = 'processing',
      attempts = job.attempts + 1,
      lease_token = p_lease_token,
      locked_by = pg_catalog.btrim(p_worker_id),
      locked_at = pg_catalog.now(),
      lease_expires_at = pg_catalog.now() + interval '10 minutes',
      completed_at = null,
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.attempts < job.max_attempts
    and exists (
      select 1
      from public.bookings booking
      where booking.organization_id = job.organization_id
        and booking.id = job.booking_id
        and booking.status <> 'cancelled'
    )
    and (
      job.job_type <> 'email.booking.confirmation'
      or not exists (
        select 1
        from public.integration_jobs invoice_job
        where invoice_job.organization_id = job.organization_id
          and invoice_job.booking_id = job.booking_id
          and invoice_job.job_type = 'quickbooks.invoice.create'
          and invoice_job.status not in ('completed', 'skipped', 'cancelled', 'dead_letter')
      )
    )
    and (
      (
        (
          job.status = 'pending'
          or (
            job.status = 'retryable'
            and job.job_type in (
              'email.booking.confirmation',
              'email.admin.new_booking'
            )
            and job.created_at > pg_catalog.now() - interval '23 hours'
          )
        )
        and job.next_attempt_at <= pg_catalog.now()
      )
      or (
        job.status = 'processing'
        and job.lease_expires_at <= pg_catalog.now()
        and job.created_at > pg_catalog.now() - interval '23 hours'
        and job.job_type in (
          'email.booking.confirmation',
          'email.admin.new_booking'
        )
      )
    )
  returning job.* into claimed;

  if not found then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', claimed.id,
    'organization_id', claimed.organization_id,
    'booking_id', claimed.booking_id,
    'job_type', claimed.job_type,
    'payload_version', claimed.payload_version,
    'idempotency_key', claimed.idempotency_key,
    'payload', claimed.payload,
    'dependency_result', case
      when claimed.job_type = 'email.booking.confirmation' then (
        select invoice_job.provider_result
        from public.integration_jobs invoice_job
        where invoice_job.organization_id = claimed.organization_id
          and invoice_job.booking_id = claimed.booking_id
          and invoice_job.job_type = 'quickbooks.invoice.create'
          and invoice_job.status = 'completed'
        limit 1
      )
      else null
    end,
    'attempts', claimed.attempts,
    'max_attempts', claimed.max_attempts,
    'lease_token', p_lease_token
  );
end;
$$;

revoke all on function public.list_due_integration_jobs(integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.list_due_integration_jobs(integer, timestamptz)
  to service_role;

revoke all on function public.reconcile_integration_job(uuid, uuid, text, text)
  from public, anon, service_role;
grant execute on function public.reconcile_integration_job(uuid, uuid, text, text)
  to authenticated;

revoke all on function public.claim_integration_job(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_integration_job(uuid, uuid, text, text, uuid)
  to service_role;

comment on function public.list_due_integration_jobs(integer, timestamptz) is
  'Service-only identities list for tenant-fair scheduled recovery, bounded by a rollout cutoff.';
comment on function public.reconcile_integration_job(uuid, uuid, text, text) is
  'Single-use tenant-admin audit acknowledgement for an unresolved dead-letter job; never retries provider work.';

-- ============================================================================
-- End supabase/migrations/20260719124500_integration_outbox_recovery_reconciliation.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260720120000_beta_company_invitations.sql
-- ============================================================================

-- Durable private-beta invitation state machine and hidden onboarding tenants.
-- Raw bearer tokens are never stored; only SHA-256 hex hashes are persisted.

set lock_timeout = '5s';

create table public.beta_company_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  invited_by uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'confirmed', 'unconfirmed')),
  delivery_attempted_at timestamptz,
  status text not null default 'issued'
    check (status in ('issued', 'provisioning', 'completed', 'revoked', 'reconciliation_required')),
  revoked_at timestamptz,
  consumed_at timestamptz,
  organization_id uuid unique,
  auth_user_id uuid unique,
  auth_provisioning_key text,
  provisioning_deadline timestamptz,
  admin_name text,
  company_name text,
  company_slug text,
  primary_color text,
  accent_color text,
  copy_catalog boolean,
  source_catalog_organization_id uuid,
  constraint beta_company_invites_email_normalized_check
    check (email = lower(btrim(email)) and position('@' in email) > 1),
  constraint beta_company_invites_token_hash_check
    check (length(token_hash) = 64 and token_hash ~ '^[0-9a-f]{64}$'),
  constraint beta_company_invites_auth_provisioning_key_check
    check (
      auth_provisioning_key is null
      or (
        length(auth_provisioning_key) = 64
        and auth_provisioning_key ~ '^[0-9a-f]{64}$'
      )
    ),
  constraint beta_company_invites_expiry_check check (expires_at > created_at),
  constraint beta_company_invites_revocation_check
    check ((status = 'revoked') = (revoked_at is not null)),
  constraint beta_company_invites_completion_check
    check ((status = 'completed') = (consumed_at is not null)),
  constraint beta_company_invites_terminal_state_check
    check (not (consumed_at is not null and revoked_at is not null))
);

alter table public.organizations
  add column lifecycle_status text not null default 'active'
    check (lifecycle_status in ('onboarding', 'active', 'suspended')),
  add column beta_invitation_id uuid unique
    references public.beta_company_invites(id) on delete restrict;

alter table public.beta_company_invites
  add constraint beta_company_invites_organization_fkey
  foreign key (organization_id) references public.organizations(id) on delete restrict;

create index beta_company_invites_email_created_idx
  on public.beta_company_invites (email, created_at desc);

alter table public.beta_company_invites enable row level security;

create or replace function public.guard_beta_auth_email_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(new.email));
  reservation record;
begin
  if normalized_email is null or normalized_email = '' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_email, 0)
  );

  select b.id, b.status, b.auth_provisioning_key
  into reservation
  from public.beta_company_invites b
  where b.email = normalized_email
    and b.status in ('issued', 'provisioning', 'reconciliation_required')
  order by b.created_at desc
  limit 1;

  if not found then
    return new;
  end if;

  if reservation.status <> 'provisioning'
     or reservation.auth_provisioning_key is null
     or coalesce(new.raw_user_meta_data ->> 'beta_provisioning_key', '')
        <> reservation.auth_provisioning_key then
    raise exception 'email is reserved for beta company provisioning';
  end if;

  return new;
end;
$$;

create trigger guard_beta_auth_email_reservation
before insert or update of email on auth.users
for each row execute function public.guard_beta_auth_email_reservation();

create or replace function public.protect_beta_organization_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and (
       new.lifecycle_status is distinct from old.lifecycle_status
       or new.beta_invitation_id is distinct from old.beta_invitation_id
     ) then
    raise exception 'organization lifecycle is platform-controlled';
  end if;
  return new;
end;
$$;

create trigger protect_beta_organization_lifecycle
before update of lifecycle_status, beta_invitation_id on public.organizations
for each row execute function public.protect_beta_organization_lifecycle();

create or replace function public.is_beta_platform_actor(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.organization_members om
      on om.profile_id = p.id
     and om.organization_id = p.organization_id
    where p.id = p_actor_id
      and p.organization_id = '00000000-0000-0000-0000-000000000001'::uuid
      and p.archived_at is null
      and om.role in ('owner', 'admin')
  );
$$;

create or replace function public.find_beta_auth_user_by_email(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(p_email));
  found_count integer;
  auth_row jsonb;
begin
  if normalized_email = '' or position('@' in normalized_email) <= 1 then
    raise exception 'invalid beta invitation email';
  end if;
  select count(*) into found_count
  from auth.users u
  where lower(u.email) = normalized_email;
  if found_count > 1 then
    raise exception 'ambiguous beta auth identity';
  end if;
  select pg_catalog.jsonb_build_object(
    'user_id', u.id,
    'company_invitation_id', u.raw_app_meta_data ->> 'company_invitation_id',
    'has_profile', exists(select 1 from public.profiles p where p.id = u.id)
  ) into auth_row
  from auth.users u
  where lower(u.email) = normalized_email;
  return auth_row;
end;
$$;

create or replace function public.issue_beta_company_invite(
  p_email text,
  p_token_hash text,
  p_invited_by uuid,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(p_email));
  invite_id uuid;
begin
  if normalized_email = '' or position('@' in normalized_email) <= 1 then
    raise exception 'invalid beta invitation email';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid beta invitation token hash';
  end if;
  if p_expires_at <= pg_catalog.now() + interval '1 hour'
     or p_expires_at > pg_catalog.now() + interval '14 days' then
    raise exception 'invalid beta invitation expiry';
  end if;
  if not public.is_beta_platform_actor(p_invited_by) then
    raise exception 'invalid beta invitation actor';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_email, 0)
  );

  if exists (
    select 1 from auth.users u where lower(u.email) = normalized_email
  ) then
    raise exception 'that email already has an Auth identity';
  end if;

  update public.beta_company_invites
  set status = 'revoked', revoked_at = pg_catalog.now()
  where email = normalized_email
    and status = 'issued'
    and expires_at <= pg_catalog.now();

  if exists (
    select 1 from public.beta_company_invites b
    where b.email = normalized_email
      and b.status in ('provisioning', 'reconciliation_required')
  ) then
    raise exception 'that email already has company provisioning in progress';
  end if;

  select b.id into invite_id
  from public.beta_company_invites b
  where b.email = normalized_email and b.status = 'issued'
  order by b.created_at desc
  limit 1;
  if invite_id is not null then
    return pg_catalog.jsonb_build_object(
      'id', invite_id,
      'created', false,
      'expires_at', (select b.expires_at from public.beta_company_invites b where b.id = invite_id),
      'delivery_status', (select b.delivery_status from public.beta_company_invites b where b.id = invite_id)
    );
  end if;

  insert into public.beta_company_invites (
    email, token_hash, invited_by, expires_at
  ) values (
    normalized_email, p_token_hash, p_invited_by, p_expires_at
  ) returning id into invite_id;

  return pg_catalog.jsonb_build_object(
    'id', invite_id,
    'created', true,
    'expires_at', p_expires_at,
    'delivery_status', 'pending'
  );
end;
$$;

create or replace function public.mark_beta_company_invite_delivery(
  p_invite_id uuid,
  p_delivery_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_delivery_status not in ('confirmed', 'unconfirmed') then
    return false;
  end if;
  update public.beta_company_invites
  set delivery_status = p_delivery_status,
      delivery_attempted_at = pg_catalog.now()
  where id = p_invite_id and status <> 'revoked';
  return found;
end;
$$;

create or replace function public.begin_beta_company_onboarding(
  p_token_hash text,
  p_admin_name text,
  p_company_name text,
  p_company_slug text,
  p_primary_color text,
  p_accent_color text,
  p_copy_catalog boolean,
  p_source_catalog_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.beta_company_invites%rowtype;
  normalized_admin_name text := btrim(p_admin_name);
  normalized_company_name text := btrim(p_company_name);
  normalized_slug text := lower(btrim(p_company_slug));
  normalized_primary text := lower(btrim(p_primary_color));
  normalized_accent text := lower(btrim(p_accent_color));
  new_organization_id uuid;
  new_auth_provisioning_key text;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid beta invitation';
  end if;

  select * into invite
  from public.beta_company_invites b
  where b.token_hash = p_token_hash
  for update;

  if not found
     or invite.revoked_at is not null
     or invite.consumed_at is not null
     or invite.expires_at <= pg_catalog.now()
     or invite.status not in ('issued', 'provisioning') then
    raise exception 'invalid beta invitation';
  end if;
  if length(normalized_admin_name) < 2 or length(normalized_admin_name) > 80
     or length(normalized_company_name) < 2 or length(normalized_company_name) > 80
     or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(normalized_slug) > 60
     or normalized_primary !~ '^#[0-9a-f]{6}$'
     or normalized_accent !~ '^#[0-9a-f]{6}$'
     or not exists (
       select 1 from public.organizations o
       where o.id = p_source_catalog_organization_id
     ) then
    raise exception 'invalid beta company details';
  end if;

  if invite.status = 'provisioning' then
    if invite.provisioning_deadline <= pg_catalog.now() then
      update public.beta_company_invites
      set status = 'reconciliation_required'
      where id = invite.id;
      return pg_catalog.jsonb_build_object(
        'invitation_id', invite.id,
        'organization_id', invite.organization_id,
        'email', invite.email,
        'state', 'reconciliation_required'
      );
    end if;
    if invite.admin_name is distinct from normalized_admin_name
       or invite.company_name is distinct from normalized_company_name
       or invite.company_slug is distinct from normalized_slug
       or invite.primary_color is distinct from normalized_primary
       or invite.accent_color is distinct from normalized_accent
       or invite.copy_catalog is distinct from p_copy_catalog
       or invite.source_catalog_organization_id is distinct from p_source_catalog_organization_id then
      raise exception 'company inputs do not match the provisioning attempt';
    end if;
    return pg_catalog.jsonb_build_object(
      'invitation_id', invite.id,
      'organization_id', invite.organization_id,
      'email', invite.email,
      'auth_provisioning_key', invite.auth_provisioning_key,
      'state', 'resumed'
    );
  end if;

  new_organization_id := gen_random_uuid();
  new_auth_provisioning_key := encode(
    extensions.gen_random_bytes(32),
    'hex'
  );
  insert into public.organizations (
    id, name, slug, primary_color, accent_color,
    email_from_name, reply_to_email, admin_notification_email,
    lifecycle_status, beta_invitation_id
  ) values (
    new_organization_id, normalized_company_name, normalized_slug,
    normalized_primary, normalized_accent, normalized_company_name,
    invite.email, invite.email, 'onboarding', invite.id
  );

  update public.beta_company_invites
  set status = 'provisioning',
      organization_id = new_organization_id,
      auth_provisioning_key = new_auth_provisioning_key,
      provisioning_deadline = least(expires_at, pg_catalog.now() + interval '30 minutes'),
      admin_name = normalized_admin_name,
      company_name = normalized_company_name,
      company_slug = normalized_slug,
      primary_color = normalized_primary,
      accent_color = normalized_accent,
      copy_catalog = p_copy_catalog,
      source_catalog_organization_id = p_source_catalog_organization_id
  where id = invite.id;

  return pg_catalog.jsonb_build_object(
    'invitation_id', invite.id,
    'organization_id', new_organization_id,
    'email', invite.email,
    'auth_provisioning_key', new_auth_provisioning_key,
    'state', 'started'
  );
end;
$$;

create or replace function public.complete_beta_company_onboarding(
  p_token_hash text,
  p_auth_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.beta_company_invites%rowtype;
begin
  select * into invite
  from public.beta_company_invites b
  where b.token_hash = p_token_hash
  for update;

  if not found then return false; end if;
  if invite.status = 'completed' then
    return invite.auth_user_id = p_auth_user_id;
  end if;
  if invite.status <> 'provisioning'
     or invite.revoked_at is not null
     or invite.consumed_at is not null
     or invite.provisioning_deadline <= pg_catalog.now() then
    return false;
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = p_auth_user_id
      and lower(u.email) = invite.email
      and u.raw_app_meta_data ->> 'company_invitation_id' = invite.id::text
  ) then
    raise exception 'beta invitation identity mismatch';
  end if;
  if not exists (
    select 1
    from public.organization_members om
    join public.profiles p on p.id = om.profile_id
    where om.organization_id = invite.organization_id
      and om.profile_id = p_auth_user_id
      and om.role = 'owner'
      and p.organization_id = invite.organization_id
      and p.archived_at is null
      and lower(p.email) = invite.email
  ) then
    raise exception 'beta invitation owner mismatch';
  end if;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    - 'beta_provisioning_key'
  where id = p_auth_user_id;

  update public.beta_company_invites
  set status = 'completed',
      auth_user_id = p_auth_user_id,
      auth_provisioning_key = null,
      consumed_at = pg_catalog.now()
  where id = invite.id;
  return true;
end;
$$;

create or replace function public.resume_beta_company_onboarding(
  p_invite_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_beta_platform_actor(p_actor_id) then
    raise exception 'invalid beta reconciliation actor';
  end if;
  update public.beta_company_invites b
  set status = 'provisioning',
      provisioning_deadline = pg_catalog.now() + interval '30 minutes'
  where b.id = p_invite_id
    and (
      b.status = 'reconciliation_required'
      or (
        b.status = 'provisioning'
        and b.provisioning_deadline <= pg_catalog.now()
      )
    )
    and b.organization_id is not null;
  return found;
end;
$$;

create or replace function public.revoke_beta_company_invite(
  p_invite_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_beta_platform_actor(p_actor_id) then
    raise exception 'invalid beta invitation actor';
  end if;
  update public.beta_company_invites
  set status = 'revoked', revoked_at = pg_catalog.now()
  where id = p_invite_id and status = 'issued';
  return found;
end;
$$;

create or replace function public.activate_beta_company(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_beta_platform_actor(p_actor_id) then
    raise exception 'invalid beta activation actor';
  end if;
  update public.organizations o
  set lifecycle_status = 'active'
  where o.id = p_organization_id
    and o.lifecycle_status = 'onboarding'
    and exists (
      select 1 from public.beta_company_invites b
      where b.id = o.beta_invitation_id
        and b.status = 'completed'
        and b.organization_id = o.id
    );
  return found;
end;
$$;

revoke all on table public.beta_company_invites from public, anon, authenticated;
grant select on table public.beta_company_invites to service_role;

revoke all on function public.guard_beta_auth_email_reservation() from public, anon, authenticated;
revoke all on function public.protect_beta_organization_lifecycle() from public, anon, authenticated;
revoke all on function public.is_beta_platform_actor(uuid) from public, anon, authenticated;
grant execute on function public.is_beta_platform_actor(uuid) to service_role;
revoke all on function public.find_beta_auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.find_beta_auth_user_by_email(text) to service_role;

revoke all on function public.issue_beta_company_invite(text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.issue_beta_company_invite(text, text, uuid, timestamptz) to service_role;
revoke all on function public.mark_beta_company_invite_delivery(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_beta_company_invite_delivery(uuid, text) to service_role;
revoke all on function public.begin_beta_company_onboarding(text, text, text, text, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.begin_beta_company_onboarding(text, text, text, text, text, text, boolean, uuid) to service_role;
revoke all on function public.complete_beta_company_onboarding(text, uuid) from public, anon, authenticated;
grant execute on function public.complete_beta_company_onboarding(text, uuid) to service_role;
revoke all on function public.resume_beta_company_onboarding(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resume_beta_company_onboarding(uuid, uuid) to service_role;
revoke all on function public.revoke_beta_company_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_beta_company_invite(uuid, uuid) to service_role;
revoke all on function public.activate_beta_company(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_beta_company(uuid, uuid) to service_role;

comment on table public.beta_company_invites is
  'Private-beta invitation state. Raw bearer and provider tokens are never stored.';

reset lock_timeout;

-- ============================================================================
-- End supabase/migrations/20260720120000_beta_company_invitations.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260720173000_persist_quiet_admin_bookings.sql
-- ============================================================================

-- Persist the admin's quiet-booking choice so later reminders and Calendar
-- reconciliation cannot contact the realtor after creation.

alter table public.bookings
  add column if not exists suppress_realtor_notifications boolean not null default false;

comment on column public.bookings.suppress_realtor_notifications is
  'When true, automatic realtor-facing booking emails, reminders, and Google Calendar attendee invitations are suppressed.';

-- ============================================================================
-- End supabase/migrations/20260720173000_persist_quiet_admin_bookings.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260810173824_aerial_addon_catalog_rules.sql
-- ============================================================================

alter table public.catalog_items
  add column if not exists is_iguide boolean not null default false,
  add column if not exists is_aerial boolean not null default false,
  add column if not exists require_has_media boolean not null default false,
  add column if not exists exclude_has_aerial boolean not null default false;

comment on column public.catalog_items.is_iguide is
  'True when this catalog item includes iGUIDE, floor-plan, or measurement coverage.';
comment on column public.catalog_items.is_aerial is
  'True when this catalog item includes aerial/drone coverage.';
comment on column public.catalog_items.require_has_media is
  'For add-ons, require a selected non-add-on with photo, video, or iGUIDE coverage.';
comment on column public.catalog_items.exclude_has_aerial is
  'For add-ons, hide and reject the item when a selected non-add-on already includes aerial coverage.';

alter table public.catalog_items
  add constraint catalog_item_addon_rules_only
  check (
    kind = 'addon'
    or (require_has_media = false and exclude_has_aerial = false)
  );

update public.catalog_items
set is_iguide = true
where slug in (
  'iguide_measurements',
  'blue_print',
  'social_media_special',
  'social_media_plus',
  'ultimate'
);

update public.catalog_items
set is_aerial = true
where slug in (
  'aerial_photography',
  'social_media_special',
  'social_media_plus',
  'ultimate'
);

insert into public.catalog_items (
  organization_id,
  kind,
  slug,
  name,
  description,
  duration_minutes,
  price_cents,
  taxable,
  active,
  display_order,
  is_aerial,
  require_has_media,
  exclude_has_aerial,
  badge,
  highlight,
  ideal_for
)
values (
  '00000000-0000-0000-0000-000000000001',
  'addon',
  'aerial_add_on',
  'Aerial Add-on',
  'Add aerial stills to a photo, iGUIDE, or video booking when aerial coverage is not already included.',
  30,
  10000,
  true,
  true,
  20,
  true,
  true,
  true,
  'Popular add-on',
  true,
  'Listings that benefit from exterior, lot, or neighbourhood context.'
)
on conflict (organization_id, slug) do update
set
  kind = excluded.kind,
  name = excluded.name,
  description = excluded.description,
  duration_minutes = excluded.duration_minutes,
  price_cents = excluded.price_cents,
  taxable = excluded.taxable,
  active = excluded.active,
  display_order = excluded.display_order,
  is_photo = false,
  is_video = false,
  is_iguide = false,
  is_aerial = excluded.is_aerial,
  require_has_video = false,
  require_has_media = excluded.require_has_media,
  exclude_has_aerial = excluded.exclude_has_aerial,
  badge = excluded.badge,
  highlight = excluded.highlight,
  ideal_for = excluded.ideal_for,
  updated_at = now();

-- Keep the original atomic booking implementation intact and put the new
-- capability checks in a small wrapper. This also preserves the original
-- replay behavior for an already-committed request id.
alter function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) rename to create_public_booking_with_jobs_catalog_v1;

create function public.create_public_booking_with_jobs(
  p_request_id uuid,
  p_organization_id uuid,
  p_owner_id uuid,
  p_street_address text,
  p_city text,
  p_postal_code text,
  p_unit_number text,
  p_scheduled_at timestamptz,
  p_square_footage integer,
  p_is_vacant text,
  p_include_basement boolean,
  p_client_notes text,
  p_service_item_ids uuid[],
  p_add_on_item_ids uuid[],
  p_admin_notification_email text default null,
  p_app_url text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  has_video boolean := false;
  has_media boolean := false;
  has_aerial boolean := false;
begin
  if not exists (
    select 1
    from public.bookings booking
    where booking.organization_id = p_organization_id
      and booking.public_request_id = p_request_id
  ) then
    select
      coalesce(pg_catalog.bool_or(catalog.is_video), false),
      coalesce(
        pg_catalog.bool_or(
          catalog.is_photo or catalog.is_video or catalog.is_iguide
        ),
        false
      ),
      coalesce(pg_catalog.bool_or(catalog.is_aerial), false)
    into has_video, has_media, has_aerial
    from public.catalog_items catalog
    where catalog.id = any(coalesce(p_service_item_ids, '{}'::uuid[]))
      and catalog.organization_id = p_organization_id
      and catalog.active = true
      and catalog.kind in ('bundle', 'a_la_carte');

    if exists (
      select 1
      from public.catalog_items addon
      where addon.id = any(coalesce(p_add_on_item_ids, '{}'::uuid[]))
        and addon.organization_id = p_organization_id
        and addon.active = true
        and addon.kind = 'addon'
        and (
          (addon.require_has_video and not has_video)
          or (addon.require_has_media and not has_media)
          or (addon.exclude_has_aerial and has_aerial)
        )
    ) then
      raise exception 'Selected add-on is not eligible for these services'
        using errcode = 'PB002';
    end if;
  end if;

  return public.create_public_booking_with_jobs_catalog_v1(
    p_request_id,
    p_organization_id,
    p_owner_id,
    p_street_address,
    p_city,
    p_postal_code,
    p_unit_number,
    p_scheduled_at,
    p_square_footage,
    p_is_vacant,
    p_include_basement,
    p_client_notes,
    p_service_item_ids,
    p_add_on_item_ids,
    p_admin_notification_email,
    p_app_url
  );
end;
$$;

revoke all on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) to service_role;

revoke all on function public.create_public_booking_with_jobs_catalog_v1(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.create_public_booking_with_jobs_catalog_v1(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) to service_role;

comment on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) is
  'Validates tenant catalog and add-on capability rules before delegating to the atomic booking and integration-outbox transaction.';

-- ============================================================================
-- End supabase/migrations/20260810173824_aerial_addon_catalog_rules.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260811225000_canonical_media_releases.sql
-- ============================================================================

-- Canonical Release 1 media control plane.
-- Additive and code-dark: no application path writes these tables yet.

create unique index if not exists properties_organization_id_id_idx
  on public.properties (organization_id, id);
create unique index if not exists bookings_organization_id_id_property_id_idx
  on public.bookings (organization_id, id, property_id);
create unique index if not exists profiles_organization_id_id_idx
  on public.profiles (organization_id, id);
create unique index if not exists listing_websites_organization_id_id_property_id_idx
  on public.listing_websites (organization_id, id, property_id);

create table public.media_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  booking_id uuid not null,
  source_provider text not null,
  provider_connection_key text not null,
  provider_job_id text not null,
  provider_revision integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint media_batches_provider_check check (
    source_provider = pg_catalog.btrim(source_provider)
    and pg_catalog.char_length(source_provider) between 1 and 96
    and provider_connection_key = pg_catalog.btrim(provider_connection_key)
    and pg_catalog.char_length(provider_connection_key) between 1 and 255
    and provider_job_id = pg_catalog.btrim(provider_job_id)
    and pg_catalog.char_length(provider_job_id) between 1 and 255
    and provider_revision >= 0
  ),
  constraint media_batches_organization_id_id_key unique (organization_id, id),
  constraint media_batches_org_id_property_id_key
    unique (organization_id, id, property_id),
  constraint media_batches_org_id_property_id_booking_id_key
    unique (organization_id, id, property_id, booking_id),
  constraint media_batches_provider_identity_key
    unique (
      organization_id, source_provider, provider_connection_key,
      provider_job_id, provider_revision
    ),
  constraint media_batches_provider_anchor_key
    unique (
      organization_id, id, property_id, source_provider,
      provider_connection_key, provider_job_id, provider_revision
    ),
  constraint media_batches_property_fkey
    foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete restrict,
  constraint media_batches_booking_fkey
    foreign key (organization_id, booking_id, property_id)
    references public.bookings (organization_id, id, property_id) on delete restrict,
  constraint media_batches_created_by_fkey
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete restrict
);

create table public.media_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  source_provider text not null,
  provider_connection_key text not null,
  provider_job_id text not null,
  provider_output_id text not null,
  provider_revision integer not null default 0,
  media_kind text not null default 'image',
  original_filename text,
  capture_sequence integer,
  created_at timestamptz not null default now(),
  constraint media_assets_provider_check check (
    source_provider = pg_catalog.btrim(source_provider)
    and pg_catalog.char_length(source_provider) between 1 and 96
    and provider_connection_key = pg_catalog.btrim(provider_connection_key)
    and pg_catalog.char_length(provider_connection_key) between 1 and 255
    and provider_job_id = pg_catalog.btrim(provider_job_id)
    and pg_catalog.char_length(provider_job_id) between 1 and 255
    and provider_output_id = pg_catalog.btrim(provider_output_id)
    and pg_catalog.char_length(provider_output_id) between 1 and 255
    and provider_revision >= 0
  ),
  constraint media_assets_kind_check
    check (media_kind in ('image', 'video', 'floor_plan', 'document')),
  constraint media_assets_filename_check check (
    original_filename is null or (
      pg_catalog.char_length(original_filename) between 1 and 255
      and original_filename !~ '[\\/[:cntrl:]]'
    )
  ),
  constraint media_assets_sequence_check check (capture_sequence is null or capture_sequence >= 0),
  constraint media_assets_organization_id_id_key unique (organization_id, id),
  constraint media_assets_anchor_key unique (organization_id, id, property_id, batch_id),
  constraint media_assets_provider_output_key unique (
    organization_id, provider_connection_key, provider_job_id,
    provider_output_id, provider_revision
  ),
  constraint media_assets_batch_output_key
    unique (organization_id, batch_id, provider_output_id, provider_revision),
  constraint media_assets_batch_fkey foreign key (
    organization_id, batch_id, property_id, source_provider,
    provider_connection_key, provider_job_id, provider_revision
  ) references public.media_batches (
    organization_id, id, property_id, source_provider,
    provider_connection_key, provider_job_id, provider_revision
  ) on delete restrict
);

create table public.media_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  asset_id uuid not null,
  version_number integer not null,
  parent_version_id uuid,
  ingest_state text not null default 'discovered',
  object_tier text,
  bucket_name text,
  object_key text,
  sha256 bytea,
  byte_size bigint,
  mime_type text,
  width_px integer,
  height_px integer,
  edit_class text not null default 'original',
  disclosure_class text not null default 'none',
  rights_effective_at timestamptz,
  rights_expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint media_versions_number_check check (version_number >= 1),
  constraint media_versions_ingest_state_check check (ingest_state in (
    'discovered', 'url_ready', 'fetching', 'quarantined', 'validating', 'scanning',
    'accepted', 'deriving', 'review_pending', 'retryable', 'source_expired',
    'reconciliation_required', 'rejected', 'dead_letter'
  )),
  constraint media_versions_object_tier_check
    check (object_tier is null or object_tier in ('quarantine', 'master')),
  constraint media_versions_edit_class_check
    check (edit_class in ('original', 'corrective', 'hdr', 'virtual_staging', 'generative')),
  constraint media_versions_disclosure_class_check
    check (disclosure_class in ('none', 'virtually_staged', 'material_edit')),
  constraint media_versions_rights_check
    check (rights_expires_at is null or rights_effective_at is null or rights_expires_at > rights_effective_at),
  constraint media_versions_dimensions_check check (
    (byte_size is null or byte_size > 0)
    and (width_px is null or width_px > 0)
    and (height_px is null or height_px > 0)
  ),
  constraint media_versions_sha256_check
    check (sha256 is null or pg_catalog.octet_length(sha256) = 32),
  constraint media_versions_object_key_check check (
    object_key is null or (
      pg_catalog.char_length(object_key) between 1 and 1024
      and object_key !~ '(^|/)\.\.(/|$)'
      and object_key !~ '(^/|[\\[:cntrl:]])'
    )
  ),
  constraint media_versions_accepted_check check (
    (accepted_at is null and ingest_state not in ('accepted', 'deriving', 'review_pending'))
    or (
      accepted_at is not null
      and ingest_state in ('accepted', 'deriving', 'review_pending', 'reconciliation_required')
      and object_tier = 'master'
      and bucket_name is not null and pg_catalog.char_length(bucket_name) between 1 and 255
      and object_key is not null and sha256 is not null and byte_size is not null
      and mime_type is not null and pg_catalog.char_length(mime_type) between 1 and 255
      and width_px is not null and height_px is not null
    )
  ),
  constraint media_versions_organization_id_id_key unique (organization_id, id),
  constraint media_versions_asset_revision_key unique (organization_id, asset_id, version_number),
  constraint media_versions_anchor_key unique (organization_id, id, asset_id, property_id, batch_id),
  constraint media_versions_release_anchor_key unique (organization_id, id, property_id, batch_id),
  constraint media_versions_asset_fkey foreign key (
    organization_id, asset_id, property_id, batch_id
  ) references public.media_assets (
    organization_id, id, property_id, batch_id
  ) on delete restrict,
  constraint media_versions_parent_fkey foreign key (
    organization_id, parent_version_id, asset_id, property_id, batch_id
  ) references public.media_versions (
    organization_id, id, asset_id, property_id, batch_id
  ) on delete restrict
);

create unique index media_versions_accepted_sha256_idx
  on public.media_versions (organization_id, sha256)
  where accepted_at is not null;

create table public.media_derivatives (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  source_version_id uuid not null,
  profile_id text not null,
  profile_version integer not null,
  derivative_class text not null,
  profile_status text not null,
  status text not null default 'queued',
  bucket_name text,
  object_key text,
  sha256 bytea,
  byte_size bigint,
  mime_type text,
  width_px integer,
  height_px integer,
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_derivatives_profile_id_check check (profile_id in (
    'original.camera.v1', 'client.fullres.share.v1',
    'ontario.proptx.provisional.2026-08-11.v1',
    'web.listing.320.v1', 'web.listing.640.v1', 'web.listing.1280.v1',
    'web.listing.2048.v1', 'thumbnail.admin.320.v1'
  )),
  constraint media_derivatives_profile_version_check check (profile_version >= 1),
  constraint media_derivatives_class_check
    check (derivative_class in ('master', 'full_res', 'mls', 'web', 'thumbnail')),
  constraint media_derivatives_profile_status_check
    check (profile_status in ('defined', 'provisional')),
  constraint media_derivatives_status_check check (
    status in ('queued', 'processing', 'ready', 'retryable', 'rejected', 'dead_letter')
  ),
  constraint media_derivatives_sha256_check
    check (sha256 is null or pg_catalog.octet_length(sha256) = 32),
  constraint media_derivatives_dimensions_check check (
    (byte_size is null or byte_size > 0)
    and (width_px is null or width_px > 0)
    and (height_px is null or height_px > 0)
  ),
  constraint media_derivatives_object_key_check check (
    object_key is null or (
      pg_catalog.char_length(object_key) between 1 and 1024
      and object_key !~ '(^|/)\.\.(/|$)'
      and object_key !~ '(^/|[\\[:cntrl:]])'
    )
  ),
  constraint media_derivatives_ready_check check (
    (status <> 'ready' and ready_at is null)
    or (
      status = 'ready' and ready_at is not null
      and bucket_name is not null and object_key is not null
      and sha256 is not null and byte_size is not null and mime_type is not null
      and width_px is not null and height_px is not null
    )
  ),
  constraint media_derivatives_organization_id_id_key unique (organization_id, id),
  constraint media_derivatives_profile_key unique (
    organization_id, source_version_id, profile_id, profile_version
  ),
  constraint media_derivatives_anchor_key unique (
    organization_id, id, source_version_id, property_id, batch_id
  ),
  constraint media_derivatives_source_fkey foreign key (
    organization_id, source_version_id, property_id, batch_id
  ) references public.media_versions (
    organization_id, id, property_id, batch_id
  ) on delete restrict
);

create table public.provider_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  provider text not null,
  provider_connection_key text not null,
  provider_event_id text not null,
  event_type text not null,
  batch_id uuid,
  payload_sha256 bytea not null,
  payload_redacted jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  constraint provider_events_identity_check check (
    provider = pg_catalog.btrim(provider) and pg_catalog.char_length(provider) between 1 and 96
    and provider_connection_key = pg_catalog.btrim(provider_connection_key)
    and pg_catalog.char_length(provider_connection_key) between 1 and 255
    and provider_event_id = pg_catalog.btrim(provider_event_id)
    and pg_catalog.char_length(provider_event_id) between 1 and 255
    and event_type = pg_catalog.btrim(event_type)
    and pg_catalog.char_length(event_type) between 1 and 128
  ),
  constraint provider_events_payload_check check (
    pg_catalog.octet_length(payload_sha256) = 32
    and pg_catalog.jsonb_typeof(payload_redacted) = 'object'
    and pg_catalog.octet_length(payload_redacted::text) <= 65536
  ),
  constraint provider_events_organization_id_id_key unique (organization_id, id),
  constraint provider_events_external_key unique (
    organization_id, provider, provider_connection_key, provider_event_id
  ),
  constraint provider_events_batch_fkey foreign key (organization_id, batch_id)
    references public.media_batches (organization_id, id) on delete restrict
);

create table public.media_ingest_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  provider_event_id uuid,
  job_kind text not null,
  idempotency_key text not null,
  state text not null default 'discovered',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  last_error_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_ingest_jobs_kind_check check (job_kind in ('ingest', 'derive', 'package')),
  constraint media_ingest_jobs_state_check check (state in (
    'discovered', 'url_ready', 'fetching', 'quarantined', 'validating', 'scanning',
    'accepted', 'deriving', 'review_pending', 'retryable', 'source_expired',
    'reconciliation_required', 'rejected', 'dead_letter'
  )),
  constraint media_ingest_jobs_attempts_check
    check (max_attempts between 1 and 100 and attempts between 0 and max_attempts),
  constraint media_ingest_jobs_idempotency_check
    check (idempotency_key = pg_catalog.btrim(idempotency_key) and pg_catalog.char_length(idempotency_key) between 1 and 255),
  constraint media_ingest_jobs_error_check
    check (last_error_code is null or pg_catalog.char_length(last_error_code) between 1 and 96),
  constraint media_ingest_jobs_terminal_check check (
    state not in ('review_pending', 'rejected', 'dead_letter') or completed_at is not null
  ),
  constraint media_ingest_jobs_organization_id_id_key unique (organization_id, id),
  constraint media_ingest_jobs_idempotency_key unique (organization_id, idempotency_key),
  constraint media_ingest_jobs_anchor_key unique (organization_id, id, property_id, batch_id),
  constraint media_ingest_jobs_batch_fkey foreign key (organization_id, batch_id, property_id)
    references public.media_batches (organization_id, id, property_id) on delete restrict,
  constraint media_ingest_jobs_provider_event_fkey foreign key (organization_id, provider_event_id)
    references public.provider_events (organization_id, id) on delete restrict
);

create table public.media_job_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  job_id uuid not null,
  attempt_number integer not null,
  worker_id text not null,
  outcome text not null,
  error_code text,
  started_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint media_job_attempts_number_check check (attempt_number >= 1),
  constraint media_job_attempts_worker_check
    check (worker_id = pg_catalog.btrim(worker_id) and pg_catalog.char_length(worker_id) between 1 and 96),
  constraint media_job_attempts_outcome_check check (
    outcome in ('processing', 'succeeded', 'retryable', 'reconciliation_required', 'rejected', 'dead_letter')
  ),
  constraint media_job_attempts_finished_check check (
    (outcome = 'processing' and finished_at is null)
    or (outcome <> 'processing' and finished_at is not null and finished_at >= started_at)
  ),
  constraint media_job_attempts_error_check
    check (error_code is null or pg_catalog.char_length(error_code) between 1 and 96),
  constraint media_job_attempts_organization_id_id_key unique (organization_id, id),
  constraint media_job_attempts_number_key unique (organization_id, job_id, attempt_number),
  constraint media_job_attempts_job_fkey foreign key (organization_id, job_id, property_id, batch_id)
    references public.media_ingest_jobs (organization_id, id, property_id, batch_id) on delete restrict
);

create table public.gallery_releases (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  revision_number integer not null,
  supersedes_release_id uuid,
  state text not null default 'draft',
  manifest_version integer not null default 1,
  manifest jsonb,
  manifest_sha256 bytea,
  approved_by uuid,
  approved_at timestamptz,
  withdrawn_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gallery_releases_revision_check check (revision_number >= 1 and manifest_version >= 1),
  constraint gallery_releases_state_check check (state in (
    'draft', 'review_pending', 'changes_requested', 'revision_processing',
    'approved', 'packaging', 'ready', 'published', 'superseded', 'withdrawn'
  )),
  constraint gallery_releases_manifest_check check (
    manifest is null or (
      pg_catalog.jsonb_typeof(manifest) = 'object'
      and pg_catalog.octet_length(manifest::text) <= 1048576
    )
  ),
  constraint gallery_releases_hash_check
    check (manifest_sha256 is null or pg_catalog.octet_length(manifest_sha256) = 32),
  constraint gallery_releases_approval_check check (
    state not in ('approved', 'packaging', 'ready', 'published', 'superseded') or (
      manifest is not null and manifest_sha256 is not null
      and approved_by is not null and approved_at is not null
    )
  ),
  constraint gallery_releases_withdrawal_check check (
    (state = 'withdrawn' and withdrawn_at is not null)
    or (state <> 'withdrawn' and withdrawn_at is null)
  ),
  constraint gallery_releases_organization_id_id_key unique (organization_id, id),
  constraint gallery_releases_revision_key
    unique (organization_id, property_id, batch_id, revision_number),
  constraint gallery_releases_anchor_key unique (organization_id, id, property_id, batch_id),
  constraint gallery_releases_manifest_anchor_key
    unique (organization_id, id, property_id, batch_id, manifest_sha256),
  constraint gallery_releases_batch_fkey foreign key (organization_id, batch_id, property_id)
    references public.media_batches (organization_id, id, property_id) on delete restrict,
  constraint gallery_releases_supersedes_fkey foreign key (
    organization_id, supersedes_release_id, property_id, batch_id
  ) references public.gallery_releases (
    organization_id, id, property_id, batch_id
  ) on delete restrict,
  constraint gallery_releases_approved_by_fkey foreign key (organization_id, approved_by)
    references public.profiles (organization_id, id) on delete restrict,
  constraint gallery_releases_created_by_fkey foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete restrict
);

create table public.gallery_release_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  release_id uuid not null,
  media_version_id uuid not null,
  display_derivative_id uuid not null,
  download_derivative_id uuid,
  position integer not null,
  display_filename text not null,
  alt_text text,
  approval_state text not null default 'pending',
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint gallery_release_items_position_check check (position >= 0),
  constraint gallery_release_items_filename_check check (
    pg_catalog.char_length(display_filename) between 1 and 255
    and display_filename !~ '[\\/[:cntrl:]]'
  ),
  constraint gallery_release_items_alt_text_check
    check (alt_text is null or pg_catalog.char_length(alt_text) <= 500),
  constraint gallery_release_items_approval_state_check
    check (approval_state in ('pending', 'approved', 'rejected')),
  constraint gallery_release_items_approval_check check (
    (approval_state = 'approved' and approved_by is not null and approved_at is not null)
    or (approval_state <> 'approved' and approved_by is null and approved_at is null)
  ),
  constraint gallery_release_items_organization_id_id_key unique (organization_id, id),
  constraint gallery_release_items_position_key unique (organization_id, release_id, position),
  constraint gallery_release_items_version_key unique (organization_id, release_id, media_version_id),
  constraint gallery_release_items_anchor_key unique (
    organization_id, id, release_id, property_id, batch_id,
    media_version_id, display_derivative_id
  ),
  constraint gallery_release_items_release_fkey foreign key (
    organization_id, release_id, property_id, batch_id
  ) references public.gallery_releases (
    organization_id, id, property_id, batch_id
  ) on delete restrict,
  constraint gallery_release_items_version_fkey foreign key (
    organization_id, media_version_id, property_id, batch_id
  ) references public.media_versions (
    organization_id, id, property_id, batch_id
  ) on delete restrict,
  constraint gallery_release_items_display_derivative_fkey foreign key (
    organization_id, display_derivative_id, media_version_id, property_id, batch_id
  ) references public.media_derivatives (
    organization_id, id, source_version_id, property_id, batch_id
  ) on delete restrict,
  constraint gallery_release_items_download_derivative_fkey foreign key (
    organization_id, download_derivative_id, media_version_id, property_id, batch_id
  ) references public.media_derivatives (
    organization_id, id, source_version_id, property_id, batch_id
  ) on delete restrict,
  constraint gallery_release_items_approved_by_fkey foreign key (organization_id, approved_by)
    references public.profiles (organization_id, id) on delete restrict
);

create table public.media_packages (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  release_id uuid not null,
  package_type text not null,
  manifest_sha256 bytea not null,
  status text not null default 'queued',
  bucket_name text,
  object_key text,
  package_sha256 bytea,
  byte_size bigint,
  entry_count integer,
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_packages_type_check check (package_type in ('full_res_zip', 'mls_zip')),
  constraint media_packages_status_check check (
    status in ('queued', 'building', 'ready', 'retryable', 'reconciliation_required', 'failed', 'dead_letter')
  ),
  constraint media_packages_hash_check check (
    pg_catalog.octet_length(manifest_sha256) = 32
    and (package_sha256 is null or pg_catalog.octet_length(package_sha256) = 32)
  ),
  constraint media_packages_size_check check (
    (byte_size is null or byte_size > 0) and (entry_count is null or entry_count >= 0)
  ),
  constraint media_packages_object_key_check check (
    object_key is null or (
      pg_catalog.char_length(object_key) between 1 and 1024
      and object_key !~ '(^|/)\.\.(/|$)'
      and object_key !~ '(^/|[\\[:cntrl:]])'
    )
  ),
  constraint media_packages_ready_check check (
    (status <> 'ready' and ready_at is null)
    or (
      status = 'ready' and ready_at is not null
      and bucket_name is not null and object_key is not null
      and package_sha256 is not null and byte_size is not null and entry_count is not null
    )
  ),
  constraint media_packages_organization_id_id_key unique (organization_id, id),
  constraint media_packages_release_manifest_key
    unique (organization_id, release_id, package_type, manifest_sha256),
  constraint media_packages_anchor_key unique (
    organization_id, id, release_id, property_id, batch_id
  ),
  constraint media_packages_release_fkey foreign key (
    organization_id, release_id, property_id, batch_id, manifest_sha256
  ) references public.gallery_releases (
    organization_id, id, property_id, batch_id, manifest_sha256
  ) on delete restrict
);

create table public.download_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  release_id uuid not null,
  package_id uuid not null,
  grantee_profile_id uuid,
  grantee_email_hash bytea,
  token_key_id text not null,
  token_hash bytea not null,
  expires_at timestamptz not null,
  max_resolutions integer not null default 1,
  resolution_count integer not null default 0,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint download_grants_principal_check check (
    (grantee_profile_id is not null) <> (grantee_email_hash is not null)
  ),
  constraint download_grants_email_hash_check
    check (grantee_email_hash is null or pg_catalog.octet_length(grantee_email_hash) = 32),
  constraint download_grants_token_key_check
    check (token_key_id = pg_catalog.btrim(token_key_id) and pg_catalog.char_length(token_key_id) between 1 and 96),
  constraint download_grants_token_hash_check
    check (pg_catalog.octet_length(token_hash) = 32),
  constraint download_grants_expiry_check check (expires_at > created_at),
  constraint download_grants_count_check check (
    max_resolutions between 1 and 1000 and resolution_count between 0 and max_resolutions
  ),
  constraint download_grants_organization_id_id_key unique (organization_id, id),
  constraint download_grants_token_key unique (token_key_id, token_hash),
  constraint download_grants_anchor_key unique (
    organization_id, id, package_id, release_id, property_id, batch_id
  ),
  constraint download_grants_package_fkey foreign key (
    organization_id, package_id, release_id, property_id, batch_id
  ) references public.media_packages (
    organization_id, id, release_id, property_id, batch_id
  ) on delete restrict,
  constraint download_grants_grantee_fkey foreign key (organization_id, grantee_profile_id)
    references public.profiles (organization_id, id) on delete restrict,
  constraint download_grants_created_by_fkey foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete restrict
);

create table public.download_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  release_id uuid not null,
  package_id uuid not null,
  grant_id uuid not null,
  event_type text not null,
  actor_profile_id uuid,
  request_id uuid not null,
  ip_hash bytea,
  user_agent_hash bytea,
  occurred_at timestamptz not null default now(),
  constraint download_events_type_check check (
    event_type in ('grant_resolved', 'object_url_issued', 'controlled_proxy_completed', 'denied')
  ),
  constraint download_events_hash_check check (
    (ip_hash is null or pg_catalog.octet_length(ip_hash) = 32)
    and (user_agent_hash is null or pg_catalog.octet_length(user_agent_hash) = 32)
  ),
  constraint download_events_organization_id_id_key unique (organization_id, id),
  constraint download_events_request_key
    unique (organization_id, grant_id, request_id, event_type),
  constraint download_events_grant_fkey foreign key (
    organization_id, grant_id, package_id, release_id, property_id, batch_id
  ) references public.download_grants (
    organization_id, id, package_id, release_id, property_id, batch_id
  ) on delete restrict,
  constraint download_events_actor_fkey foreign key (organization_id, actor_profile_id)
    references public.profiles (organization_id, id) on delete restrict
);

create table public.listing_gallery_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  listing_website_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  release_id uuid not null,
  release_item_id uuid not null,
  media_version_id uuid not null,
  derivative_id uuid not null,
  position integer not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint listing_gallery_items_position_check check (position >= 0),
  constraint listing_gallery_items_organization_id_id_key unique (organization_id, id),
  constraint listing_gallery_items_listing_fkey foreign key (
    organization_id, listing_website_id, property_id
  ) references public.listing_websites (
    organization_id, id, property_id
  ) on delete restrict,
  constraint listing_gallery_items_release_item_fkey foreign key (
    organization_id, release_item_id, release_id, property_id, batch_id,
    media_version_id, derivative_id
  ) references public.gallery_release_items (
    organization_id, id, release_id, property_id, batch_id,
    media_version_id, display_derivative_id
  ) on delete restrict
);

create unique index listing_gallery_items_active_position_idx
  on public.listing_gallery_items (organization_id, listing_website_id, position)
  where removed_at is null;
create unique index listing_gallery_items_active_release_item_idx
  on public.listing_gallery_items (organization_id, listing_website_id, release_item_id)
  where removed_at is null;

create index media_batches_property_created_idx
  on public.media_batches (organization_id, property_id, created_at desc);
create index media_assets_batch_sequence_idx
  on public.media_assets (organization_id, batch_id, capture_sequence, id);
create index media_versions_asset_version_idx
  on public.media_versions (organization_id, asset_id, version_number desc);
create index media_derivatives_work_idx
  on public.media_derivatives (organization_id, status, created_at)
  where status in ('queued', 'retryable');
create index provider_events_received_idx
  on public.provider_events (organization_id, received_at desc);
create index media_ingest_jobs_due_idx
  on public.media_ingest_jobs (next_attempt_at, created_at)
  where state in ('discovered', 'url_ready', 'retryable', 'reconciliation_required');
create index media_job_attempts_job_idx
  on public.media_job_attempts (organization_id, job_id, attempt_number desc);
create index gallery_releases_property_created_idx
  on public.gallery_releases (organization_id, property_id, created_at desc);
create index media_packages_release_status_idx
  on public.media_packages (organization_id, release_id, status);
create index download_grants_expiry_idx
  on public.download_grants (expires_at) where revoked_at is null;
create index download_events_release_idx
  on public.download_events (organization_id, release_id, occurred_at desc);

create or replace function public.is_valid_media_ingest_transition(from_state text, to_state text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case from_state
    when 'discovered' then to_state in ('url_ready', 'rejected', 'dead_letter')
    when 'url_ready' then to_state in ('fetching', 'source_expired', 'rejected', 'dead_letter')
    when 'fetching' then to_state in ('quarantined', 'retryable', 'source_expired', 'reconciliation_required', 'rejected', 'dead_letter')
    when 'quarantined' then to_state in ('validating', 'rejected', 'dead_letter')
    when 'validating' then to_state in ('scanning', 'rejected', 'dead_letter')
    when 'scanning' then to_state in ('accepted', 'retryable', 'reconciliation_required', 'rejected', 'dead_letter')
    when 'accepted' then to_state in ('deriving', 'review_pending', 'reconciliation_required')
    when 'deriving' then to_state in ('review_pending', 'retryable', 'reconciliation_required', 'dead_letter')
    when 'retryable' then to_state in ('fetching', 'validating', 'scanning', 'deriving', 'reconciliation_required', 'dead_letter')
    when 'source_expired' then to_state in ('url_ready', 'rejected', 'dead_letter')
    when 'reconciliation_required' then to_state in ('fetching', 'quarantined', 'validating', 'scanning', 'deriving', 'review_pending', 'rejected', 'dead_letter')
    else false
  end
$$;

create or replace function public.is_valid_gallery_release_transition(from_state text, to_state text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case from_state
    when 'draft' then to_state in ('review_pending', 'withdrawn')
    when 'review_pending' then to_state in ('changes_requested', 'approved', 'withdrawn')
    when 'changes_requested' then to_state in ('revision_processing', 'withdrawn')
    when 'revision_processing' then to_state in ('review_pending', 'changes_requested', 'withdrawn')
    when 'approved' then to_state in ('packaging', 'withdrawn')
    when 'packaging' then to_state in ('ready', 'withdrawn')
    when 'ready' then to_state in ('published', 'superseded', 'withdrawn')
    when 'published' then to_state in ('superseded', 'withdrawn')
    else false
  end
$$;

create or replace function public.prevent_media_row_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Canonical media rows are retained; use an explicit terminal state'
    using errcode = '23514';
end;
$$;

create or replace function public.prevent_media_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Canonical media evidence is append-only'
    using errcode = '23514';
end;
$$;

create or replace function public.prevent_media_storage_identity_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'media_versions' then
    if (new.id, new.organization_id, new.property_id, new.batch_id, new.asset_id,
        new.version_number, new.parent_version_id, new.created_at)
       is distinct from
       (old.id, old.organization_id, old.property_id, old.batch_id, old.asset_id,
        old.version_number, old.parent_version_id, old.created_at) then
      raise exception 'Media version identity is immutable' using errcode = '23514';
    end if;
    if new.ingest_state is distinct from old.ingest_state
       and not public.is_valid_media_ingest_transition(old.ingest_state, new.ingest_state) then
      raise exception 'Invalid media ingest transition' using errcode = '23514';
    end if;
    if old.accepted_at is not null and (
      new.object_tier is distinct from old.object_tier
      or new.bucket_name is distinct from old.bucket_name
      or new.object_key is distinct from old.object_key
      or new.sha256 is distinct from old.sha256
      or new.byte_size is distinct from old.byte_size
      or new.mime_type is distinct from old.mime_type
      or new.width_px is distinct from old.width_px
      or new.height_px is distinct from old.height_px
      or new.edit_class is distinct from old.edit_class
      or new.disclosure_class is distinct from old.disclosure_class
      or new.rights_effective_at is distinct from old.rights_effective_at
      or new.rights_expires_at is distinct from old.rights_expires_at
      or new.accepted_at is distinct from old.accepted_at
    ) then
      raise exception 'Accepted media object identity is immutable' using errcode = '23514';
    end if;
  elsif tg_table_name = 'media_derivatives' then
    if (new.id, new.organization_id, new.property_id, new.batch_id, new.source_version_id,
        new.profile_id, new.profile_version, new.derivative_class, new.profile_status, new.created_at)
       is distinct from
       (old.id, old.organization_id, old.property_id, old.batch_id, old.source_version_id,
        old.profile_id, old.profile_version, old.derivative_class, old.profile_status, old.created_at) then
      raise exception 'Derivative identity is immutable' using errcode = '23514';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'queued' and new.status in ('processing', 'retryable', 'rejected', 'dead_letter'))
      or (old.status = 'processing' and new.status in ('ready', 'retryable', 'rejected', 'dead_letter'))
      or (old.status = 'retryable' and new.status in ('processing', 'rejected', 'dead_letter'))
    ) then
      raise exception 'Invalid derivative transition' using errcode = '23514';
    end if;
    if old.ready_at is not null and (
      new.bucket_name is distinct from old.bucket_name
      or new.object_key is distinct from old.object_key
      or new.sha256 is distinct from old.sha256
      or new.byte_size is distinct from old.byte_size
      or new.mime_type is distinct from old.mime_type
      or new.width_px is distinct from old.width_px
      or new.height_px is distinct from old.height_px
      or new.ready_at is distinct from old.ready_at
    ) then
      raise exception 'Ready derivative object identity is immutable' using errcode = '23514';
    end if;
    new.updated_at := now();
  elsif tg_table_name = 'media_packages' then
    if (new.id, new.organization_id, new.property_id, new.batch_id, new.release_id,
        new.package_type, new.manifest_sha256, new.created_at)
       is distinct from
       (old.id, old.organization_id, old.property_id, old.batch_id, old.release_id,
        old.package_type, old.manifest_sha256, old.created_at) then
      raise exception 'Package release identity is immutable' using errcode = '23514';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'queued' and new.status in ('building', 'failed', 'dead_letter'))
      or (old.status = 'building' and new.status in ('ready', 'retryable', 'reconciliation_required', 'failed', 'dead_letter'))
      or (old.status in ('retryable', 'reconciliation_required') and new.status in ('building', 'failed', 'dead_letter'))
    ) then
      raise exception 'Invalid package transition' using errcode = '23514';
    end if;
    if old.ready_at is not null and (
      new.bucket_name is distinct from old.bucket_name
      or new.object_key is distinct from old.object_key
      or new.package_sha256 is distinct from old.package_sha256
      or new.byte_size is distinct from old.byte_size
      or new.entry_count is distinct from old.entry_count
      or new.ready_at is distinct from old.ready_at
    ) then
      raise exception 'Ready package object identity is immutable' using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.enforce_media_initial_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare package_release_state text;
begin
  if tg_table_name = 'media_versions' and pg_catalog.to_jsonb(new)->>'ingest_state' is distinct from 'discovered' then
    raise exception 'Media versions must start discovered' using errcode = '23514';
  elsif tg_table_name = 'media_ingest_jobs' and pg_catalog.to_jsonb(new)->>'state' is distinct from 'discovered' then
    raise exception 'Media ingest jobs must start discovered' using errcode = '23514';
  elsif tg_table_name = 'media_derivatives' and pg_catalog.to_jsonb(new)->>'status' is distinct from 'queued' then
    raise exception 'Media derivatives must start queued' using errcode = '23514';
  elsif tg_table_name = 'media_packages' then
    if pg_catalog.to_jsonb(new)->>'status' is distinct from 'queued' then
      raise exception 'Media packages must start queued' using errcode = '23514';
    end if;
    select release.state into package_release_state
      from public.gallery_releases release
     where release.organization_id = (pg_catalog.to_jsonb(new)->>'organization_id')::uuid
       and release.id = (pg_catalog.to_jsonb(new)->>'release_id')::uuid
     for update;
    if package_release_state is null
       or package_release_state not in ('approved', 'packaging', 'ready', 'published') then
      raise exception 'Media packages require an approved release snapshot' using errcode = '23514';
    end if;
  elsif tg_table_name = 'gallery_releases' and pg_catalog.to_jsonb(new)->>'state' is distinct from 'draft' then
    raise exception 'Gallery releases must start draft' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_media_ingest_job_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.organization_id, new.property_id, new.batch_id, new.provider_event_id,
      new.job_kind, new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.property_id, old.batch_id, old.provider_event_id,
      old.job_kind, old.idempotency_key, old.created_at) then
    raise exception 'Media ingest job identity is immutable' using errcode = '23514';
  end if;
  if new.state is distinct from old.state
     and not public.is_valid_media_ingest_transition(old.state, new.state) then
    raise exception 'Invalid media ingest job transition' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prevent_approved_release_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.organization_id, new.property_id, new.batch_id, new.revision_number,
      new.supersedes_release_id, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.property_id, old.batch_id, old.revision_number,
      old.supersedes_release_id, old.created_by, old.created_at) then
    raise exception 'Release identity is immutable' using errcode = '23514';
  end if;
  if new.state is distinct from old.state
     and not public.is_valid_gallery_release_transition(old.state, new.state) then
    raise exception 'Invalid gallery release transition' using errcode = '23514';
  end if;
  if old.approved_at is not null and (
    new.manifest_version is distinct from old.manifest_version
    or new.manifest is distinct from old.manifest
    or new.manifest_sha256 is distinct from old.manifest_sha256
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
  ) then
    raise exception 'Approved release snapshot is immutable' using errcode = '23514';
  end if;
  if new.state = 'approved' and old.state is distinct from 'approved' then
    if not exists (
      select 1 from public.gallery_release_items item
       where item.organization_id = new.organization_id and item.release_id = new.id
    ) or exists (
      select 1 from public.gallery_release_items item
       where item.organization_id = new.organization_id and item.release_id = new.id
         and item.approval_state <> 'approved'
    ) then
      raise exception 'Every release item must be approved before release approval'
        using errcode = '23514';
    end if;
  end if;
  if new.state in ('superseded', 'withdrawn') and old.state is distinct from new.state
     and exists (
       select 1 from public.listing_gallery_items listing_item
        where listing_item.organization_id = new.organization_id
          and listing_item.release_id = new.id
          and listing_item.removed_at is null
     ) then
    raise exception 'Active listing items must be removed before release withdrawal or supersession'
      using errcode = '23514';
  end if;
  if new.state in ('superseded', 'withdrawn') and old.state is distinct from new.state
     and exists (
       select 1 from public.download_grants grant_row
        where grant_row.organization_id = new.organization_id
          and grant_row.release_id = new.id
          and grant_row.revoked_at is null
     ) then
    raise exception 'Active download grants must be revoked before release withdrawal or supersession'
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_release_item_mutability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare release_approved_at timestamptz;
declare target_organization_id uuid;
declare target_release_id uuid;
begin
  target_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  target_release_id := case when tg_op = 'DELETE' then old.release_id else new.release_id end;
  select release.approved_at into release_approved_at
    from public.gallery_releases release
   where release.organization_id = target_organization_id
     and release.id = target_release_id
   for update;
  if release_approved_at is not null then
    raise exception 'Approved release items are immutable' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.approval_state = 'approved' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.property_id is distinct from old.property_id
    or new.batch_id is distinct from old.batch_id
    or new.release_id is distinct from old.release_id
    or new.media_version_id is distinct from old.media_version_id
    or new.display_derivative_id is distinct from old.display_derivative_id
    or new.download_derivative_id is distinct from old.download_derivative_id
    or new.position is distinct from old.position
    or new.display_filename is distinct from old.display_filename
    or new.alt_text is distinct from old.alt_text
    or new.approval_state is distinct from old.approval_state
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Approved release item approval is bound to immutable content'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.enforce_download_grant_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.organization_id, new.property_id, new.batch_id, new.release_id, new.package_id,
      new.grantee_profile_id, new.grantee_email_hash, new.token_key_id, new.token_hash,
      new.expires_at, new.max_resolutions, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.property_id, old.batch_id, old.release_id, old.package_id,
      old.grantee_profile_id, old.grantee_email_hash, old.token_key_id, old.token_hash,
      old.expires_at, old.max_resolutions, old.created_by, old.created_at) then
    raise exception 'Download grant identity is immutable' using errcode = '23514';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'Download grant revocation is irreversible' using errcode = '23514';
  end if;
  if new.resolution_count < old.resolution_count then
    raise exception 'Download grant resolution count cannot decrease' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_download_grant_validity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare release_state text;
begin
  select release.state into release_state
    from public.gallery_releases release
   where release.organization_id = new.organization_id
     and release.id = new.release_id
   for update;
  if release_state is null
     or release_state not in ('ready', 'published')
     or not exists (
       select 1
         from public.media_packages package_row
        where package_row.organization_id = new.organization_id
          and package_row.id = new.package_id
          and package_row.release_id = new.release_id
          and package_row.status = 'ready'
     ) then
    raise exception 'Download grants require a ready package and ready release'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_listing_gallery_item_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
declare release_state text;
declare item_state text;
declare derivative_state text;
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.organization_id, new.listing_website_id, new.property_id, new.batch_id,
        new.release_id, new.release_item_id, new.media_version_id, new.derivative_id,
        new.position, new.created_at)
       is distinct from
       (old.id, old.organization_id, old.listing_website_id, old.property_id, old.batch_id,
        old.release_id, old.release_item_id, old.media_version_id, old.derivative_id,
        old.position, old.created_at) then
      raise exception 'Listing gallery identity is immutable' using errcode = '23514';
    end if;
    if old.removed_at is not null and new.removed_at is distinct from old.removed_at then
      raise exception 'Listing gallery removal is irreversible' using errcode = '23514';
    end if;
  end if;
  if new.removed_at is null then
    select release.state, item.approval_state, derivative.status
      into release_state, item_state, derivative_state
      from public.gallery_releases release
      join public.gallery_release_items item
        on item.organization_id = release.organization_id and item.release_id = release.id
      join public.media_derivatives derivative
        on derivative.organization_id = item.organization_id
       and derivative.id = item.display_derivative_id
     where release.organization_id = new.organization_id
       and release.id = new.release_id
       and item.id = new.release_item_id
       and derivative.id = new.derivative_id
     for update of release;
    if release_state not in ('approved', 'packaging', 'ready', 'published')
       or item_state <> 'approved' or derivative_state <> 'ready' then
      raise exception 'Listing gallery requires an approved release item and ready derivative'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger media_batches_append_only
before update on public.media_batches for each row execute function public.prevent_media_append_only_mutation();
create trigger media_assets_append_only
before update on public.media_assets for each row execute function public.prevent_media_append_only_mutation();
create trigger provider_events_append_only
before update on public.provider_events for each row execute function public.prevent_media_append_only_mutation();
create trigger media_job_attempts_append_only
before update on public.media_job_attempts for each row execute function public.prevent_media_append_only_mutation();
create trigger download_events_append_only
before update on public.download_events for each row execute function public.prevent_media_append_only_mutation();

create trigger media_versions_storage_identity
before update on public.media_versions for each row execute function public.prevent_media_storage_identity_mutation();
create trigger media_derivatives_storage_identity
before update on public.media_derivatives for each row execute function public.prevent_media_storage_identity_mutation();
create trigger media_packages_storage_identity
before update on public.media_packages for each row execute function public.prevent_media_storage_identity_mutation();
create trigger media_ingest_jobs_transition
before update on public.media_ingest_jobs for each row execute function public.enforce_media_ingest_job_transition();
create trigger gallery_releases_immutability
before update on public.gallery_releases for each row execute function public.prevent_approved_release_mutation();
create trigger gallery_release_items_mutability
before insert or update or delete on public.gallery_release_items
for each row execute function public.enforce_release_item_mutability();
create trigger download_grants_immutability
before update on public.download_grants for each row execute function public.enforce_download_grant_immutability();
create trigger download_grants_validity
before insert on public.download_grants for each row execute function public.enforce_download_grant_validity();
create trigger listing_gallery_items_approval
before insert or update on public.listing_gallery_items
for each row execute function public.enforce_listing_gallery_item_approval();

create trigger media_versions_initial_state before insert on public.media_versions
for each row execute function public.enforce_media_initial_state();
create trigger media_derivatives_initial_state before insert on public.media_derivatives
for each row execute function public.enforce_media_initial_state();
create trigger media_ingest_jobs_initial_state before insert on public.media_ingest_jobs
for each row execute function public.enforce_media_initial_state();
create trigger gallery_releases_initial_state before insert on public.gallery_releases
for each row execute function public.enforce_media_initial_state();
create trigger media_packages_initial_state before insert on public.media_packages
for each row execute function public.enforce_media_initial_state();

create trigger media_batches_no_delete before delete on public.media_batches
for each row execute function public.prevent_media_row_delete();
create trigger media_assets_no_delete before delete on public.media_assets
for each row execute function public.prevent_media_row_delete();
create trigger media_versions_no_delete before delete on public.media_versions
for each row execute function public.prevent_media_row_delete();
create trigger media_derivatives_no_delete before delete on public.media_derivatives
for each row execute function public.prevent_media_row_delete();
create trigger provider_events_no_delete before delete on public.provider_events
for each row execute function public.prevent_media_row_delete();
create trigger media_ingest_jobs_no_delete before delete on public.media_ingest_jobs
for each row execute function public.prevent_media_row_delete();
create trigger media_job_attempts_no_delete before delete on public.media_job_attempts
for each row execute function public.prevent_media_row_delete();
create trigger gallery_releases_no_delete before delete on public.gallery_releases
for each row execute function public.prevent_media_row_delete();
create trigger media_packages_no_delete before delete on public.media_packages
for each row execute function public.prevent_media_row_delete();
create trigger download_grants_no_delete before delete on public.download_grants
for each row execute function public.prevent_media_row_delete();
create trigger download_events_no_delete before delete on public.download_events
for each row execute function public.prevent_media_row_delete();
create trigger listing_gallery_items_no_delete before delete on public.listing_gallery_items
for each row execute function public.prevent_media_row_delete();

alter table public.media_batches enable row level security;
alter table public.media_batches force row level security;
alter table public.media_assets enable row level security;
alter table public.media_assets force row level security;
alter table public.media_versions enable row level security;
alter table public.media_versions force row level security;
alter table public.media_derivatives enable row level security;
alter table public.media_derivatives force row level security;
alter table public.provider_events enable row level security;
alter table public.provider_events force row level security;
alter table public.media_ingest_jobs enable row level security;
alter table public.media_ingest_jobs force row level security;
alter table public.media_job_attempts enable row level security;
alter table public.media_job_attempts force row level security;
alter table public.gallery_releases enable row level security;
alter table public.gallery_releases force row level security;
alter table public.gallery_release_items enable row level security;
alter table public.gallery_release_items force row level security;
alter table public.media_packages enable row level security;
alter table public.media_packages force row level security;
alter table public.download_grants enable row level security;
alter table public.download_grants force row level security;
alter table public.download_events enable row level security;
alter table public.download_events force row level security;
alter table public.listing_gallery_items enable row level security;
alter table public.listing_gallery_items force row level security;

revoke all on table
  public.media_batches, public.media_assets, public.media_versions,
  public.media_derivatives, public.provider_events, public.media_ingest_jobs,
  public.media_job_attempts, public.gallery_releases, public.gallery_release_items,
  public.media_packages, public.download_grants, public.download_events,
  public.listing_gallery_items
from public, anon, authenticated;

grant select, insert, update on table
  public.media_versions, public.media_derivatives, public.media_ingest_jobs,
  public.gallery_releases, public.gallery_release_items, public.media_packages,
  public.download_grants, public.listing_gallery_items
  to service_role;
grant select, insert on table
  public.media_batches, public.media_assets, public.provider_events,
  public.media_job_attempts, public.download_events
  to service_role;

revoke all on function public.is_valid_media_ingest_transition(text, text) from public, anon, authenticated;
revoke all on function public.is_valid_gallery_release_transition(text, text) from public, anon, authenticated;
revoke all on function public.prevent_media_row_delete() from public, anon, authenticated;
revoke all on function public.prevent_media_append_only_mutation() from public, anon, authenticated;
revoke all on function public.prevent_media_storage_identity_mutation() from public, anon, authenticated;
revoke all on function public.enforce_media_initial_state() from public, anon, authenticated;
revoke all on function public.enforce_media_ingest_job_transition() from public, anon, authenticated;
revoke all on function public.prevent_approved_release_mutation() from public, anon, authenticated;
revoke all on function public.enforce_release_item_mutability() from public, anon, authenticated;
revoke all on function public.enforce_download_grant_immutability() from public, anon, authenticated;
revoke all on function public.enforce_download_grant_validity() from public, anon, authenticated;
revoke all on function public.enforce_listing_gallery_item_approval() from public, anon, authenticated;

grant execute on function public.is_valid_media_ingest_transition(text, text) to service_role;
grant execute on function public.is_valid_gallery_release_transition(text, text) to service_role;
grant execute on function public.prevent_media_row_delete() to service_role;
grant execute on function public.prevent_media_append_only_mutation() to service_role;
grant execute on function public.prevent_media_storage_identity_mutation() to service_role;
grant execute on function public.enforce_media_initial_state() to service_role;
grant execute on function public.enforce_media_ingest_job_transition() to service_role;
grant execute on function public.prevent_approved_release_mutation() to service_role;
grant execute on function public.enforce_release_item_mutability() to service_role;
grant execute on function public.enforce_download_grant_immutability() to service_role;
grant execute on function public.enforce_download_grant_validity() to service_role;
grant execute on function public.enforce_listing_gallery_item_approval() to service_role;

-- ============================================================================
-- End supabase/migrations/20260811225000_canonical_media_releases.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260812180000_atomic_integration_credential_merge.sql
-- ============================================================================

-- Atomically merge tenant-scoped integration credential fields.
-- The service-role-only boundary prevents read/merge/write races from dropping
-- unrelated secrets when an enablement toggle and credential rotation overlap.

create or replace function public.merge_integration_credentials(
  p_organization_id uuid,
  p_provider text,
  p_fields jsonb,
  p_updated_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed_fields text[];
  v_credentials jsonb;
begin
  v_allowed_fields := case p_provider
    when 'admin_settings' then array['today_command_preferences']::text[]
    when 'autohdr' then array['api_key', 'enabled']::text[]
    when 'autoenhance' then array['api_key', 'webhook_secret', 'enabled']::text[]
    when 'fotello' then array['api_key']::text[]
    when 'google_maps' then array['api_key']::text[]
    when 'iguide' then array['app_id', 'app_token', 'webhook_secret']::text[]
    when 'openai' then array['api_key', 'model']::text[]
    when 'resend' then array['api_key']::text[]
    else null
  end;

  if p_organization_id is null
     or v_allowed_fields is null
     or p_fields is null
     or jsonb_typeof(p_fields) is distinct from 'object'
     or p_fields = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'invalid credential merge input';
  end if;

  if exists (
    select 1
    from jsonb_each(p_fields) as field(key, value)
    where not (field.key = any(v_allowed_fields))
       or jsonb_typeof(field.value) is distinct from 'string'
       or btrim(field.value #>> '{}') = ''
       or (
         field.key = 'enabled'
         and lower(btrim(field.value #>> '{}')) not in ('true', 'false')
       )
  ) then
    raise exception using errcode = '22023', message = 'invalid credential merge field';
  end if;

  insert into public.integration_credentials (
    organization_id,
    provider,
    credentials,
    updated_by
  ) values (
    p_organization_id,
    p_provider,
    p_fields,
    p_updated_by
  )
  on conflict (organization_id, provider) do update
    set credentials = public.integration_credentials.credentials || excluded.credentials,
        updated_by = excluded.updated_by
  returning credentials into v_credentials;

  return v_credentials;
end;
$$;

revoke all on function public.merge_integration_credentials(uuid, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.merge_integration_credentials(uuid, text, jsonb, uuid)
  to service_role;

create or replace function public.clear_integration_credentials(
  p_organization_id uuid,
  p_provider text,
  p_fields text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed_fields text[];
  v_credentials jsonb;
begin
  v_allowed_fields := case p_provider
    when 'admin_settings' then array['today_command_preferences']::text[]
    when 'autohdr' then array['api_key', 'enabled']::text[]
    when 'autoenhance' then array['api_key', 'webhook_secret', 'enabled']::text[]
    when 'fotello' then array['api_key']::text[]
    when 'google_maps' then array['api_key']::text[]
    when 'iguide' then array['app_id', 'app_token', 'webhook_secret']::text[]
    when 'openai' then array['api_key', 'model']::text[]
    when 'resend' then array['api_key']::text[]
    else null
  end;

  if p_organization_id is null
     or v_allowed_fields is null
     or p_fields is null
     or cardinality(p_fields) = 0
     or exists (
       select 1 from unnest(p_fields) as field
       where field is null or not (field = any(v_allowed_fields))
     ) then
    raise exception using errcode = '22023', message = 'invalid credential clear input';
  end if;

  update public.integration_credentials
  set credentials = credentials - p_fields
  where organization_id = p_organization_id
    and provider = p_provider
  returning credentials into v_credentials;

  if v_credentials = '{}'::jsonb then
    delete from public.integration_credentials
    where organization_id = p_organization_id
      and provider = p_provider;
    return null;
  end if;
  return v_credentials;
end;
$$;

revoke all on function public.clear_integration_credentials(uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.clear_integration_credentials(uuid, text, text[])
  to service_role;

-- ============================================================================
-- End supabase/migrations/20260812180000_atomic_integration_credential_merge.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260816120000_catalog_item_examples.sql
-- ============================================================================

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create unique index if not exists catalog_items_id_organization_unique
  on public.catalog_items (id, organization_id);

create table public.catalog_item_examples (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  catalog_item_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text,
  kind text not null check (kind in ('video', 'interactive', 'link')),
  source_type text not null check (source_type in ('external_url', 'cloudflare_stream')),
  external_url text,
  stream_uid text,
  status text not null default 'ready' check (status in ('uploading', 'ready', 'failed', 'deleting')),
  active boolean not null default true,
  display_order integer not null default 0 check (display_order between 0 and 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_item_examples_catalog_tenant_fk
    foreign key (catalog_item_id, organization_id)
    references public.catalog_items(id, organization_id)
    on delete restrict,
  constraint catalog_item_examples_description_length
    check (description is null or char_length(description) <= 500),
  constraint catalog_item_examples_position_unique
    unique (organization_id, catalog_item_id, display_order),
  constraint catalog_item_examples_source_shape
    check (
      (source_type = 'external_url'
        and external_url like 'https://%'
        and char_length(external_url) <= 2048
        and stream_uid is null
        and status = 'ready')
      or
      (source_type = 'cloudflare_stream'
        and external_url is null
        and stream_uid ~ '^[0-9a-f]{32}$')
    )
);

create index catalog_item_examples_public_lookup_idx
  on public.catalog_item_examples (organization_id, catalog_item_id, active, status, display_order);

create unique index catalog_item_examples_stream_uid_unique
  on public.catalog_item_examples (stream_uid)
  where stream_uid is not null;
create unique index catalog_item_examples_id_organization_unique
  on public.catalog_item_examples (id, organization_id);

create table public.catalog_stream_upload_claims (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  catalog_item_id uuid,
  example_id uuid,
  stream_uid text unique check (stream_uid is null or stream_uid ~ '^[0-9a-f]{32}$'),
  state text not null default 'claimed'
    check (state in ('claimed', 'provider_unknown', 'provisioned', 'attached', 'completed', 'cleanup_required', 'cleaned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_stream_upload_claims_catalog_tenant_fk
    foreign key (catalog_item_id, organization_id)
    references public.catalog_items(id, organization_id)
    on delete set null (catalog_item_id),
  constraint catalog_stream_upload_claims_example_tenant_fk
    foreign key (example_id, organization_id)
    references public.catalog_item_examples(id, organization_id)
    on delete set null (example_id)
);

create index catalog_stream_upload_claims_rate_idx
  on public.catalog_stream_upload_claims (organization_id, created_at desc);
create index catalog_stream_upload_claims_cleanup_idx
  on public.catalog_stream_upload_claims (state, created_at)
  where state in ('provider_unknown', 'cleanup_required');

alter table public.catalog_stream_upload_claims enable row level security;
alter table public.catalog_stream_upload_claims force row level security;
revoke all on table public.catalog_stream_upload_claims from public, anon, authenticated;
grant select, insert, update on table public.catalog_stream_upload_claims to service_role;

create or replace function public.claim_catalog_stream_upload(
  p_claim_id uuid,
  p_organization_id uuid,
  p_catalog_item_id uuid
) returns text
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));

  if exists (select 1 from public.catalog_stream_upload_claims where id = p_claim_id) then
    return 'duplicate';
  end if;
  if not exists (
    select 1 from public.catalog_items
    where id = p_catalog_item_id and organization_id = p_organization_id
  ) then
    return 'catalog_not_found';
  end if;
  if (
    select count(*) from public.catalog_stream_upload_claims
    where organization_id = p_organization_id
      and created_at >= now() - interval '1 hour'
  ) >= 10 then
    return 'rate_limited';
  end if;
  if (
    select count(*) from public.catalog_stream_upload_claims
    where organization_id = p_organization_id
      and state in ('claimed', 'provider_unknown', 'provisioned', 'attached')
  ) >= 2 then
    return 'too_many_pending';
  end if;
  if (
    select count(*) from public.catalog_item_examples
    where organization_id = p_organization_id
      and catalog_item_id = p_catalog_item_id
  ) >= 8 then
    return 'max_examples';
  end if;

  insert into public.catalog_stream_upload_claims (
    id, organization_id, catalog_item_id
  ) values (
    p_claim_id, p_organization_id, p_catalog_item_id
  );
  return 'claimed';
end;
$$;

revoke all on function public.claim_catalog_stream_upload(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_catalog_stream_upload(uuid, uuid, uuid)
  to service_role;

create or replace function public.attach_catalog_stream_upload(
  p_claim_id uuid,
  p_organization_id uuid,
  p_catalog_item_id uuid,
  p_stream_uid text,
  p_title text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_example_id uuid;
  v_display_order integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-stream-attach:' || p_catalog_item_id::text, 0)
  );

  perform 1
  from public.catalog_stream_upload_claims
  where id = p_claim_id
    and organization_id = p_organization_id
    and catalog_item_id = p_catalog_item_id
    and stream_uid = p_stream_uid
    and state = 'provisioned'
  for update;

  if not found then
    return null;
  end if;

  select candidate
  into v_display_order
  from generate_series(0, 7) as candidate
  where not exists (
    select 1
    from public.catalog_item_examples
    where organization_id = p_organization_id
      and catalog_item_id = p_catalog_item_id
      and display_order = candidate
  )
  order by candidate
  limit 1;

  if v_display_order is null then
    return null;
  end if;

  insert into public.catalog_item_examples (
    organization_id, catalog_item_id, title, description, kind, source_type,
    stream_uid, status, active, display_order
  ) values (
    p_organization_id, p_catalog_item_id, p_title, nullif(p_description, ''),
    'video', 'cloudflare_stream', p_stream_uid, 'uploading', true, v_display_order
  )
  returning id into v_example_id;

  update public.catalog_stream_upload_claims
  set example_id = v_example_id,
      state = 'attached',
      updated_at = now()
  where id = p_claim_id
    and organization_id = p_organization_id
    and catalog_item_id = p_catalog_item_id
    and stream_uid = p_stream_uid
    and state = 'provisioned';

  if not found then
    raise exception 'catalog stream upload claim changed during attachment';
  end if;

  return v_example_id;
end;
$$;

revoke all on function public.attach_catalog_stream_upload(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_catalog_stream_upload(uuid, uuid, uuid, text, text, text)
  to service_role;

create or replace function public.finalize_catalog_stream_upload(
  p_example_id uuid,
  p_organization_id uuid,
  p_stream_uid text,
  p_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_outcome not in ('ready', 'failed') then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('catalog-stream-example:' || p_example_id::text, 0)
  );

  if exists (
    select 1
    from public.catalog_stream_upload_claims c
    join public.catalog_item_examples e
      on e.id = c.example_id and e.organization_id = c.organization_id
    where c.organization_id = p_organization_id
      and c.example_id = p_example_id
      and c.stream_uid = p_stream_uid
      and c.state = 'completed'
      and e.status = p_outcome
  ) then
    return true;
  end if;

  perform 1
  from public.catalog_stream_upload_claims
  where organization_id = p_organization_id
    and example_id = p_example_id
    and stream_uid = p_stream_uid
    and state = 'attached'
  for update;
  if not found then return false; end if;

  perform 1
  from public.catalog_item_examples
  where organization_id = p_organization_id
    and id = p_example_id
    and stream_uid = p_stream_uid
    and status = 'uploading'
    and active = true
  for update;
  if not found then return false; end if;

  update public.catalog_stream_upload_claims
  set state = 'completed', updated_at = now()
  where organization_id = p_organization_id
    and example_id = p_example_id
    and stream_uid = p_stream_uid
    and state = 'attached';
  if not found then raise exception 'catalog Stream claim finalization race'; end if;

  update public.catalog_item_examples
  set status = p_outcome,
      active = (p_outcome = 'ready')
  where organization_id = p_organization_id
    and id = p_example_id
    and stream_uid = p_stream_uid
    and status = 'uploading'
    and active = true;
  if not found then raise exception 'catalog Stream example finalization race'; end if;

  return true;
end;
$$;

revoke all on function public.finalize_catalog_stream_upload(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_catalog_stream_upload(uuid, uuid, text, text)
  to service_role;

create or replace function public.begin_catalog_stream_example_deletion(
  p_example_id uuid,
  p_organization_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stream_uid text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-stream-example:' || p_example_id::text, 0)
  );

  select stream_uid
  into v_stream_uid
  from public.catalog_item_examples
  where organization_id = p_organization_id
    and id = p_example_id
    and source_type = 'cloudflare_stream'
    and stream_uid is not null
    and status in ('uploading', 'ready', 'failed', 'deleting')
  for update;
  if not found then return null; end if;

  perform 1
  from public.catalog_stream_upload_claims
  where organization_id = p_organization_id
    and example_id = p_example_id
    and stream_uid = v_stream_uid
    and state in ('attached', 'completed', 'cleanup_required')
  for update;
  if not found then return null; end if;

  update public.catalog_item_examples
  set active = false, status = 'deleting'
  where organization_id = p_organization_id
    and id = p_example_id
    and stream_uid = v_stream_uid;

  update public.catalog_stream_upload_claims
  set state = 'cleanup_required', updated_at = now()
  where organization_id = p_organization_id
    and example_id = p_example_id
    and stream_uid = v_stream_uid
    and state in ('attached', 'completed', 'cleanup_required');
  if not found then raise exception 'catalog Stream deletion transition race'; end if;

  return v_stream_uid;
end;
$$;

revoke all on function public.begin_catalog_stream_example_deletion(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_catalog_stream_example_deletion(uuid, uuid)
  to service_role;

alter table public.catalog_item_examples enable row level security;
alter table public.catalog_item_examples force row level security;

revoke all on table public.catalog_item_examples from public, anon, authenticated;
grant select, insert, update, delete on table public.catalog_item_examples to service_role;

comment on table public.catalog_item_examples is
  'Tenant-scoped examples attached to bookable catalog items. Public booking reads use server-side service access; clients never mutate this table directly.';
comment on table public.catalog_stream_upload_claims is
  'Durable, tenant-scoped Stream provisioning ledger used for quotas, idempotency, and orphan cleanup.';

-- ============================================================================
-- End supabase/migrations/20260816120000_catalog_item_examples.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260817130000_site_plan_addon.sql
-- ============================================================================

alter table public.catalog_items
  add column if not exists require_has_iguide boolean not null default false;

comment on column public.catalog_items.require_has_iguide is
  'For add-ons, require a selected non-add-on that includes iGUIDE coverage.';

alter table public.catalog_items
  drop constraint if exists catalog_item_addon_rules_only;

alter table public.catalog_items
  add constraint catalog_item_addon_rules_only
  check (
    kind = 'addon'
    or (
      require_has_video = false
      and require_has_media = false
      and require_has_iguide = false
      and exclude_has_aerial = false
    )
  );

insert into public.catalog_items (
  organization_id,
  kind,
  slug,
  name,
  description,
  duration_minutes,
  price_cents,
  taxable,
  active,
  display_order,
  is_photo,
  is_video,
  is_iguide,
  is_aerial,
  require_has_video,
  require_has_media,
  require_has_iguide,
  exclude_has_aerial,
  badge,
  highlight,
  ideal_for
)
values (
  '00000000-0000-0000-0000-000000000001',
  'addon',
  'site_plan',
  'Site Plan',
  'Add a clear property site plan to an iGUIDE booking.',
  20,
  10000,
  true,
  true,
  30,
  false,
  false,
  false,
  false,
  false,
  false,
  true,
  false,
  'iGUIDE add-on',
  false,
  'Listings where buyers benefit from seeing the property layout, structures, and outdoor context.'
)
on conflict (organization_id, slug) do update
set
  kind = excluded.kind,
  name = excluded.name,
  description = excluded.description,
  duration_minutes = excluded.duration_minutes,
  price_cents = excluded.price_cents,
  taxable = excluded.taxable,
  active = excluded.active,
  display_order = excluded.display_order,
  is_photo = excluded.is_photo,
  is_video = excluded.is_video,
  is_iguide = excluded.is_iguide,
  is_aerial = excluded.is_aerial,
  require_has_video = excluded.require_has_video,
  require_has_media = excluded.require_has_media,
  require_has_iguide = excluded.require_has_iguide,
  exclude_has_aerial = excluded.exclude_has_aerial,
  badge = excluded.badge,
  highlight = excluded.highlight,
  ideal_for = excluded.ideal_for,
  updated_at = now();

create or replace function public.create_public_booking_with_jobs(
  p_request_id uuid,
  p_organization_id uuid,
  p_owner_id uuid,
  p_street_address text,
  p_city text,
  p_postal_code text,
  p_unit_number text,
  p_scheduled_at timestamptz,
  p_square_footage integer,
  p_is_vacant text,
  p_include_basement boolean,
  p_client_notes text,
  p_service_item_ids uuid[],
  p_add_on_item_ids uuid[],
  p_admin_notification_email text default null,
  p_app_url text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  has_video boolean := false;
  has_media boolean := false;
  has_iguide boolean := false;
  has_aerial boolean := false;
begin
  if not exists (
    select 1
    from public.bookings booking
    where booking.organization_id = p_organization_id
      and booking.public_request_id = p_request_id
  ) then
    select
      coalesce(pg_catalog.bool_or(catalog.is_video), false),
      coalesce(
        pg_catalog.bool_or(
          catalog.is_photo or catalog.is_video or catalog.is_iguide
        ),
        false
      ),
      coalesce(pg_catalog.bool_or(catalog.is_iguide), false),
      coalesce(pg_catalog.bool_or(catalog.is_aerial), false)
    into has_video, has_media, has_iguide, has_aerial
    from public.catalog_items catalog
    where catalog.id = any(coalesce(p_service_item_ids, '{}'::uuid[]))
      and catalog.organization_id = p_organization_id
      and catalog.active = true
      and catalog.kind in ('bundle', 'a_la_carte');

    if exists (
      select 1
      from public.catalog_items addon
      where addon.id = any(coalesce(p_add_on_item_ids, '{}'::uuid[]))
        and addon.organization_id = p_organization_id
        and addon.active = true
        and addon.kind = 'addon'
        and (
          (addon.require_has_video and not has_video)
          or (addon.require_has_media and not has_media)
          or (addon.require_has_iguide and not has_iguide)
          or (addon.exclude_has_aerial and has_aerial)
        )
    ) then
      raise exception 'Selected add-on is not eligible for these services'
        using errcode = 'PB002';
    end if;
  end if;

  return public.create_public_booking_with_jobs_catalog_v1(
    p_request_id,
    p_organization_id,
    p_owner_id,
    p_street_address,
    p_city,
    p_postal_code,
    p_unit_number,
    p_scheduled_at,
    p_square_footage,
    p_is_vacant,
    p_include_basement,
    p_client_notes,
    p_service_item_ids,
    p_add_on_item_ids,
    p_admin_notification_email,
    p_app_url
  );
end;
$$;

revoke all on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) to service_role;

comment on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) is
  'Validates tenant catalog and add-on capability rules, including iGUIDE-only add-ons, before delegating to the atomic booking and integration-outbox transaction.';

-- ============================================================================
-- End supabase/migrations/20260817130000_site_plan_addon.sql
-- ============================================================================

-- ============================================================================
-- Begin supabase/migrations/20260817143000_shared_catalog_video_placements.sql
-- ============================================================================

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.catalog_item_example_placements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  catalog_item_id uuid not null,
  source_example_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  display_order integer not null check (display_order between 0 and 7),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_item_example_placements_catalog_tenant_fk
    foreign key (catalog_item_id, organization_id)
    references public.catalog_items(id, organization_id)
    on delete restrict,
  constraint catalog_item_example_placements_source_tenant_fk
    foreign key (source_example_id, organization_id)
    references public.catalog_item_examples(id, organization_id)
    on delete restrict,
  constraint catalog_item_example_placements_source_unique
    unique (organization_id, catalog_item_id, source_example_id),
  constraint catalog_item_example_placements_position_unique
    unique (organization_id, catalog_item_id, display_order)
);

create index catalog_item_example_placements_source_idx
  on public.catalog_item_example_placements (organization_id, source_example_id)
  where active = true;

alter table public.catalog_item_example_placements enable row level security;
alter table public.catalog_item_example_placements force row level security;
revoke all on table public.catalog_item_example_placements from public, anon, authenticated;
grant select, insert, update, delete on table public.catalog_item_example_placements to service_role;

create or replace function public.next_catalog_example_display_order(
  p_organization_id uuid,
  p_catalog_item_id uuid
)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select candidate
  from generate_series(0, 7) as candidate
  where not exists (
    select 1
    from public.catalog_item_examples e
    where e.organization_id = p_organization_id
      and e.catalog_item_id = p_catalog_item_id
      and e.display_order = candidate
  )
  and not exists (
    select 1
    from public.catalog_item_example_placements p
    where p.organization_id = p_organization_id
      and p.catalog_item_id = p_catalog_item_id
      and p.display_order = candidate
  )
  order by candidate
  limit 1
$$;
revoke all on function public.next_catalog_example_display_order(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.next_catalog_example_display_order(uuid, uuid)
  to service_role;

create or replace function public.guard_catalog_example_placement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_catalog_item_id uuid;
  v_total integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || new.organization_id::text || ':' || new.catalog_item_id::text, 0)
  );

  select e.catalog_item_id
  into v_source_catalog_item_id
  from public.catalog_item_examples e
  where e.id = new.source_example_id
    and e.organization_id = new.organization_id
    and e.source_type = 'cloudflare_stream'
    and e.kind = 'video'
    and e.stream_uid is not null
    and e.status = 'ready'
    and e.active = true
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'shared catalog video source is unavailable';
  end if;
  if new.catalog_item_id = v_source_catalog_item_id then
    raise exception using errcode = 'P0001', message = 'source catalog item already owns this video';
  end if;

  if exists (
    select 1 from public.catalog_item_examples e
    where e.organization_id = new.organization_id
      and e.catalog_item_id = new.catalog_item_id
      and e.display_order = new.display_order
  ) then
    raise exception using errcode = 'P0001', message = 'catalog example display position is occupied';
  end if;

  select
    (select count(*) from public.catalog_item_examples e
      where e.organization_id = new.organization_id and e.catalog_item_id = new.catalog_item_id)
    +
    (select count(*) from public.catalog_item_example_placements p
      where p.organization_id = new.organization_id
        and p.catalog_item_id = new.catalog_item_id
        and (tg_op = 'INSERT' or p.id <> new.id))
  into v_total;
  if v_total >= 8 then
    raise exception using errcode = 'P0001', message = 'catalog item already has eight examples';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_catalog_example_placement
before insert or update on public.catalog_item_example_placements
for each row execute function public.guard_catalog_example_placement();

create or replace function public.guard_catalog_example_base_slot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
begin
  if tg_op = 'UPDATE'
     and new.organization_id = old.organization_id
     and new.catalog_item_id = old.catalog_item_id
     and new.display_order = old.display_order then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || new.organization_id::text || ':' || new.catalog_item_id::text, 0)
  );
  if exists (
    select 1 from public.catalog_item_example_placements p
    where p.organization_id = new.organization_id
      and p.catalog_item_id = new.catalog_item_id
      and p.display_order = new.display_order
  ) then
    raise exception using errcode = 'P0001', message = 'catalog example display position is occupied';
  end if;

  select
    (select count(*) from public.catalog_item_examples e
      where e.organization_id = new.organization_id
        and e.catalog_item_id = new.catalog_item_id
        and (tg_op = 'INSERT' or e.id <> new.id))
    +
    (select count(*) from public.catalog_item_example_placements p
      where p.organization_id = new.organization_id and p.catalog_item_id = new.catalog_item_id)
  into v_total;
  if v_total >= 8 then
    raise exception using errcode = 'P0001', message = 'catalog item already has eight examples';
  end if;
  return new;
end;
$$;

create trigger guard_catalog_example_base_slot
before insert or update of organization_id, catalog_item_id, display_order
on public.catalog_item_examples
for each row execute function public.guard_catalog_example_base_slot();

create or replace function public.protect_shared_catalog_stream_source()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.catalog_item_example_placements p
    where p.organization_id = old.organization_id
      and p.source_example_id = old.id
  ) then
    if tg_op = 'DELETE'
       or new.organization_id is distinct from old.organization_id
       or new.catalog_item_id is distinct from old.catalog_item_id
       or new.stream_uid is distinct from old.stream_uid
       or new.source_type is distinct from old.source_type
       or new.kind is distinct from old.kind
       or new.status is distinct from old.status
       or new.active is distinct from old.active then
      raise exception using errcode = 'P0001', message = 'catalog video is still shared';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger protect_shared_catalog_stream_source
before update or delete on public.catalog_item_examples
for each row execute function public.protect_shared_catalog_stream_source();

create or replace function public.attach_external_catalog_example(
  p_organization_id uuid,
  p_catalog_item_id uuid,
  p_title text,
  p_description text,
  p_kind text,
  p_external_url text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_display_order integer;
  v_id uuid;
begin
  if p_kind not in ('video', 'interactive', 'link')
     or char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(coalesce(p_description, '')) > 500
     or p_external_url not like 'https://%'
     or char_length(p_external_url) > 2048 then
    return null;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || p_organization_id::text || ':' || p_catalog_item_id::text, 0)
  );
  if not exists (
    select 1 from public.catalog_items
    where id = p_catalog_item_id and organization_id = p_organization_id
  ) then return null; end if;
  v_display_order := public.next_catalog_example_display_order(p_organization_id, p_catalog_item_id);
  if v_display_order is null then return null; end if;

  insert into public.catalog_item_examples (
    organization_id, catalog_item_id, title, description, kind, source_type,
    external_url, status, active, display_order
  ) values (
    p_organization_id, p_catalog_item_id, btrim(p_title), nullif(btrim(p_description), ''),
    p_kind, 'external_url', p_external_url, 'ready', true, v_display_order
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.attach_external_catalog_example(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_external_catalog_example(uuid, uuid, text, text, text, text)
  to service_role;

create or replace function public.attach_shared_catalog_stream_example(
  p_organization_id uuid,
  p_catalog_item_id uuid,
  p_source_example_id uuid,
  p_title text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_display_order integer;
  v_id uuid;
begin
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(coalesce(p_description, '')) > 500 then
    return null;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-stream-example:' || p_source_example_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || p_organization_id::text || ':' || p_catalog_item_id::text, 0)
  );
  select id into v_id
  from public.catalog_item_example_placements
  where organization_id = p_organization_id
    and catalog_item_id = p_catalog_item_id
    and source_example_id = p_source_example_id;
  if found then return v_id; end if;
  v_display_order := public.next_catalog_example_display_order(p_organization_id, p_catalog_item_id);
  if v_display_order is null then return null; end if;

  insert into public.catalog_item_example_placements (
    organization_id, catalog_item_id, source_example_id, title, description,
    display_order, active
  ) values (
    p_organization_id, p_catalog_item_id, p_source_example_id, btrim(p_title),
    nullif(btrim(p_description), ''), v_display_order, true
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.attach_shared_catalog_stream_example(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_shared_catalog_stream_example(uuid, uuid, uuid, text, text)
  to service_role;

create or replace function public.remove_shared_catalog_stream_placement(
  p_organization_id uuid,
  p_placement_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_catalog_item_id uuid;
  v_source_example_id uuid;
begin
  select catalog_item_id, source_example_id
  into v_catalog_item_id, v_source_example_id
  from public.catalog_item_example_placements
  where id = p_placement_id and organization_id = p_organization_id
  for update;
  if not found then return false; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('catalog-stream-example:' || v_source_example_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || p_organization_id::text || ':' || v_catalog_item_id::text, 0)
  );
  delete from public.catalog_item_example_placements
  where id = p_placement_id and organization_id = p_organization_id;
  return found;
end;
$$;
revoke all on function public.remove_shared_catalog_stream_placement(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_shared_catalog_stream_placement(uuid, uuid)
  to service_role;

create or replace function public.claim_catalog_stream_upload(
  p_claim_id uuid,
  p_organization_id uuid,
  p_catalog_item_id uuid
) returns text
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || p_organization_id::text || ':' || p_catalog_item_id::text, 0)
  );
  if exists (select 1 from public.catalog_stream_upload_claims where id = p_claim_id) then return 'duplicate'; end if;
  if not exists (
    select 1 from public.catalog_items where id = p_catalog_item_id and organization_id = p_organization_id
  ) then return 'catalog_not_found'; end if;
  if (
    select count(*) from public.catalog_stream_upload_claims
    where organization_id = p_organization_id and created_at >= now() - interval '1 hour'
  ) >= 10 then return 'rate_limited'; end if;
  if (
    select count(*) from public.catalog_stream_upload_claims
    where organization_id = p_organization_id
      and state in ('claimed', 'provider_unknown', 'provisioned', 'attached')
  ) >= 2 then return 'too_many_pending'; end if;
  if public.next_catalog_example_display_order(p_organization_id, p_catalog_item_id) is null then
    return 'max_examples';
  end if;
  insert into public.catalog_stream_upload_claims (id, organization_id, catalog_item_id)
  values (p_claim_id, p_organization_id, p_catalog_item_id);
  return 'claimed';
end;
$$;

create or replace function public.attach_catalog_stream_upload(
  p_claim_id uuid,
  p_organization_id uuid,
  p_catalog_item_id uuid,
  p_stream_uid text,
  p_title text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_example_id uuid;
  v_display_order integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || p_organization_id::text || ':' || p_catalog_item_id::text, 0)
  );
  perform 1 from public.catalog_stream_upload_claims
  where id = p_claim_id and organization_id = p_organization_id
    and catalog_item_id = p_catalog_item_id and stream_uid = p_stream_uid and state = 'provisioned'
  for update;
  if not found then return null; end if;
  v_display_order := public.next_catalog_example_display_order(p_organization_id, p_catalog_item_id);
  if v_display_order is null then return null; end if;

  insert into public.catalog_item_examples (
    organization_id, catalog_item_id, title, description, kind, source_type,
    stream_uid, status, active, display_order
  ) values (
    p_organization_id, p_catalog_item_id, p_title, nullif(p_description, ''),
    'video', 'cloudflare_stream', p_stream_uid, 'uploading', true, v_display_order
  ) returning id into v_example_id;

  update public.catalog_stream_upload_claims
  set example_id = v_example_id, state = 'attached', updated_at = now()
  where id = p_claim_id and organization_id = p_organization_id
    and catalog_item_id = p_catalog_item_id and stream_uid = p_stream_uid and state = 'provisioned';
  if not found then raise exception 'catalog stream upload claim changed during attachment'; end if;
  return v_example_id;
end;
$$;

create or replace function public.begin_catalog_stream_example_deletion(
  p_example_id uuid,
  p_organization_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stream_uid text;
begin
  perform pg_advisory_xact_lock(hashtextextended('catalog-stream-example:' || p_example_id::text, 0));
  select stream_uid into v_stream_uid
  from public.catalog_item_examples
  where organization_id = p_organization_id and id = p_example_id
    and source_type = 'cloudflare_stream' and stream_uid is not null
    and status in ('uploading', 'ready', 'failed', 'deleting')
  for update;
  if not found then return null; end if;
  if exists (
    select 1 from public.catalog_item_example_placements
    where organization_id = p_organization_id and source_example_id = p_example_id
  ) then return null; end if;

  perform 1 from public.catalog_stream_upload_claims
  where organization_id = p_organization_id and example_id = p_example_id
    and stream_uid = v_stream_uid and state in ('attached', 'completed', 'cleanup_required')
  for update;
  if not found then return null; end if;

  update public.catalog_item_examples set active = false, status = 'deleting'
  where organization_id = p_organization_id and id = p_example_id and stream_uid = v_stream_uid;
  update public.catalog_stream_upload_claims set state = 'cleanup_required', updated_at = now()
  where organization_id = p_organization_id and example_id = p_example_id
    and stream_uid = v_stream_uid and state in ('attached', 'completed', 'cleanup_required');
  if not found then raise exception 'catalog Stream deletion transition race'; end if;
  return v_stream_uid;
end;
$$;

comment on table public.catalog_item_example_placements is
  'Tenant-scoped reusable placements of one ready managed video on additional catalog items. Removing a placement never deletes the provider asset.';

-- ============================================================================
-- End supabase/migrations/20260817143000_shared_catalog_video_placements.sql
-- ============================================================================
