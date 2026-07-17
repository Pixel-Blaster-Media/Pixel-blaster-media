-- Close generic Supabase Auth signup at the database boundary and make realtor
-- provisioning explicitly tenant-bound. Existing legitimate realtors are marked
-- only when they have booking provenance; any ambiguous historical profile aborts
-- this migration for manual review instead of being guessed or deleted.

-- Historical booking-created realtors predate the trusted app_metadata marker.
-- A booking owned by the profile is durable evidence that the account was used in
-- the realtor workflow. Keep the profile organization as the trusted tenant.
do $$
declare
  mismatch_count integer;
begin
  select count(*)
  into mismatch_count
  from public.bookings b
  join public.profiles p on p.id = b.owner_id
  where b.organization_id is distinct from p.organization_id;

  if mismatch_count > 0 then
    raise exception 'cross-tenant booking owner/profile mismatch(es) remain: %', mismatch_count
      using errcode = 'P0001',
            hint = 'Reconcile booking and profile organizations before applying this migration.';
  end if;
end;
$$;

update auth.users u
set raw_app_meta_data =
  coalesce(u.raw_app_meta_data, '{}'::jsonb) ||
  jsonb_build_object('realtor_organization_id', p.organization_id::text)
from public.profiles p
where p.id = u.id
  and p.role = 'realtor'
  and not (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'realtor_organization_id')
  and exists (
    select 1
    from public.bookings b
    where b.owner_id = p.id
      and b.organization_id = p.organization_id
  );

-- Fail closed if a realtor profile still lacks reviewed provenance. Operations
-- must remove an unauthorized profile and its memberships or set a reviewed
-- matching marker before retrying. Never auto-classify an account with no booking.
do $$
declare
  unreviewed_count integer;
  marker record;
  parsed_organization_id uuid;
begin
  for marker in
    select
      p.id,
      p.organization_id,
      u.raw_app_meta_data ->> 'realtor_organization_id' as marker_value
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'realtor'
      and coalesce(u.raw_app_meta_data, '{}'::jsonb) ?
        'realtor_organization_id'
  loop
    begin
      parsed_organization_id := marker.marker_value::uuid;
    exception
      when invalid_text_representation then
        raise exception 'realtor % has malformed organization provenance', marker.id
          using errcode = '22023';
    end;

    if parsed_organization_id is distinct from marker.organization_id then
      raise exception 'realtor % provenance does not match profile organization', marker.id
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1
      from public.organizations o
      where o.id = parsed_organization_id
    ) then
      raise exception 'realtor % provenance references a missing organization', marker.id
        using errcode = '23503';
    end if;
  end loop;

  select count(*)
  into unreviewed_count
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'realtor'
    and not (
      coalesce(u.raw_app_meta_data, '{}'::jsonb) ?
      'realtor_organization_id'
    );

  if unreviewed_count > 0 then
    raise exception 'unreviewed realtor profile(s) remain: %', unreviewed_count
      using errcode = 'P0001',
            hint = 'Review each unmarked realtor before applying this migration.';
  end if;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  realtor_organization_id uuid;
begin
  -- Owner invitations intentionally remain profile-less until their token is
  -- claimed atomically by the invitation workflow.
  if new.raw_app_meta_data ? 'company_invitation_id' then
    return new;
  end if;

  -- raw_app_meta_data is controlled by Supabase admin/service-role operations.
  -- Rejecting here rolls back the auth.users insert, so direct anon signup/OAuth
  -- cannot reserve an email or create an unassigned Auth identity.
  if not (new.raw_app_meta_data ? 'realtor_organization_id') then
    raise exception 'public signup is disabled; trusted provisioning marker required'
      using errcode = '42501';
  end if;

  begin
    realtor_organization_id :=
      nullif(new.raw_app_meta_data ->> 'realtor_organization_id', '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'invalid realtor organization marker'
        using errcode = '22023';
  end;

  if realtor_organization_id is null or not exists (
    select 1
    from public.organizations o
    where o.id = realtor_organization_id
  ) then
    raise exception 'realtor organization does not exist'
      using errcode = '23503';
  end if;

  insert into public.profiles (
    id,
    email,
    full_name,
    organization_id,
    role
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    realtor_organization_id,
    'realtor'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;

-- The service-only request-acceptance RPC must not move or reactivate an Auth
-- identity. Its owner must already be an active realtor in the requested tenant.
create or replace function public.create_booking_from_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_owner_id uuid,
  p_scheduled_at timestamptz,
  p_scheduled_ends_at timestamptz
)
returns uuid
language plpgsql
set search_path = ''
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

  perform 1
  from public.profiles p
  where p.id = p_owner_id
    and p.organization_id = p_organization_id
    and p.role = 'realtor'
    and p.archived_at is null
  for update;

  if not found then
    raise exception 'booking owner is not an active realtor in this organization'
      using errcode = '42501';
  end if;

  update public.profiles
    set full_name = req.contact_name,
        phone = req.contact_phone,
        brokerage = req.brokerage
    where id = p_owner_id
      and organization_id = p_organization_id;

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

create table if not exists public.auth_recovery_grants (
  jti_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.auth_recovery_grants enable row level security;
revoke all on table public.auth_recovery_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_recovery_grants to service_role;

create or replace function public.consume_auth_recovery_grant(
  p_jti_hash text,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.auth_recovery_grants
  set consumed_at = now()
  where jti_hash = p_jti_hash
    and user_id = p_user_id
    and consumed_at is null
    and expires_at > now();
  return found;
end;
$$;

revoke all on function public.consume_auth_recovery_grant(text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_auth_recovery_grant(text, uuid)
  to service_role;

create table if not exists public.provisioning_cleanup_events (
  id uuid primary key,
  auth_user_id uuid,
  provisioning_id uuid,
  property_id uuid,
  status text not null check (status in ('quarantined', 'retained', 'failed')),
  context text not null,
  detail text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.provisioning_cleanup_events enable row level security;
revoke all on table public.provisioning_cleanup_events from public, anon, authenticated;
grant select, insert, update on table public.provisioning_cleanup_events to service_role;

create or replace function public.find_realtor_provisioning_auth_user(
  p_provisioning_id uuid,
  p_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_ids uuid[];
begin
  select array_agg(u.id order by u.created_at)
  into matched_ids
  from auth.users u
  where u.raw_app_meta_data ->> 'realtor_provisioning_id' = p_provisioning_id::text
    and u.raw_app_meta_data ->> 'realtor_organization_id' = p_organization_id::text;

  if coalesce(array_length(matched_ids, 1), 0) > 1 then
    raise exception 'Provisioning marker is not unique.';
  end if;
  return matched_ids[1];
end;
$$;

revoke all on function public.find_realtor_provisioning_auth_user(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.find_realtor_provisioning_auth_user(uuid, uuid)
  to service_role;

create or replace function public.bootstrap_first_company_owner(
  p_invitation_id uuid,
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_company_name text,
  p_company_slug text,
  p_primary_color text,
  p_accent_color text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_organization_id constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  perform pg_advisory_xact_lock(hashtext('pixel-blaster-first-company-bootstrap'));

  if exists (select 1 from public.profiles)
     or exists (
       select 1 from public.organization_members where role in ('owner', 'admin')
     ) then
    raise exception 'first company already bootstrapped';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id
      and lower(u.email) = lower(p_email)
      and u.raw_app_meta_data ->> 'company_invitation_id' = p_invitation_id::text
  ) then
    raise exception 'bootstrap identity mismatch';
  end if;

  insert into public.profiles (
    id, organization_id, email, full_name, role
  ) values (
    p_user_id, default_organization_id, lower(p_email), p_full_name, 'admin'
  );

  insert into public.organization_members (
    organization_id, profile_id, role
  ) values (
    default_organization_id, p_user_id, 'owner'
  );

  update public.organizations
  set name = p_company_name,
      slug = p_company_slug,
      primary_color = p_primary_color,
      accent_color = p_accent_color
  where id = default_organization_id;

  if not found then
    raise exception 'default organization missing';
  end if;
end;
$$;

revoke all on function public.bootstrap_first_company_owner(
  uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.bootstrap_first_company_owner(
  uuid, uuid, text, text, text, text, text, text
) to service_role;

-- Quarantine a synthetic realtor only when no successful or concurrent work
-- depends on that identity. FK checks keep a concurrent insert from racing the
-- profile deletion; any such race aborts this transaction instead of deleting
-- an identity that another request has committed.
create or replace function public.quarantine_unbooked_realtor(
  p_user_id uuid,
  p_property_id uuid,
  p_provisioning_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id
      and u.raw_app_meta_data ->> 'realtor_provisioning_id' = p_provisioning_id::text
  ) then
    return 'retained';
  end if;

  if exists (
    select 1 from public.bookings where owner_id = p_user_id
  ) or exists (
    select 1
    from public.organization_members
    where profile_id = p_user_id
      and role in ('owner', 'admin')
  ) then
    return 'retained';
  end if;

  if p_property_id is not null then
    delete from public.properties
    where id = p_property_id
      and owner_id = p_user_id
      and not exists (
        select 1 from public.bookings where property_id = p_property_id
      );
  end if;

  if exists (
    select 1 from public.properties where owner_id = p_user_id
  ) then
    return 'retained';
  end if;

  delete from public.organization_members
  where profile_id = p_user_id;

  delete from public.profiles
  where id = p_user_id
    and role = 'realtor';

  if found or not exists (
    select 1 from public.profiles where id = p_user_id
  ) then
    return 'quarantined';
  end if;

  return 'retained';
end;
$$;

revoke all on function public.quarantine_unbooked_realtor(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.quarantine_unbooked_realtor(uuid, uuid, uuid)
  to service_role;
