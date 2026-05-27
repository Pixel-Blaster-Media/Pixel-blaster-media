-- ============================================================================
-- AI operator guardrails
-- ----------------------------------------------------------------------------
-- Before Telegram/AI can safely act on bookings, the app needs:
--   - transactional booking acceptance for the core request -> booking write
--   - explicit notification delivery state
--   - a secure Telegram identity mapping table
-- Existing assistant_action_logs already records approved assistant actions.
-- ============================================================================

alter table public.booking_notifications
  add column if not exists status text not null default 'sent',
  add column if not exists provider_message_id text,
  add column if not exists error text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.booking_notifications
  drop constraint if exists booking_notifications_status_check;

alter table public.booking_notifications
  add constraint booking_notifications_status_check
  check (status in ('sent', 'skipped', 'failed'));

create index if not exists booking_notifications_status_idx
  on public.booking_notifications(status, sent_at desc);

create table if not exists public.telegram_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  profile_id uuid not null
    references public.profiles(id) on delete cascade,
  telegram_chat_id bigint,
  telegram_user_id bigint,
  username text,
  first_name text,
  last_name text,
  connect_token_hash text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists telegram_connections_active_profile_idx
  on public.telegram_connections(organization_id, profile_id)
  where revoked_at is null;

create unique index if not exists telegram_connections_active_chat_idx
  on public.telegram_connections(telegram_chat_id)
  where telegram_chat_id is not null and revoked_at is null;

create index if not exists telegram_connections_org_idx
  on public.telegram_connections(organization_id, connected_at desc);

drop trigger if exists telegram_connections_set_updated_at
  on public.telegram_connections;
create trigger telegram_connections_set_updated_at
  before update on public.telegram_connections
  for each row execute function public.set_updated_at();

alter table public.telegram_connections enable row level security;

grant select, insert, update, delete on public.telegram_connections to authenticated;

drop policy if exists "telegram_connections: owner read"
  on public.telegram_connections;
drop policy if exists "telegram_connections: org admin all"
  on public.telegram_connections;

create policy "telegram_connections: owner read"
  on public.telegram_connections for select
  using (
    profile_id = auth.uid()
    or public.is_organization_admin(organization_id)
  );

create policy "telegram_connections: org admin all"
  on public.telegram_connections for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

create or replace function public.create_booking_from_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_owner_id uuid,
  p_scheduled_at timestamptz,
  p_scheduled_ends_at timestamptz
)
returns uuid
language plpgsql
as $$
declare
  req public.booking_requests%rowtype;
  new_property_id uuid;
  new_booking_id uuid;
begin
  select *
    into req
    from public.booking_requests
    where id = p_request_id
      and organization_id = p_organization_id
    for update;

  if not found then
    raise exception 'Booking request not found'
      using errcode = 'P0002';
  end if;

  if req.status = 'accepted' then
    raise exception 'Booking request already accepted'
      using errcode = 'P0001';
  end if;

  update public.profiles
    set organization_id = p_organization_id,
        full_name = req.contact_name,
        phone = req.contact_phone,
        brokerage = req.brokerage
    where id = p_owner_id;

  insert into public.properties (
    organization_id,
    owner_id,
    street_address,
    city,
    province,
    postal_code
  ) values (
    p_organization_id,
    p_owner_id,
    req.street_address,
    req.city,
    coalesce(req.province, 'ON'),
    req.postal_code
  )
  returning id into new_property_id;

  insert into public.bookings (
    organization_id,
    property_id,
    owner_id,
    status,
    scheduled_at,
    scheduled_ends_at,
    services,
    add_ons,
    square_footage,
    client_notes
  ) values (
    p_organization_id,
    new_property_id,
    p_owner_id,
    'confirmed',
    p_scheduled_at,
    p_scheduled_ends_at,
    req.services,
    req.add_ons,
    req.square_footage,
    req.notes
  )
  returning id into new_booking_id;

  update public.booking_requests
    set status = 'accepted',
        booking_id = new_booking_id
    where id = p_request_id
      and organization_id = p_organization_id;

  return new_booking_id;
end;
$$;

revoke all on function public.create_booking_from_request(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.create_booking_from_request(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
) to service_role;

comment on table public.telegram_connections is
  'Tenant-scoped mapping between a photographer profile and their Telegram chat.';

comment on function public.create_booking_from_request(uuid, uuid, uuid, timestamptz, timestamptz) is
  'Atomically promotes a booking_request into property + confirmed booking + accepted request link.';
