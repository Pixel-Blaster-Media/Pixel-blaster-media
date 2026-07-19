-- ============================================================================
-- Booking notification log
--
-- Tracks one-off emails sent for a booking so admin actions and future cron
-- jobs can be idempotent.
-- ============================================================================

create table if not exists public.booking_notifications (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  recipient_email text not null,
  unique (booking_id, kind, recipient_email)
);

alter table public.booking_notifications enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'booking_notifications'
      and policyname = 'booking_notifications_admin_all'
  ) then
    create policy "booking_notifications_admin_all"
      on public.booking_notifications
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;
