-- Install BEFORE price/duration activation. Old app instances and old browser
-- submissions fail closed for new bookings; committed request replays survive.
-- The versioned entry remains paused until the policy migration finishes.
create function public.current_booking_quote_policy()
returns text language sql stable security invoker set search_path = '' as $$ select 'paused'::text $$;
revoke all on function public.current_booking_quote_policy() from public,anon,authenticated;
grant execute on function public.current_booking_quote_policy() to service_role;

create function public.create_public_booking_with_jobs_v2(
  p_quote_policy_version text,
  p_request_id uuid,
  p_organization_id uuid,
  p_owner_id uuid,
  p_street_address text,
  p_city text,
  p_postal_code text,
  p_unit_number text,
  p_scheduled_at timestamptz,
  p_square_footage integer,
  p_is_vacant text,
  p_include_basement boolean,
  p_client_notes text,
  p_service_item_ids uuid[],
  p_add_on_item_ids uuid[],
  p_admin_notification_email text default null,
  p_app_url text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  has_video boolean := false;
  has_media boolean := false;
  has_iguide boolean := false;
  has_aerial boolean := false;
  previous_quote_policy text;
  booking_result jsonb;
begin
  if not exists (
    select 1
    from public.bookings booking
    where booking.organization_id = p_organization_id
      and booking.public_request_id = p_request_id
  ) then
    if p_quote_policy_version is distinct from '2026-09-30-v1'
       or public.current_booking_quote_policy() is distinct from p_quote_policy_version then
      raise exception 'Booking quote changed; refresh and review before confirming' using errcode = 'PB005';
    end if;
    select
      coalesce(pg_catalog.bool_or(catalog.is_video), false),
      coalesce(
        pg_catalog.bool_or(
          catalog.is_photo or catalog.is_video or catalog.is_iguide
        ),
        false
      ),
      coalesce(pg_catalog.bool_or(catalog.is_iguide), false),
      coalesce(pg_catalog.bool_or(catalog.is_aerial), false)
    into has_video, has_media, has_iguide, has_aerial
    from public.catalog_items catalog
    where catalog.id = any(coalesce(p_service_item_ids, '{}'::uuid[]))
      and catalog.organization_id = p_organization_id
      and catalog.active = true
      and catalog.kind in ('bundle', 'a_la_carte');

    if exists (
      select 1
      from public.catalog_items addon
      where addon.id = any(coalesce(p_add_on_item_ids, '{}'::uuid[]))
        and addon.organization_id = p_organization_id
        and addon.active = true
        and addon.kind = 'addon'
        and (
          (addon.require_has_video and not has_video)
          or (addon.require_has_media and not has_media)
          or (addon.require_has_iguide and not has_iguide)
          or (addon.exclude_has_aerial and has_aerial)
        )
    ) then
      raise exception 'Selected add-on is not eligible for these services'
        using errcode = 'PB002';
    end if;
  end if;

  -- The final core also checks this transaction-local call context. That closes
  -- the narrow race where an already-running old wrapper reaches the new core
  -- after activation. This is compatibility context, not authorization; tenant
  -- membership and the immutable request fingerprint are still checked inside.
  previous_quote_policy := pg_catalog.current_setting('pixel_booking.quote_policy', true);
  perform pg_catalog.set_config('pixel_booking.quote_policy', coalesce(p_quote_policy_version, ''), true);
  begin
  booking_result := public.create_public_booking_with_jobs_catalog_v1(
    p_request_id,
    p_organization_id,
    p_owner_id,
    p_street_address,
    p_city,
    p_postal_code,
    p_unit_number,
    p_scheduled_at,
    p_square_footage,
    p_is_vacant,
    p_include_basement,
    p_client_notes,
    p_service_item_ids,
    p_add_on_item_ids,
    p_admin_notification_email,
    p_app_url
  );
  exception when others then
    perform pg_catalog.set_config('pixel_booking.quote_policy', coalesce(previous_quote_policy, ''), true);
    raise;
  end;
  perform pg_catalog.set_config('pixel_booking.quote_policy', coalesce(previous_quote_policy, ''), true);
  return booking_result;
end;
$$;

create or replace function public.create_public_booking_with_jobs(
  p_request_id uuid,
  p_organization_id uuid,
  p_owner_id uuid,
  p_street_address text,
  p_city text,
  p_postal_code text,
  p_unit_number text,
  p_scheduled_at timestamptz,
  p_square_footage integer,
  p_is_vacant text,
  p_include_basement boolean,
  p_client_notes text,
  p_service_item_ids uuid[],
  p_add_on_item_ids uuid[],
  p_admin_notification_email text default null,
  p_app_url text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.bookings where organization_id = p_organization_id and public_request_id = p_request_id) then
    raise exception 'Booking quote changed; refresh and review before confirming' using errcode = 'PB005';
  end if;
  return public.create_public_booking_with_jobs_v2(null, p_request_id, p_organization_id, p_owner_id, p_street_address, p_city, p_postal_code, p_unit_number, p_scheduled_at, p_square_footage, p_is_vacant, p_include_basement, p_client_notes, p_service_item_ids, p_add_on_item_ids, p_admin_notification_email, p_app_url);
end;
$$;

revoke all on function public.create_public_booking_with_jobs_v2(text,uuid,uuid,uuid,text,text,text,text,timestamptz,integer,text,boolean,text,uuid[],uuid[],text,text) from public,anon,authenticated;
grant execute on function public.create_public_booking_with_jobs_v2(text,uuid,uuid,uuid,text,text,text,text,timestamptz,integer,text,boolean,text,uuid[],uuid[],text,text) to service_role;
revoke all on function public.create_public_booking_with_jobs(uuid,uuid,uuid,text,text,text,text,timestamptz,integer,text,boolean,text,uuid[],uuid[],text,text) from public,anon,authenticated;
grant execute on function public.create_public_booking_with_jobs(uuid,uuid,uuid,text,text,text,text,timestamptz,integer,text,boolean,text,uuid[],uuid[],text,text) to service_role;

-- Pause admin aggregate writes in the schema-expansion window as well. The
-- subsequent policy migration replaces this wrapper with guarded final logic.
-- Existing committed request replays still execute their original checks.
alter function public.save_admin_booking_aggregate(uuid,uuid,uuid,uuid,bigint,jsonb)
  rename to save_admin_booking_aggregate_pre_policy;
create function public.save_admin_booking_aggregate(p_organization_id uuid,p_actor_id uuid,p_request_id uuid,p_booking_id uuid,p_expected_version bigint,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare stored_input jsonb;
begin
  select input->'input' into stored_input from public.admin_booking_requests
    where organization_id=p_organization_id and request_id=p_request_id;
  if not found then
    raise exception 'Booking quotes are updating; refresh and review before saving' using errcode='PB005';
  end if;
  -- Quote consent metadata is not business identity. Match the historical
  -- representation for the old core without changing its stored fingerprint.
  p_input := p_input - 'quote_policy_version';
  if stored_input ? 'quote_policy_version' then
    p_input := p_input || jsonb_build_object('quote_policy_version',stored_input->'quote_policy_version');
  end if;
  return public.save_admin_booking_aggregate_pre_policy(p_organization_id,p_actor_id,p_request_id,p_booking_id,p_expected_version,p_input);
end;
$$;
revoke all on function public.save_admin_booking_aggregate(uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_admin_booking_aggregate(uuid,uuid,uuid,uuid,bigint,jsonb) to service_role;
