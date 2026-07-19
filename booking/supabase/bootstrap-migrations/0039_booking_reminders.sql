-- ============================================================================
-- Pixel Blaster Booking — Phase 39: day-before shoot reminders
-- ----------------------------------------------------------------------------
-- Realtors too often forget the shoot is happening and the property isn't
-- photo-ready (or accessible) when the photographer shows up. A daily Vercel
-- cron (/api/cron/reminders) emails every realtor whose shoot lands on
-- tomorrow's calendar date in the business timezone.
--
-- `reminder_sent_at` is the idempotency stamp: null means "not reminded yet",
-- and the cron only ever picks up rows where it is null, so retries and
-- overlapping runs can't double-email anyone.
-- ============================================================================

alter table public.bookings
  add column if not exists reminder_sent_at timestamptz;

comment on column public.bookings.reminder_sent_at is
  'When the day-before shoot reminder email was sent. Null = not yet sent; the reminders cron only considers null rows.';

-- Partial index matching the cron query shape (pending reminders scanned by
-- shoot time). Indexing reminder_sent_at alone would be near-useless — it is
-- null for almost every row — so index scheduled_at over the pending subset.
create index if not exists bookings_reminder_pending_idx
  on public.bookings (scheduled_at)
  where reminder_sent_at is null;
