-- Pixel Blaster Booking — account-level delivery CC recipients
-- Admins can store teammate/assistant emails on a realtor profile so every
-- delivery email automatically copies the right people.

alter table public.profiles
  add column if not exists delivery_cc_emails text[] not null default '{}';
