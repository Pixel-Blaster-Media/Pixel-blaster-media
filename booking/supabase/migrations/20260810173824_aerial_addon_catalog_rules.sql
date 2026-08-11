alter table public.catalog_items
  add column if not exists is_iguide boolean not null default false,
  add column if not exists is_aerial boolean not null default false,
  add column if not exists require_has_media boolean not null default false,
  add column if not exists exclude_has_aerial boolean not null default false;

comment on column public.catalog_items.is_iguide is
  'True when this catalog item includes iGUIDE, floor-plan, or measurement coverage.';
comment on column public.catalog_items.is_aerial is
  'True when this catalog item includes aerial/drone coverage.';
comment on column public.catalog_items.require_has_media is
  'For add-ons, require a selected non-add-on with photo, video, or iGUIDE coverage.';
comment on column public.catalog_items.exclude_has_aerial is
  'For add-ons, hide and reject the item when a selected non-add-on already includes aerial coverage.';

alter table public.catalog_items
  add constraint catalog_item_addon_rules_only
  check (
    kind = 'addon'
    or (require_has_media = false and exclude_has_aerial = false)
  );

update public.catalog_items
set is_iguide = true
where slug in (
  'iguide_measurements',
  'blue_print',
  'social_media_special',
  'social_media_plus',
  'ultimate'
);

update public.catalog_items
set is_aerial = true
where slug in (
  'aerial_photography',
  'social_media_special',
  'social_media_plus',
  'ultimate'
);

insert into public.catalog_items (
  organization_id,
  kind,
  slug,
  name,
  description,
  duration_minutes,
  price_cents,
  taxable,
  active,
  display_order,
  is_aerial,
  require_has_media,
  exclude_has_aerial,
  badge,
  highlight,
  ideal_for
)
values (
  '00000000-0000-0000-0000-000000000001',
  'addon',
  'aerial_add_on',
  'Aerial Add-on',
  'Add aerial stills to a photo, iGUIDE, or video booking when aerial coverage is not already included.',
  30,
  10000,
  true,
  true,
  20,
  true,
  true,
  true,
  'Popular add-on',
  true,
  'Listings that benefit from exterior, lot, or neighbourhood context.'
)
on conflict (organization_id, slug) do update
set
  kind = excluded.kind,
  name = excluded.name,
  description = excluded.description,
  duration_minutes = excluded.duration_minutes,
  price_cents = excluded.price_cents,
  taxable = excluded.taxable,
  active = excluded.active,
  display_order = excluded.display_order,
  is_photo = false,
  is_video = false,
  is_iguide = false,
  is_aerial = excluded.is_aerial,
  require_has_video = false,
  require_has_media = excluded.require_has_media,
  exclude_has_aerial = excluded.exclude_has_aerial,
  badge = excluded.badge,
  highlight = excluded.highlight,
  ideal_for = excluded.ideal_for,
  updated_at = now();

-- Keep the original atomic booking implementation intact and put the new
-- capability checks in a small wrapper. This also preserves the original
-- replay behavior for an already-committed request id.
alter function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) rename to create_public_booking_with_jobs_catalog_v1;

create function public.create_public_booking_with_jobs(
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
  has_aerial boolean := false;
begin
  if not exists (
    select 1
    from public.bookings booking
    where booking.organization_id = p_organization_id
      and booking.public_request_id = p_request_id
  ) then
    select
      coalesce(pg_catalog.bool_or(catalog.is_video), false),
      coalesce(
        pg_catalog.bool_or(
          catalog.is_photo or catalog.is_video or catalog.is_iguide
        ),
        false
      ),
      coalesce(pg_catalog.bool_or(catalog.is_aerial), false)
    into has_video, has_media, has_aerial
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
          or (addon.exclude_has_aerial and has_aerial)
        )
    ) then
      raise exception 'Selected add-on is not eligible for these services'
        using errcode = 'PB002';
    end if;
  end if;

  return public.create_public_booking_with_jobs_catalog_v1(
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
end;
$$;

revoke all on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) to service_role;

revoke all on function public.create_public_booking_with_jobs_catalog_v1(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.create_public_booking_with_jobs_catalog_v1(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) to service_role;

comment on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) is
  'Validates tenant catalog and add-on capability rules before delegating to the atomic booking and integration-outbox transaction.';
;
