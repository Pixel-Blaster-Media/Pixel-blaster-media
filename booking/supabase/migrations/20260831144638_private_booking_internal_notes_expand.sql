-- Expand phase: move booking shoot notes behind a service-only boundary while
-- preserving the currently deployed application's legacy writer until cutover.
-- The migration runner executes this file inside one transaction.

set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.bookings in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.bookings
    where internal_notes is not null
      and char_length(internal_notes) > 2000
  ) then
    raise exception using
      errcode = '22023',
      message = 'legacy booking internal note exceeds the private-note limit';
  end if;
end;
$$;

-- Production historically relied only on bookings.id as the primary key. The
-- private child is tenant-qualified, so establish the matching parent key in
-- this same bounded transaction before creating its composite foreign key.
alter table public.bookings
  add constraint bookings_organization_id_id_key
  unique (organization_id, id);

-- Close raw owner seeding immediately, before the private table is exposed to
-- any application version. Organization admins retain the legacy bridge during
-- the rolling deployment window.
drop policy if exists "bookings: owner or org admin insert" on public.bookings;
create policy "bookings: owner or org admin insert"
  on public.bookings for insert
  to authenticated
  with check (
    (
      owner_id = (select auth.uid())
      and organization_id = public.current_organization_id()
      and allow_schedule_overlap = false
      and internal_notes is null
    )
    or public.is_organization_admin(organization_id)
  );

create table public.booking_internal_notes (
  booking_id uuid primary key,
  organization_id uuid not null,
  notes text,
  revision bigint not null default 1,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_internal_notes_booking_tenant_fk
    foreign key (organization_id, booking_id)
    references public.bookings (organization_id, id)
    on delete cascade,
  constraint booking_internal_notes_tenant_key
    unique (organization_id, booking_id),
  constraint booking_internal_notes_revision_check
    check (revision >= 1),
  constraint booking_internal_notes_length_check
    check (notes is null or char_length(notes) between 1 and 2000)
);

alter table public.booking_internal_notes enable row level security;
alter table public.booking_internal_notes force row level security;
revoke all on table public.booking_internal_notes
  from public, anon, authenticated, service_role;

insert into public.booking_internal_notes (
  booking_id,
  organization_id,
  notes,
  revision,
  updated_by,
  created_at,
  updated_at
)
select
  booking.id,
  booking.organization_id,
  booking.internal_notes,
  1,
  null,
  booking.created_at,
  booking.updated_at
from public.bookings booking
where booking.internal_notes is not null;

create function public.mirror_legacy_booking_internal_notes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.internal_notes is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.internal_notes is not distinct from old.internal_notes then
    return new;
  end if;
  if new.internal_notes is not null and char_length(new.internal_notes) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'booking internal note exceeds the private-note limit';
  end if;
  if exists (
    select 1
    from public.booking_internal_notes note
    where note.organization_id = new.organization_id
      and note.booking_id = new.id
      and note.notes is not distinct from new.internal_notes
  ) then
    return new;
  end if;

  insert into public.booking_internal_notes (
    booking_id,
    organization_id,
    notes,
    revision,
    updated_by,
    created_at,
    updated_at
  ) values (
    new.id,
    new.organization_id,
    new.internal_notes,
    1,
    auth.uid(),
    now(),
    now()
  )
  on conflict (booking_id) do update
    set organization_id = excluded.organization_id,
        notes = excluded.notes,
        revision = public.booking_internal_notes.revision + 1,
        updated_by = excluded.updated_by,
        updated_at = now();
  return new;
end;
$$;

revoke all on function public.mirror_legacy_booking_internal_notes()
  from public, anon, authenticated, service_role;

create trigger bookings_mirror_legacy_internal_notes
  after insert or update of internal_notes
  on public.bookings
  for each row execute function public.mirror_legacy_booking_internal_notes();

create function public.get_booking_internal_notes(
  p_organization_id uuid,
  p_booking_ids uuid[],
  p_actor_id uuid
)
returns table (
  booking_id uuid,
  notes text,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_booking_ids is null or cardinality(p_booking_ids) > 1000 then
    raise exception using errcode = '22023', message = 'invalid private-note read scope';
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

  return query
    select note.booking_id, note.notes, note.revision
    from public.booking_internal_notes note
    join public.bookings booking
      on booking.organization_id = note.organization_id
     and booking.id = note.booking_id
    where note.organization_id = p_organization_id
      and note.booking_id = any(p_booking_ids);
end;
$$;

revoke all on function public.get_booking_internal_notes(uuid, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.get_booking_internal_notes(uuid, uuid[], uuid)
  to service_role;

create function public.update_booking_internal_notes(
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
    return query
      select 'conflict'::text, v_current_notes, v_current_revision;
    return;
  end if;
  if v_current_revision > 0 and v_current_notes is not distinct from p_notes then
    update public.bookings booking
    set internal_notes = p_notes
    where booking.organization_id = p_organization_id
      and booking.id = p_booking_id
      and booking.internal_notes is distinct from p_notes;
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

  update public.bookings booking
  set internal_notes = v_current_notes
  where booking.organization_id = p_organization_id
    and booking.id = p_booking_id
    and booking.internal_notes is distinct from v_current_notes;

  return query select 'saved'::text, v_current_notes, v_current_revision;
end;
$$;

revoke all on function public.update_booking_internal_notes(uuid, uuid, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.update_booking_internal_notes(uuid, uuid, bigint, text, uuid)
  to service_role;

comment on table public.booking_internal_notes is
  'Service-only private shoot notes. Browser roles must never read or mutate this table.';
comment on function public.update_booking_internal_notes(uuid, uuid, bigint, text, uuid) is
  'Service-role-only tenant-scoped optimistic mutation boundary for private shoot notes.';
