-- Tenant-scope provider identities stored on deliverables.
-- A provider may reuse the same external ID in two unrelated accounts; those
-- rows must not conflict across organizations.

alter table public.deliverables
  add column if not exists organization_id uuid
  references public.organizations(id) on delete cascade;

-- Keep the backfill, validation, trigger installation, and constraint swap in
-- one migration transaction without a concurrent-write gap.
lock table public.deliverables in share row exclusive mode;

update public.deliverables d
set organization_id = b.organization_id
from public.bookings b
where b.id = d.booking_id
  and d.organization_id is distinct from b.organization_id;

do $$
begin
  if exists (
    select 1
    from public.deliverables d
    left join public.bookings b on b.id = d.booking_id
    left join public.properties p on p.id = d.property_id
    where b.id is null
       or p.id is null
       or b.property_id is distinct from d.property_id
       or b.organization_id is distinct from p.organization_id
       or d.organization_id is distinct from b.organization_id
  ) then
    raise exception 'Cannot tenant-scope deliverables: booking/property organization mismatch exists';
  end if;
end;
$$;

create or replace function public.set_deliverable_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking_organization_id uuid;
  booking_property_id uuid;
  property_organization_id uuid;
begin
  select b.organization_id, b.property_id
    into booking_organization_id, booking_property_id
  from public.bookings b
  where b.id = new.booking_id;

  select p.organization_id
    into property_organization_id
  from public.properties p
  where p.id = new.property_id;

  if booking_organization_id is null or property_organization_id is null then
    raise exception 'Deliverable booking and property must exist';
  end if;

  if new.property_id is distinct from booking_property_id then
    raise exception 'Deliverable property must match its booking property';
  end if;

  if booking_organization_id is distinct from property_organization_id then
    raise exception 'Deliverable booking and property must belong to the same organization';
  end if;

  if new.organization_id is null then
    new.organization_id := booking_organization_id;
  elsif new.organization_id is distinct from booking_organization_id then
    raise exception 'Deliverable organization must match its booking and property';
  end if;

  return new;
end;
$$;

revoke all on function public.set_deliverable_organization() from public;
revoke all on function public.set_deliverable_organization() from anon;
revoke all on function public.set_deliverable_organization() from authenticated;

drop trigger if exists deliverables_set_organization on public.deliverables;
create trigger deliverables_set_organization
before insert or update of organization_id, booking_id, property_id
on public.deliverables
for each row execute function public.set_deliverable_organization();

alter table public.deliverables
  alter column organization_id set not null;

alter table public.deliverables
  drop constraint if exists deliverables_source_external_id_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.deliverables'::regclass
      and conname = 'deliverables_organization_source_external_id_key'
      and contype = 'u'
  ) then
    alter table public.deliverables
      add constraint deliverables_organization_source_external_id_key
      unique (organization_id, source, external_id);
  end if;
end;
$$;

create index if not exists deliverables_organization_idx
  on public.deliverables(organization_id);
