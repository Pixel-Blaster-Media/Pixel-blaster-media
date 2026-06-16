-- Calendar source colours for the Apple Calendar-style admin sidebar.

alter table public.google_calendar_connection
  add column if not exists source_color text not null default '#2f80b7'
    check (source_color ~ '^#[0-9A-Fa-f]{6}$');

update public.google_calendar_connection
set source_color = case
  when write_bookings is true then '#3f7356'
  else coalesce(source_color, '#2f80b7')
end;

comment on column public.google_calendar_connection.source_color is
  'Hex colour used for this Google Calendar source in admin calendar views.';
