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
