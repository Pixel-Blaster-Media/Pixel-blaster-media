create role anon;
create role authenticated;
create role service_role bypassrls;
grant usage, create on schema public to service_role;

create schema extensions;
create extension pgcrypto with schema extensions;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create table public.organizations (
  id uuid primary key,
  name text not null,
  slug text unique not null
);

create table public.profiles (
  id uuid primary key,
  organization_id uuid references public.organizations(id) on delete restrict,
  role text not null,
  email text not null,
  archived_at timestamptz
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  role text not null,
  primary key (organization_id, profile_id)
);

create table public.properties (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  street_address text not null,
  created_at timestamptz not null default now()
);

create type public.booking_status as enum (
  'requested', 'confirmed', 'shot', 'editing', 'delivered', 'completed', 'cancelled'
);
create table public.bookings (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  status public.booking_status not null default 'requested',
  created_at timestamptz not null default now()
);
create unique index bookings_organization_id_id_idx
  on public.bookings(organization_id, id);

create table public.listing_websites (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete set null,
  slug text not null,
  created_at timestamptz not null default now()
);

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
