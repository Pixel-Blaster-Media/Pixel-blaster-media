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
