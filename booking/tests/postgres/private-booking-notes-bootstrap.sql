\set ON_ERROR_STOP on

create role anon noinherit;
create role authenticated noinherit;
create role service_role noinherit bypassrls;

create schema auth;
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.organizations (
  id uuid primary key,
  name text not null
);

create table public.profiles (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  email text not null,
  role text not null,
  archived_at timestamptz
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id),
  profile_id uuid not null references public.profiles(id),
  role text not null,
  primary key (organization_id, profile_id)
);

create table public.bookings (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  owner_id uuid not null references public.profiles(id),
  allow_schedule_overlap boolean not null default false,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.current_organization_id()
returns uuid
language sql
stable
as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

create function public.is_organization_admin(p_organization_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = p_organization_id
      and membership.profile_id = auth.uid()
      and membership.role = 'admin'
  )
$$;

alter table public.bookings enable row level security;
create policy "bookings: owner or org admin read"
  on public.bookings for select
  to authenticated
  using (owner_id = auth.uid() or public.is_organization_admin(organization_id));
create policy "bookings: owner or org admin insert"
  on public.bookings for insert
  to authenticated
  with check (
    (owner_id = auth.uid() and organization_id = public.current_organization_id())
    or public.is_organization_admin(organization_id)
  );
create policy "bookings: org admin update"
  on public.bookings for update
  to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
grant select, insert, update on public.bookings to authenticated;
grant select on public.organizations, public.profiles, public.organization_members to authenticated;
grant all on public.organizations, public.profiles, public.organization_members, public.bookings to service_role;
grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.is_organization_admin(uuid) to authenticated;

insert into public.organizations (id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Pixel'),
  ('22222222-2222-4222-8222-222222222222', 'Other');

insert into public.profiles (id, organization_id, email, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'admin@invalid.test', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'realtor@invalid.test', 'realtor'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222', 'other-admin@invalid.test', 'admin'),
  ('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111', 'owner-admin@invalid.test', 'admin');

insert into public.organization_members (organization_id, profile_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'),
  ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'realtor'),
  ('22222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin'),
  ('11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', 'owner');

insert into public.bookings (id, organization_id, owner_id, internal_notes) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Legacy private note'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '22222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', null),
  ('12121212-1212-4212-8212-121212121212', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null);
