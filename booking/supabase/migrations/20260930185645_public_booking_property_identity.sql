-- Match the complete supplied property identity for NEW bookings.
-- No historical property/bookings are relinked or deduplicated. Keep catalog
-- wrappers, request replays, pricing/duration, and creation jobs unchanged.
-- Retain the broader street/owner advisory key shared with admin booking writes.
create or replace function public.create_public_booking_with_jobs_catalog_v1(
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
  existing_booking record;
  has_existing_booking boolean := false;
  new_property_id uuid;
  new_booking_id uuid;
  scheduled_ends_at timestamptz;
  total_duration_minutes integer;
  service_slugs text[];
  add_on_slugs text[];
  has_video boolean;
  request_fingerprint text;
  invoice_timing text;
  job_payload jsonb;
begin
  if p_request_id is null or p_organization_id is null or p_owner_id is null then
    raise exception 'Required public booking identity is missing'
      using errcode = 'PB003';
  end if;

  -- Resolve the durable request identity before mutable catalog and schedule
  -- validation. Active tenant membership is still required before returning a
  -- committed replay, and the normalized fingerprint rejects changed input.
  request_fingerprint := pg_catalog.md5(pg_catalog.concat_ws(
    E'\x1f',
    p_owner_id::text,
    pg_catalog.lower(pg_catalog.btrim(p_street_address)),
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_city, ''))),
    pg_catalog.upper(pg_catalog.btrim(coalesce(p_postal_code, ''))),
    pg_catalog.btrim(coalesce(p_unit_number, '')),
    coalesce(p_scheduled_at::text, ''),
    coalesce(p_square_footage::text, ''),
    coalesce(p_is_vacant, ''),
    coalesce(p_include_basement::text, ''),
    coalesce(p_client_notes, ''),
    coalesce((
      select pg_catalog.string_agg(item_id::text, ',' order by item_id)
      from pg_catalog.unnest(coalesce(p_service_item_ids, '{}'::uuid[])) item_id
    ), ''),
    coalesce((
      select pg_catalog.string_agg(item_id::text, ',' order by item_id)
      from pg_catalog.unnest(coalesce(p_add_on_item_ids, '{}'::uuid[])) item_id
    ), '')
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'public-booking-request:' || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  select b.id, b.property_id, b.scheduled_ends_at, b.public_request_fingerprint
    into existing_booking
  from public.bookings b
  where b.organization_id = p_organization_id
    and b.public_request_id = p_request_id
  limit 1;

  has_existing_booking := found;

  -- Service-role invocation is not authority by itself. Only an active realtor
  -- with an ordinary member relationship in this exact tenant may own a public
  -- booking. Company owner/admin identities remain forbidden booking owners.
  perform 1
  from public.profiles p
  join public.organization_members om
    on om.profile_id = p.id
   and om.organization_id = p.organization_id
  where p.id = p_owner_id
    and p.organization_id = p_organization_id
    and p.role = 'realtor'
    and p.archived_at is null
    and om.organization_id = p_organization_id
    and om.role = 'member'
  for update of p;

  if not found then
    raise exception 'Active tenant realtor membership required'
      using errcode = 'PB001';
  end if;

  if has_existing_booking then
    if existing_booking.public_request_fingerprint is distinct from request_fingerprint then
      raise exception 'Public booking request was already used with different data'
        using errcode = 'PB004';
    end if;
    return pg_catalog.jsonb_build_object(
      'booking_id', existing_booking.id,
      'property_id', existing_booking.property_id,
      'scheduled_ends_at', existing_booking.scheduled_ends_at,
      'replayed', true
    );
  end if;

  if nullif(pg_catalog.btrim(p_street_address), '') is null
     or p_scheduled_at is null
     or p_scheduled_at <= pg_catalog.now()
     or p_square_footage is not null and p_square_footage < 0
     or p_is_vacant is not null
        and p_is_vacant not in ('vacant', 'occupied', 'partial') then
    raise exception 'Malformed public booking input'
      using errcode = 'PB003';
  end if;

  if pg_catalog.cardinality(coalesce(p_service_item_ids, '{}'::uuid[])) = 0
     or (
       select pg_catalog.count(distinct item_id)
       from pg_catalog.unnest(coalesce(p_service_item_ids, '{}'::uuid[])) item_id
     ) <> pg_catalog.cardinality(coalesce(p_service_item_ids, '{}'::uuid[]))
     or (
       select pg_catalog.count(distinct item_id)
       from pg_catalog.unnest(coalesce(p_add_on_item_ids, '{}'::uuid[])) item_id
     ) <> pg_catalog.cardinality(coalesce(p_add_on_item_ids, '{}'::uuid[]))
     or exists (
       select 1
       from pg_catalog.unnest(coalesce(p_service_item_ids, '{}'::uuid[])) item_id
       left join public.catalog_items catalog
         on catalog.id = item_id
        and catalog.organization_id = p_organization_id
        and catalog.active = true
        and catalog.kind in ('bundle', 'a_la_carte')
       where catalog.id is null
     )
     or exists (
       select 1
       from pg_catalog.unnest(coalesce(p_add_on_item_ids, '{}'::uuid[])) item_id
       left join public.catalog_items catalog
         on catalog.id = item_id
        and catalog.organization_id = p_organization_id
        and catalog.active = true
        and catalog.kind = 'addon'
       where catalog.id is null
     )
     or exists (
       select 1
       from pg_catalog.unnest(coalesce(p_service_item_ids, '{}'::uuid[])) item_id
       where item_id = any(coalesce(p_add_on_item_ids, '{}'::uuid[]))
     )
     or (
       select pg_catalog.count(*)
       from public.catalog_items catalog
       where catalog.id = any(coalesce(p_service_item_ids, '{}'::uuid[]))
         and catalog.organization_id = p_organization_id
         and catalog.active = true
         and catalog.kind = 'bundle'
     ) > 1 then
    raise exception 'Invalid tenant catalog selection'
      using errcode = 'PB002';
  end if;

  select coalesce(pg_catalog.bool_or(catalog.is_video), false)
    into has_video
  from public.catalog_items catalog
  where catalog.id = any(p_service_item_ids)
    and catalog.organization_id = p_organization_id
    and catalog.active = true;

  if not has_video and exists (
    select 1
    from public.catalog_items catalog
    where catalog.id = any(coalesce(p_add_on_item_ids, '{}'::uuid[]))
      and catalog.organization_id = p_organization_id
      and catalog.active = true
      and catalog.require_has_video = true
  ) then
    raise exception 'Selected add-on requires a video service'
      using errcode = 'PB002';
  end if;

  select pg_catalog.array_agg(
    catalog.slug order by pg_catalog.array_position(p_service_item_ids, catalog.id)
  )
  into service_slugs
  from public.catalog_items catalog
  where catalog.id = any(p_service_item_ids)
    and catalog.organization_id = p_organization_id
    and catalog.active = true;

  select greatest(coalesce(pg_catalog.sum(catalog.duration_minutes), 0), 60)
  into total_duration_minutes
  from public.catalog_items catalog
  where catalog.id = any(
      p_service_item_ids || coalesce(p_add_on_item_ids, '{}'::uuid[])
    )
    and catalog.organization_id = p_organization_id
    and catalog.active = true;

  select coalesce(
    pg_catalog.array_agg(
      catalog.slug order by pg_catalog.array_position(p_add_on_item_ids, catalog.id)
    ),
    '{}'::text[]
  )
  into add_on_slugs
  from public.catalog_items catalog
  where catalog.id = any(coalesce(p_add_on_item_ids, '{}'::uuid[]))
    and catalog.organization_id = p_organization_id
    and catalog.active = true;

  scheduled_ends_at := p_scheduled_at
    + pg_catalog.make_interval(mins => total_duration_minutes);

  -- Serialize normalized property reuse without imposing a risky unique index on
  -- historical address data.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_owner_id::text || ':' ||
      pg_catalog.lower(pg_catalog.btrim(p_street_address)),
      1
    )
  );

  select property.id
    into new_property_id
  from public.properties property
  where property.organization_id = p_organization_id
    and property.owner_id = p_owner_id
    and pg_catalog.lower(pg_catalog.btrim(property.street_address)) =
        pg_catalog.lower(pg_catalog.btrim(p_street_address))
    and pg_catalog.lower(pg_catalog.btrim(coalesce(property.city, ''))) =
        pg_catalog.lower(pg_catalog.btrim(coalesce(p_city, '')))
    and pg_catalog.upper(pg_catalog.regexp_replace(coalesce(property.postal_code, ''), '\s', '', 'g')) =
        pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_postal_code, ''), '\s', '', 'g'))
  order by property.created_at asc, property.id asc
  limit 1
  for update;

  if new_property_id is null then
    insert into public.properties (
      organization_id,
      owner_id,
      street_address,
      city,
      postal_code
    ) values (
      p_organization_id,
      p_owner_id,
      pg_catalog.btrim(p_street_address),
      nullif(pg_catalog.btrim(p_city), ''),
      nullif(pg_catalog.btrim(p_postal_code), '')
    )
    returning id into new_property_id;
  end if;

  insert into public.bookings (
    organization_id,
    property_id,
    owner_id,
    public_request_id,
    public_request_fingerprint,
    status,
    scheduled_at,
    scheduled_ends_at,
    allow_schedule_overlap,
    services,
    add_ons,
    client_notes,
    unit_number,
    square_footage,
    is_vacant,
    include_basement
  ) values (
    p_organization_id,
    new_property_id,
    p_owner_id,
    p_request_id,
    request_fingerprint,
    'confirmed',
    p_scheduled_at,
    scheduled_ends_at,
    false,
    service_slugs,
    add_on_slugs,
    nullif(p_client_notes, ''),
    nullif(pg_catalog.btrim(p_unit_number), ''),
    p_square_footage,
    p_is_vacant,
    p_include_basement
  )
  returning id into new_booking_id;

  insert into public.booking_line_items (
    booking_id,
    catalog_item_id,
    item_name,
    item_slug,
    item_kind,
    quantity,
    unit_price_cents,
    unit_duration_minutes
  )
  select
    new_booking_id,
    catalog.id,
    catalog.name,
    catalog.slug,
    catalog.kind::text,
    1,
    catalog.price_cents + case
      when catalog.sqft_pricing_enabled
       and catalog.included_sqft is not null
       and catalog.included_sqft > 0
       and catalog.overage_increment_sqft is not null
       and catalog.overage_increment_sqft > 0
       and catalog.overage_price_cents is not null
       and catalog.overage_price_cents > 0
       and p_square_footage is not null
       and p_square_footage > catalog.included_sqft
      then pg_catalog.ceil(
        (p_square_footage - catalog.included_sqft)::numeric
        / catalog.overage_increment_sqft
      )::integer * catalog.overage_price_cents
      else 0
    end,
    catalog.duration_minutes
  from public.catalog_items catalog
  where catalog.organization_id = p_organization_id
    and catalog.active = true
    and catalog.id = any(
      p_service_item_ids || coalesce(p_add_on_item_ids, '{}'::uuid[])
    );

  if (select pg_catalog.count(*)
      from public.booking_line_items line
      where line.booking_id = new_booking_id)
      <> pg_catalog.cardinality(
        p_service_item_ids || coalesce(p_add_on_item_ids, '{}'::uuid[])
      ) then
    raise exception 'Booking line item snapshot count mismatch'
      using errcode = 'PB002';
  end if;

  select
    organization.invoice_timing,
    pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'booking_id', new_booking_id,
      'organization_id', p_organization_id,
      'public_request_id', p_request_id,
      'app_url', coalesce(nullif(pg_catalog.btrim(p_app_url), ''), ''),
      'organization', pg_catalog.jsonb_build_object(
        'name', organization.name,
        'from_name', coalesce(nullif(organization.email_from_name, ''), organization.name),
        'reply_to_email', coalesce(
          nullif(organization.reply_to_email, ''),
          nullif(organization.admin_notification_email, ''),
          nullif(pg_catalog.btrim(p_admin_notification_email), '')
        ),
        'admin_notification_email', coalesce(
          nullif(organization.admin_notification_email, ''),
          nullif(pg_catalog.btrim(p_admin_notification_email), '')
        )
      ),
      'realtor', pg_catalog.jsonb_build_object(
        'id', profile.id,
        'email', profile.email,
        'full_name', coalesce(nullif(profile.full_name, ''), profile.email),
        'phone', profile.phone,
        'brokerage', profile.brokerage,
        'delivery_cc_emails', coalesce(profile.delivery_cc_emails, '{}'::text[])
      ),
      'property', pg_catalog.jsonb_build_object(
        'street_address', p_street_address,
        'city', nullif(p_city, ''),
        'postal_code', nullif(p_postal_code, ''),
        'unit_number', nullif(pg_catalog.btrim(p_unit_number), '')
      ),
      'booking', pg_catalog.jsonb_build_object(
        'scheduled_at', p_scheduled_at,
        'scheduled_ends_at', scheduled_ends_at,
        'square_footage', p_square_footage,
        'is_vacant', p_is_vacant,
        'include_basement', p_include_basement,
        'client_notes', coalesce(p_client_notes, '')
      ),
      'line_items', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'catalog_item_id', line.catalog_item_id,
            'name', line.item_name,
            'slug', line.item_slug,
            'kind', line.item_kind,
            'quantity', line.quantity,
            'unit_price_cents', line.unit_price_cents,
            'unit_duration_minutes', line.unit_duration_minutes
          ) order by
            case
              when line.item_kind = 'addon' then
                pg_catalog.cardinality(p_service_item_ids)
                + pg_catalog.array_position(p_add_on_item_ids, line.catalog_item_id)
              else pg_catalog.array_position(p_service_item_ids, line.catalog_item_id)
            end
        )
        from public.booking_line_items line
        where line.booking_id = new_booking_id
      ), '[]'::jsonb)
    )
    into invoice_timing, job_payload
  from public.organizations organization
  join public.profiles profile
    on profile.id = p_owner_id
   and profile.organization_id = organization.id
  where organization.id = p_organization_id;

  if job_payload is null then
    raise exception 'Unable to derive immutable integration payload'
      using errcode = 'PB001';
  end if;

  insert into public.integration_jobs (
    organization_id,
    booking_id,
    job_type,
    idempotency_key,
    payload
  )
  select
    p_organization_id,
    new_booking_id,
    job.job_type,
    'booking:' || new_booking_id::text || ':' || job.job_type || ':v1',
    job_payload
  from (
    values
      ('quickbooks.invoice.create'::text),
      ('google_calendar.event.create'::text),
      ('email.booking.confirmation'::text),
      ('email.admin.new_booking'::text),
      ('push.admin.new_booking'::text)
  ) as job(job_type)
  where job.job_type <> 'quickbooks.invoice.create'
     or invoice_timing = 'at_booking';

  return pg_catalog.jsonb_build_object(
    'booking_id', new_booking_id,
    'property_id', new_property_id,
    'scheduled_ends_at', scheduled_ends_at,
    'replayed', false
  );
end;
$$;

revoke all on function public.create_public_booking_with_jobs_catalog_v1(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.create_public_booking_with_jobs_catalog_v1(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) to service_role;
