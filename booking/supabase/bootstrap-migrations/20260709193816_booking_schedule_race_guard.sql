-- Keep public/realtor booking writes race-safe while preserving the admin's
-- deliberate ability to overlap shoots. Migration 0037 removed the exclusion
-- constraint globally, which also removed the atomic protection from two
-- simultaneous public submissions.

alter table public.bookings
  add column if not exists allow_schedule_overlap boolean not null default false;

-- Preserve any deliberate overlaps that already exist, so ordinary status
-- changes on those bookings do not fail after the trigger is installed.
update public.bookings booking
set allow_schedule_overlap = true
where booking.status in ('requested', 'confirmed', 'shot', 'editing', 'delivered')
  and booking.scheduled_at is not null
  and booking.scheduled_ends_at is not null
  and exists (
    select 1
    from public.bookings other
    where other.organization_id = booking.organization_id
      and other.id <> booking.id
      and other.status in (
        'requested', 'confirmed', 'shot', 'editing', 'delivered'
      )
      and other.scheduled_at is not null
      and other.scheduled_ends_at is not null
      and pg_catalog.tstzrange(
        other.scheduled_at,
        other.scheduled_ends_at,
        '[)'
      ) && pg_catalog.tstzrange(
        booking.scheduled_at,
        booking.scheduled_ends_at,
        '[)'
      )
  );

create or replace function public.guard_booking_schedule_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('requested', 'confirmed', 'shot', 'editing', 'delivered')
     and new.scheduled_at is not null
     and new.scheduled_ends_at is not null then
    -- Serialize schedule writes per tenant so the check and write are atomic,
    -- including across separate Vercel/serverless invocations.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.organization_id::text, 0)
    );

    if not new.allow_schedule_overlap and exists (
      select 1
      from public.bookings existing
      where existing.organization_id = new.organization_id
        and existing.id <> new.id
        and existing.status in (
          'requested', 'confirmed', 'shot', 'editing', 'delivered'
        )
        and existing.scheduled_at is not null
        and existing.scheduled_ends_at is not null
        and pg_catalog.tstzrange(
          existing.scheduled_at,
          existing.scheduled_ends_at,
          '[)'
        ) && pg_catalog.tstzrange(
          new.scheduled_at,
          new.scheduled_ends_at,
          '[)'
        )
    ) then
      raise exception 'Booking overlaps an active booking'
        using errcode = '23P01';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_schedule_overlap_guard on public.bookings;
create trigger bookings_schedule_overlap_guard
before insert or update of
  organization_id,
  status,
  scheduled_at,
  scheduled_ends_at,
  allow_schedule_overlap
on public.bookings
for each row execute function public.guard_booking_schedule_overlap();

revoke all on function public.guard_booking_schedule_overlap()
  from public, anon, authenticated;

-- A realtor writing through the authenticated API can never opt into the
-- admin-only overlap escape hatch. Organization admins retain that ability.
drop policy if exists "bookings: owner or org admin insert" on public.bookings;
create policy "bookings: owner or org admin insert"
  on public.bookings for insert
  to authenticated
  with check (
    (
      owner_id = (select auth.uid())
      and organization_id = public.current_organization_id()
      and allow_schedule_overlap = false
    )
    or public.is_organization_admin(organization_id)
  );

comment on column public.bookings.allow_schedule_overlap is
  'Admin-only escape hatch for an intentional overlap. Public writes remain serialized and overlap-checked by trigger.';

comment on function public.guard_booking_schedule_overlap() is
  'Serializes schedule writes per organization and rejects overlapping non-admin bookings atomically.';
