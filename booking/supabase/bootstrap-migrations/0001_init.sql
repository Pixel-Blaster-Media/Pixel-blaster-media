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
