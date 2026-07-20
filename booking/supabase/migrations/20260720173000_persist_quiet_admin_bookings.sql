-- Persist the admin's quiet-booking choice so later reminders and Calendar
-- reconciliation cannot contact the realtor after creation.

alter table public.bookings
  add column if not exists suppress_realtor_notifications boolean not null default false;

comment on column public.bookings.suppress_realtor_notifications is
  'When true, automatic realtor-facing booking emails, reminders, and Google Calendar attendee invitations are suppressed.';
