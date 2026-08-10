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
  slug text unique,
  primary_color text,
  accent_color text,
  invoice_timing text not null default 'on_delivery',
  email_from_name text,
  reply_to_email text,
  admin_notification_email text
);
create table public.profiles (
  id uuid primary key,
  organization_id uuid references public.organizations(id),
  role text not null,
  email text not null default 'fixture@example.com',
  full_name text,
  phone text,
  brokerage text,
  delivery_cc_emails text[] not null default '{}',
  archived_at timestamptz
);
create table public.organization_members (
  organization_id uuid not null references public.organizations(id),
  profile_id uuid not null references public.profiles(id),
  role text not null,
  primary key (organization_id, profile_id)
);
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  owner_id uuid not null references public.profiles(id),
  street_address text not null,
  city text,
  province text default 'ON',
  postal_code text,
  created_at timestamptz not null default now()
);
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  slug text not null,
  name text not null,
  description text not null default '',
  kind text not null,
  active boolean not null default true,
  taxable boolean not null default true,
  display_order integer not null default 0,
  is_photo boolean not null default false,
  is_video boolean not null default false,
  require_has_video boolean not null default false,
  duration_minutes integer not null,
  price_cents integer not null,
  sqft_pricing_enabled boolean not null default false,
  included_sqft integer,
  overage_increment_sqft integer,
  overage_price_cents integer,
  badge text,
  highlight boolean not null default false,
  ideal_for text,
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);
create type public.booking_status as enum ('requested','confirmed','shot','editing','delivered','completed','cancelled');
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  status public.booking_status not null,
  scheduled_at timestamptz,
  scheduled_ends_at timestamptz,
  allow_schedule_overlap boolean not null default false,
  services text[] not null default '{}',
  add_ons text[] not null default '{}',
  client_notes text,
  unit_number text,
  square_footage integer,
  is_vacant text check (is_vacant in ('vacant','occupied','partial')),
  include_basement boolean,
  google_calendar_event_id text,
  google_calendar_event_url text,
  created_at timestamptz not null default now(),
  constraint bookings_schedule_order_check check (
    scheduled_at is null or scheduled_ends_at is null or scheduled_ends_at > scheduled_at
  )
);
create table public.booking_line_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  quantity integer not null default 1 check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  unit_duration_minutes integer not null check (unit_duration_minutes >= 0),
  created_at timestamptz not null default now()
);

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

create or replace function public.guard_booking_schedule_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('requested', 'confirmed', 'shot', 'editing', 'delivered')
     and new.scheduled_at is not null
     and new.scheduled_ends_at is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.organization_id::text, 0)
    );
    if not new.allow_schedule_overlap and exists (
      select 1 from public.bookings existing
      where existing.organization_id = new.organization_id
        and existing.id <> new.id
        and existing.status in ('requested', 'confirmed', 'shot', 'editing', 'delivered')
        and existing.scheduled_at is not null
        and existing.scheduled_ends_at is not null
        and pg_catalog.tstzrange(existing.scheduled_at, existing.scheduled_ends_at, '[)')
            && pg_catalog.tstzrange(new.scheduled_at, new.scheduled_ends_at, '[)')
    ) then
      raise exception 'Booking overlaps an active booking' using errcode = '23P01';
    end if;
  end if;
  return new;
end;
$$;

create trigger bookings_schedule_overlap_guard
before insert or update of organization_id, status, scheduled_at, scheduled_ends_at, allow_schedule_overlap
on public.bookings
for each row execute function public.guard_booking_schedule_overlap();

insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Starter Company');
