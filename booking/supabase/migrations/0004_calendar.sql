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
