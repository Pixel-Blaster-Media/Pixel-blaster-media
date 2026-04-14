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
