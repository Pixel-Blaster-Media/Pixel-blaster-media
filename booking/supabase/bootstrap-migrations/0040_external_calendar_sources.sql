-- ============================================================================
-- External calendar sources
-- ----------------------------------------------------------------------------
-- Keep the existing Google Calendar OAuth connection as the write target for
-- Pixel Blaster bookings, while allowing additional shared calendars to show
-- in the admin calendar and/or block public booking availability.
-- ============================================================================

alter table public.google_calendar_connection
  add column if not exists display_name text,
  add column if not exists source_type text not null default 'primary'
    check (source_type in ('primary', 'external')),
  add column if not exists show_on_admin_calendar boolean not null default true,
  add column if not exists block_availability boolean not null default true,
  add column if not exists write_bookings boolean not null default true;

update public.google_calendar_connection
set
  display_name = coalesce(display_name, 'Main booking calendar'),
  source_type = coalesce(source_type, 'primary'),
  show_on_admin_calendar = coalesce(show_on_admin_calendar, true),
  block_availability = coalesce(block_availability, true),
  write_bookings = coalesce(write_bookings, true);

drop index if exists public.google_calendar_connection_org_idx;

create unique index if not exists google_calendar_connection_org_calendar_idx
  on public.google_calendar_connection(organization_id, calendar_id);

create unique index if not exists google_calendar_connection_write_target_idx
  on public.google_calendar_connection(organization_id)
  where write_bookings is true;

create index if not exists google_calendar_connection_admin_sources_idx
  on public.google_calendar_connection(organization_id, show_on_admin_calendar);

create index if not exists google_calendar_connection_block_sources_idx
  on public.google_calendar_connection(organization_id, block_availability);

comment on column public.google_calendar_connection.display_name is
  'Human label for this calendar source in admin UI.';

comment on column public.google_calendar_connection.show_on_admin_calendar is
  'Whether events from this source are rendered in /admin/calendar.';

comment on column public.google_calendar_connection.block_availability is
  'Whether busy windows from this source remove public booking slots.';

comment on column public.google_calendar_connection.write_bookings is
  'The one source per organization where newly created Pixel Blaster bookings are written.';
