-- Pixel Blaster Booking — admin-managed realtor profile media
-- Adds public profile media fields and a small public Storage bucket for
-- headshots/logos. Writes happen server-side through admin-only actions.

alter table public.profiles
  add column if not exists profile_photo_url text,
  add column if not exists brokerage_logo_url text,
  add column if not exists website_url text,
  add column if not exists instagram_url text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-media',
  'profile-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
