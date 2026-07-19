-- ============================================================================
-- SaaS tenant isolation hardening
-- ----------------------------------------------------------------------------
-- 0024 created the first organization and scoped the largest records. This
-- migration continues that work by scoping operational settings, catalog,
-- credentials, and integration connections to an organization, then tightens
-- RLS so future company admins cannot see or edit another company's data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

create or replace function public.is_organization_admin(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.profile_id = auth.uid()
      and om.organization_id = target_org_id
      and om.role in ('owner', 'admin')
  );
$$;

revoke all on function public.current_organization_id()
  from public, anon, authenticated;
grant execute on function public.current_organization_id()
  to authenticated;

revoke all on function public.is_organization_admin(uuid)
  from public, anon, authenticated;
grant execute on function public.is_organization_admin(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Add organization_id to tenant-owned tables that were still single-business.
-- ---------------------------------------------------------------------------
alter table public.business_hours
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.business_hours
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.business_hours
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.business_hours
    drop constraint if exists business_hours_pkey;
end $$;

alter table public.business_hours
  add constraint business_hours_pkey primary key (organization_id, day_of_week);

alter table public.calendar_blocks
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.calendar_blocks
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.calendar_blocks
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists calendar_blocks_organization_idx
  on public.calendar_blocks(organization_id);

alter table public.catalog_items
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.catalog_items
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.catalog_items
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.catalog_items
    drop constraint if exists catalog_items_slug_key;
end $$;

create unique index if not exists catalog_items_org_slug_idx
  on public.catalog_items(organization_id, slug);

create index if not exists catalog_items_organization_idx
  on public.catalog_items(organization_id);

alter table public.integration_credentials
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.integration_credentials
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.integration_credentials
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.integration_credentials
    drop constraint if exists integration_credentials_pkey;
end $$;

alter table public.integration_credentials
  add constraint integration_credentials_pkey
  primary key (organization_id, provider);

alter table public.quickbooks_connection
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.quickbooks_connection
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.quickbooks_connection
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.quickbooks_connection
    drop constraint if exists quickbooks_connection_id_check;
end $$;

create sequence if not exists public.quickbooks_connection_id_seq;

select setval(
  'public.quickbooks_connection_id_seq',
  greatest(
    1,
    coalesce((select max(id) from public.quickbooks_connection), 1)
  ),
  true
);

alter table public.quickbooks_connection
  alter column id set default nextval('public.quickbooks_connection_id_seq');

alter sequence public.quickbooks_connection_id_seq
  owned by public.quickbooks_connection.id;

create unique index if not exists quickbooks_connection_org_idx
  on public.quickbooks_connection(organization_id);

alter table public.service_prices
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.service_prices
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.service_prices
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

do $$
begin
  alter table public.service_prices
    drop constraint if exists service_prices_pkey;
end $$;

alter table public.service_prices
  add constraint service_prices_pkey
  primary key (organization_id, service_id);

create index if not exists service_prices_organization_idx
  on public.service_prices(organization_id);

alter table public.booking_requests
  add column if not exists organization_id uuid
    references public.organizations(id) on delete restrict;

update public.booking_requests
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.booking_requests
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists booking_requests_organization_idx
  on public.booking_requests(organization_id);

alter table public.listing_websites
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.listing_websites lw
set organization_id = p.organization_id
from public.properties p
where lw.property_id = p.id
  and lw.organization_id is null;

update public.listing_websites
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.listing_websites
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists listing_websites_organization_idx
  on public.listing_websites(organization_id);

-- ---------------------------------------------------------------------------
-- RLS: org-aware policies.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: self read" on public.profiles;
drop policy if exists "profiles: self update" on public.profiles;
drop policy if exists "profiles: admin update" on public.profiles;

create policy "profiles: self or org admin read"
  on public.profiles for select
  using (id = auth.uid() or public.is_organization_admin(organization_id));

create policy "profiles: self update"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and organization_id = public.current_organization_id()
  );

create policy "profiles: org admin update"
  on public.profiles for update
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "properties: owner read" on public.properties;
drop policy if exists "properties: owner write" on public.properties;
drop policy if exists "properties: owner update" on public.properties;

create policy "properties: owner or org admin read"
  on public.properties for select
  using (owner_id = auth.uid() or public.is_organization_admin(organization_id));

create policy "properties: owner or org admin insert"
  on public.properties for insert
  with check (
    (owner_id = auth.uid() and organization_id = public.current_organization_id())
    or public.is_organization_admin(organization_id)
  );

create policy "properties: owner or org admin update"
  on public.properties for update
  using (owner_id = auth.uid() or public.is_organization_admin(organization_id))
  with check (
    (owner_id = auth.uid() and organization_id = public.current_organization_id())
    or public.is_organization_admin(organization_id)
  );

drop policy if exists "bookings: owner read" on public.bookings;
drop policy if exists "bookings: owner insert" on public.bookings;
drop policy if exists "bookings: admin update" on public.bookings;

create policy "bookings: owner or org admin read"
  on public.bookings for select
  using (owner_id = auth.uid() or public.is_organization_admin(organization_id));

create policy "bookings: owner or org admin insert"
  on public.bookings for insert
  with check (
    (owner_id = auth.uid() and organization_id = public.current_organization_id())
    or public.is_organization_admin(organization_id)
  );

create policy "bookings: org admin update"
  on public.bookings for update
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "deliverables: owner read" on public.deliverables;
drop policy if exists "deliverables: admin write" on public.deliverables;

create policy "deliverables: owner or org admin read"
  on public.deliverables for select
  using (
    exists (
      select 1 from public.bookings b
      where b.id = deliverables.booking_id
        and (
          b.owner_id = auth.uid()
          or public.is_organization_admin(b.organization_id)
        )
    )
  );

create policy "deliverables: org admin write"
  on public.deliverables for all
  using (
    exists (
      select 1 from public.bookings b
      where b.id = deliverables.booking_id
        and public.is_organization_admin(b.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.bookings b
      where b.id = deliverables.booking_id
        and public.is_organization_admin(b.organization_id)
    )
  );

drop policy if exists "booking_line_items: owner or admin read"
  on public.booking_line_items;
drop policy if exists "booking_line_items: admin write"
  on public.booking_line_items;

create policy "booking_line_items: owner or org admin read"
  on public.booking_line_items for select
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_line_items.booking_id
        and (
          b.owner_id = auth.uid()
          or public.is_organization_admin(b.organization_id)
        )
    )
  );

create policy "booking_line_items: org admin write"
  on public.booking_line_items for all
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_line_items.booking_id
        and public.is_organization_admin(b.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.bookings b
      where b.id = booking_line_items.booking_id
        and public.is_organization_admin(b.organization_id)
    )
  );

drop policy if exists "business_hours: authenticated read"
  on public.business_hours;
drop policy if exists "business_hours: admin write"
  on public.business_hours;

create policy "business_hours: org read"
  on public.business_hours for select
  to authenticated
  using (
    organization_id = public.current_organization_id()
    or public.is_organization_admin(organization_id)
  );

create policy "business_hours: org admin write"
  on public.business_hours for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "calendar_blocks: admin read"
  on public.calendar_blocks;
drop policy if exists "calendar_blocks: admin write"
  on public.calendar_blocks;

create policy "calendar_blocks: org admin read"
  on public.calendar_blocks for select
  using (public.is_organization_admin(organization_id));

create policy "calendar_blocks: org admin write"
  on public.calendar_blocks for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "catalog_items: public read" on public.catalog_items;
drop policy if exists "catalog_items: admin write" on public.catalog_items;

create policy "catalog_items: public default read"
  on public.catalog_items for select
  using (organization_id = '00000000-0000-0000-0000-000000000001');

create policy "catalog_items: org admin write"
  on public.catalog_items for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "integration_credentials: admin read"
  on public.integration_credentials;
drop policy if exists "integration_credentials: admin write"
  on public.integration_credentials;

create policy "integration_credentials: org admin read"
  on public.integration_credentials for select
  using (public.is_organization_admin(organization_id));

create policy "integration_credentials: org admin write"
  on public.integration_credentials for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "quickbooks_connection: admin read"
  on public.quickbooks_connection;
drop policy if exists "quickbooks_connection: admin write"
  on public.quickbooks_connection;

create policy "quickbooks_connection: org admin read"
  on public.quickbooks_connection for select
  using (public.is_organization_admin(organization_id));

create policy "quickbooks_connection: org admin write"
  on public.quickbooks_connection for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "service_prices: authenticated read"
  on public.service_prices;
drop policy if exists "service_prices: admin write"
  on public.service_prices;

create policy "service_prices: org read"
  on public.service_prices for select
  to authenticated
  using (
    organization_id = public.current_organization_id()
    or public.is_organization_admin(organization_id)
  );

create policy "service_prices: org admin write"
  on public.service_prices for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "booking_requests: admin read"
  on public.booking_requests;
drop policy if exists "booking_requests: admin update"
  on public.booking_requests;

create policy "booking_requests: org admin read"
  on public.booking_requests for select
  using (public.is_organization_admin(organization_id));

create policy "booking_requests: org admin update"
  on public.booking_requests for update
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "listing_websites: public published read"
  on public.listing_websites;
drop policy if exists "listing_websites: owner insert"
  on public.listing_websites;
drop policy if exists "listing_websites: owner update"
  on public.listing_websites;

create policy "listing_websites: public published or scoped read"
  on public.listing_websites for select
  using (
    is_published = true
    or owner_id = auth.uid()
    or public.is_organization_admin(organization_id)
  );

create policy "listing_websites: owner or org admin insert"
  on public.listing_websites for insert
  with check (
    (owner_id = auth.uid() and organization_id = public.current_organization_id())
    or public.is_organization_admin(organization_id)
  );

create policy "listing_websites: owner or org admin update"
  on public.listing_websites for update
  using (owner_id = auth.uid() or public.is_organization_admin(organization_id))
  with check (
    (owner_id = auth.uid() and organization_id = public.current_organization_id())
    or public.is_organization_admin(organization_id)
  );

comment on function public.is_organization_admin(uuid) is
  'True when the current authenticated user is an owner/admin of the target organization.';

comment on column public.catalog_items.organization_id is
  'Organization/business that owns this booking catalog item.';

comment on column public.integration_credentials.organization_id is
  'Organization/business that owns this integration credential.';;
