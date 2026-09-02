-- Contract phase: run only after the application has switched every booking-note
-- reader/writer to booking_internal_notes and the revisioned service-only RPC.
-- The enclosing migration runner executes this file in one transaction.

set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.bookings in access exclusive mode;
lock table public.booking_internal_notes in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.bookings booking
    left join public.booking_internal_notes note
      on note.organization_id = booking.organization_id
     and note.booking_id = booking.id
    where (booking.internal_notes is not null or note.booking_id is not null)
      and booking.internal_notes is distinct from note.notes
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'legacy and private booking notes are not exactly synchronized';
  end if;
end;
$$;

drop trigger if exists bookings_mirror_legacy_internal_notes on public.bookings;

update public.bookings
set internal_notes = null
where internal_notes is not null;

alter table public.bookings
  add constraint bookings_internal_notes_must_be_null
  check (internal_notes is null)
  not valid;

alter table public.bookings
  validate constraint bookings_internal_notes_must_be_null;

drop function if exists public.mirror_legacy_booking_internal_notes();

create or replace function public.update_booking_internal_notes(
  p_organization_id uuid,
  p_booking_id uuid,
  p_expected_revision bigint,
  p_notes text,
  p_actor_id uuid
)
returns table (
  result_status text,
  result_notes text,
  result_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_notes text;
  v_current_revision bigint;
begin
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid expected private-note revision';
  end if;
  if p_notes is not null and (
    p_notes is distinct from btrim(p_notes)
    or char_length(p_notes) < 1
    or char_length(p_notes) > 2000
  ) then
    raise exception using errcode = '22023', message = 'invalid normalized private note';
  end if;
  if not exists (
    select 1
    from public.organization_members membership
    join public.profiles profile
      on profile.id = membership.profile_id
     and profile.organization_id = membership.organization_id
    where membership.organization_id = p_organization_id
      and membership.profile_id = p_actor_id
      and membership.role in ('owner', 'admin')
      and profile.role = 'admin'
      and profile.archived_at is null
  ) then
    raise exception using errcode = '42501', message = 'private-note actor is not an active organization admin';
  end if;

  perform 1
  from public.bookings booking
  where booking.organization_id = p_organization_id
    and booking.id = p_booking_id
  for update;
  if not found then
    return query select 'not_found'::text, null::text, null::bigint;
    return;
  end if;

  select note.notes, note.revision
  into v_current_notes, v_current_revision
  from public.booking_internal_notes note
  where note.organization_id = p_organization_id
    and note.booking_id = p_booking_id
  for update;
  v_current_revision := coalesce(v_current_revision, 0);

  if p_expected_revision <> v_current_revision then
    return query select 'conflict'::text, v_current_notes, v_current_revision;
    return;
  end if;
  if v_current_revision > 0 and v_current_notes is not distinct from p_notes then
    return query select 'saved'::text, v_current_notes, v_current_revision;
    return;
  end if;

  if v_current_revision = 0 then
    insert into public.booking_internal_notes (
      booking_id,
      organization_id,
      notes,
      revision,
      updated_by
    ) values (
      p_booking_id,
      p_organization_id,
      p_notes,
      1,
      p_actor_id
    )
    returning notes, revision into v_current_notes, v_current_revision;
  else
    update public.booking_internal_notes note
    set notes = p_notes,
        revision = note.revision + 1,
        updated_by = p_actor_id,
        updated_at = now()
    where note.organization_id = p_organization_id
      and note.booking_id = p_booking_id
    returning note.notes, note.revision
    into v_current_notes, v_current_revision;
  end if;

  return query select 'saved'::text, v_current_notes, v_current_revision;
end;
$$;

revoke all on table public.booking_internal_notes
  from public, anon, authenticated, service_role;
revoke all on function public.update_booking_internal_notes(uuid, uuid, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.update_booking_internal_notes(uuid, uuid, bigint, text, uuid)
  to service_role;

comment on column public.bookings.internal_notes is
  'Legacy compatibility column. Must remain NULL; private notes live in service-only booking_internal_notes.';
comment on function public.update_booking_internal_notes(uuid, uuid, bigint, text, uuid) is
  'Service-role-only post-contract tenant-scoped optimistic mutation boundary for private shoot notes.';
