-- ============================================================================
-- Pixel Blaster Booking — ONE-PASTE SETUP
--
-- THIS IS FOR FIRST-TIME SETUP ONLY.
--
-- What this file does, in order:
--   1. Creates every table the app needs (profiles, properties, bookings,
--      deliverables, booking_requests, business_hours, calendar_blocks,
--      quickbooks_connection, service_prices)
--   2. Sets up Row Level Security so realtors only see their own data
--   3. Seeds working hours (Mon-Fri 9-5, weekends off) and blank prices
--   4. Creates an admin user for YOU and promotes you to admin role
--
-- HOW TO USE:
--   1. Edit the line below that says `!!! EDIT ME !!!` with your email.
--   2. Paste this WHOLE FILE into Supabase's SQL Editor.
--   3. Click Run. Takes ~5 seconds. Wait for "Success".
--   4. Done. Close the SQL Editor. You're set up.
--
-- You will NOT need to run this ever again. Future schema changes would
-- come as separate small migrations.
--
-- If this file errors partway through, it's safe to re-run — every
-- statement uses IF NOT EXISTS / ON CONFLICT DO NOTHING guards.
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
-- ADMIN BOOTSTRAP — creates your account and promotes you to admin
-- ============================================================================
-- Edit the email on the next line, then the whole block will work.

do $$
declare
  -- !!! EDIT ME !!!  Replace with the email you want to sign in with.
  admin_email text := 'you@example.com';
  new_user_id uuid;
begin
  -- Skip entirely if a user with this email already exists (safe to re-run).
  if exists (select 1 from auth.users where email = admin_email) then
    update public.profiles
      set role = 'admin'
      where email = admin_email;
    raise notice 'Admin user % already existed — promoted to admin role.', admin_email;
    return;
  end if;

  -- Create the auth user with a random password (never used — you'll sign
  -- in via magic link every time). email_confirmed_at = now() skips the
  -- "click to verify" email.
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    admin_email,
    crypt(gen_random_uuid()::text, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  returning id into new_user_id;

  -- The trigger in the schema above auto-creates the profiles row when
  -- auth.users gets a new row. We just need to promote it.
  update public.profiles
    set role = 'admin'
    where id = new_user_id;

  raise notice 'Created admin user % with id %. Sign in at /auth/sign-in.', admin_email, new_user_id;
end $$;
