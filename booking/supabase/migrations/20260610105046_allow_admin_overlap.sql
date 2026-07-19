-- Phase 37: allow intentional admin double-booking.
-- Drops the Phase-13 exclusion guard so the admin can deliberately
-- overlap shoots (e.g. book over the tail of a job that won't run
-- long). Realtor-facing flows still enforce conflicts in app code.
alter table public.bookings
  drop constraint if exists bookings_active_schedule_no_overlap;;
