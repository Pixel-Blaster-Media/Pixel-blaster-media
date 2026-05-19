-- Pixel Blaster Booking — private agent preference notes
-- Admin-only notes for realtor preferences, delivery reminders, and workflow
-- gotchas. These are intentionally internal and should not render in the
-- realtor portal or public listing pages.

alter table public.profiles
  add column if not exists internal_notes text;
