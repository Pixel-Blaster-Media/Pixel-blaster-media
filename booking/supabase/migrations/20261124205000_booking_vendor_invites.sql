create table public.vendor_contacts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (length(email) between 3 and 254 and email = lower(email)),
  name text not null check (length(name) <= 100),
  logo_url text check (length(logo_url) <= 1000 and logo_url like 'https://%'),
  primary key (organization_id, email)
);

create table public.booking_vendor_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  booking_id uuid not null,
  email text not null check (length(email) between 3 and 254 and email = lower(email)),
  name text not null check (length(name) <= 100),
  logo_url text check (length(logo_url) <= 1000 and logo_url like 'https://%'),
  instructions text not null default '' check (length(instructions) <= 1500),
  removed boolean not null default false,
  calendar_connection_id bigint,
  calendar_id text,
  google_event_id text,
  sent_fingerprint text,
  lease_until timestamptz,
  foreign key (organization_id, booking_id) references public.bookings(organization_id, id),
  unique (organization_id, booking_id, email)
);

alter table public.vendor_contacts enable row level security;
alter table public.booking_vendor_invites enable row level security;
revoke all on public.vendor_contacts, public.booking_vendor_invites from anon, authenticated, public;
grant select, insert, update, delete on public.vendor_contacts, public.booking_vendor_invites to service_role;
