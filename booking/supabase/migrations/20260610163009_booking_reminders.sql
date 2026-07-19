-- Phase 39: day-before shoot reminders. Tracks when the automatic
-- reminder email went out so the daily cron sends each booking's
-- reminder exactly once. Partial index matches the cron's query shape
-- (pending reminders only).
alter table public.bookings
  add column if not exists reminder_sent_at timestamptz;

create index if not exists bookings_reminder_pending_idx
  on public.bookings (scheduled_at)
  where reminder_sent_at is null;;
