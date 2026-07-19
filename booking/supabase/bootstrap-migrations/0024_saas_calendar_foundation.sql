-- ============================================================================
-- SaaS foundation: default organization + organization-scoped calendar
-- ----------------------------------------------------------------------------
-- Pixel Blaster remains the first/default tenant, but integrations should not
-- stay hard-coded as one global connection forever. This migration creates a
-- default organization and scopes Google Calendar connections to it while
-- keeping existing rows working.
-- ============================================================================

create table if not exists public.organizations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,
  primary_color     text,
  accent_color      text,
  logo_url          text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;

drop policy if exists "organizations: admin read" on public.organizations;
create policy "organizations: admin read"
  on public.organizations for select
  using (public.is_admin());

drop policy if exists "organizations: admin write" on public.organizations;
create policy "organizations: admin write"
  on public.organizations for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.organizations (id, name, slug, primary_color, accent_color)
values (
  '00000000-0000-0000-0000-000000000001',
  'Pixel Blaster Media',
  'pixel-blaster',
  '#3f7f5f',
  '#c9a35b'
)
on conflict (id) do update
set
  name = excluded.name,
  slug = excluded.slug,
  updated_at = now();

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  role            text not null default 'member'
                  check (role in ('owner', 'admin', 'member')),
  created_at      timestamptz not null default now(),
  primary key (organization_id, profile_id)
);

alter table public.organization_members enable row level security;

drop policy if exists "organization_members: self or admin read" on public.organization_members;
create policy "organization_members: self or admin read"
  on public.organization_members for select
  using (profile_id = auth.uid() or public.is_admin());

drop policy if exists "organization_members: admin write" on public.organization_members;
create policy "organization_members: admin write"
  on public.organization_members for all
  using (public.is_admin())
  with check (public.is_admin());

alter table public.profiles
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict;

update public.profiles
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.profiles
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists profiles_organization_idx
  on public.profiles(organization_id);

insert into public.organization_members (organization_id, profile_id, role)
select
  '00000000-0000-0000-0000-000000000001',
  id,
  case when role = 'admin' then 'admin' else 'member' end
from public.profiles
on conflict (organization_id, profile_id) do update
set role = excluded.role;

create or replace function public.sync_profile_organization_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is not null then
    insert into public.organization_members (organization_id, profile_id, role)
    values (
      new.organization_id,
      new.id,
      case when new.role = 'admin' then 'admin' else 'member' end
    )
    on conflict (organization_id, profile_id) do update
    set role = excluded.role;
  end if;

  if old.organization_id is not null
     and old.organization_id is distinct from new.organization_id then
    delete from public.organization_members
    where organization_id = old.organization_id
      and profile_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_profile_organization_membership()
  from public, anon, authenticated;

drop trigger if exists profiles_sync_organization_membership on public.profiles;
create trigger profiles_sync_organization_membership
  after insert or update of organization_id, role on public.profiles
  for each row execute function public.sync_profile_organization_membership();

alter table public.properties
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict;

update public.properties
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.properties
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists properties_organization_idx
  on public.properties(organization_id);

alter table public.bookings
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict;

update public.bookings
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.bookings
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists bookings_organization_idx
  on public.bookings(organization_id);

alter table public.google_calendar_connection
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.google_calendar_connection
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.google_calendar_connection
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.google_calendar_connection
    drop constraint if exists google_calendar_connection_id_check;
end $$;

create sequence if not exists public.google_calendar_connection_id_seq;

select setval(
  'public.google_calendar_connection_id_seq',
  greatest(
    1,
    coalesce((select max(id) from public.google_calendar_connection), 1)
  ),
  true
);

alter table public.google_calendar_connection
  alter column id set default nextval('public.google_calendar_connection_id_seq');

alter sequence public.google_calendar_connection_id_seq
  owned by public.google_calendar_connection.id;

create unique index if not exists google_calendar_connection_org_idx
  on public.google_calendar_connection(organization_id);

comment on table public.organizations is
  'SaaS tenant/business record. Pixel Blaster is the default first organization.';

comment on column public.google_calendar_connection.organization_id is
  'Organization/business that owns this Google Calendar OAuth connection.';
