-- Approved policy for new Pixel Blaster quotes: one flat $50 fee per advertised
-- video package above 2,500 sq ft, plus 15 minutes ONCE for a finished basement.
-- No historical line prices, booking end times, or integration payloads are rewritten.
-- Other organizations keep disabled video fees; future template clones copy rules.

alter table public.catalog_items
  add column video_overage_threshold_sqft integer,
  add column video_overage_price_cents integer not null default 0,
  add constraint catalog_video_overage_threshold_positive check (video_overage_threshold_sqft is null or video_overage_threshold_sqft > 0),
  add constraint catalog_video_overage_price_valid check (video_overage_price_cents >= 0 and (video_overage_price_cents = 0 or video_overage_threshold_sqft is not null));

-- A snapshot distinguishes new booked basement time from historical inclusion
-- flags. Zero is intentional for all existing bookings; never backfill from flags.
alter table public.bookings
  add column basement_duration_minutes integer not null default 0
    check (basement_duration_minutes in (0, 15));
comment on column public.bookings.basement_duration_minutes is
  'Booked extra basement time. Snapshotted once for new bookings; historical rows remain zero.';

update public.catalog_items
set video_overage_threshold_sqft = 2500,
    video_overage_price_cents = 5000,
    description = replace(description, 'Houses over 3,000 sq ft: +$50 video overage.', 'Houses over 2,500 sq ft: +$50 video overage.'),
    updated_at = now()
where organization_id = '00000000-0000-0000-0000-000000000001'
  and is_video = true
  and slug in ('social_media_special', 'social_media_plus', 'ultimate', 'video_tour');

-- One price per catalog item. Bundled video components never create extra fees.
-- Keep in parity with lib/booking/quote.ts; only NEW line snapshots call this.
create function public.catalog_booking_price_cents(p_item public.catalog_items, p_square_footage integer)
returns integer language sql immutable security invoker set search_path = '' as $$
  select (p_item).price_cents + case
    when (p_item).sqft_pricing_enabled and (p_item).included_sqft > 0
      and (p_item).overage_increment_sqft > 0 and (p_item).overage_price_cents > 0
      and p_square_footage > (p_item).included_sqft
    then pg_catalog.ceil((p_square_footage-(p_item).included_sqft)::numeric / (p_item).overage_increment_sqft)::integer * (p_item).overage_price_cents
    else 0 end + case
    when (p_item).video_overage_threshold_sqft > 0 and (p_item).video_overage_price_cents > 0
      and p_square_footage > (p_item).video_overage_threshold_sqft
    then (p_item).video_overage_price_cents else 0 end;
$$;
revoke all on function public.catalog_booking_price_cents(public.catalog_items,integer) from public,anon,authenticated;
grant execute on function public.catalog_booking_price_cents(public.catalog_items,integer) to service_role;

-- Keep public wrapper/add-on eligibility, tenant isolation, property identity,
-- request replay and the atomic outbox unchanged around the new snapshots.
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

  -- An old wrapper already in flight must not enter this new-price core.
  -- Completed request replays returned above and retain their original terms.
  if pg_catalog.current_setting('pixel_booking.quote_policy', true) is distinct from '2026-09-30-v1'
     or public.current_booking_quote_policy() is distinct from '2026-09-30-v1' then
    raise exception 'Booking quote changed; refresh and review before confirming' using errcode = 'PB005';
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
    + case when p_include_basement is true then 15 else 0 end
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
    include_basement,
    basement_duration_minutes
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
    p_include_basement,
    case when p_include_basement is true then 15 else 0 end
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
    public.catalog_booking_price_cents(catalog, p_square_footage),
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

-- Admin new lines use the same price. Retained lines keep their original prices,
-- and retained selections keep their exact booked duration when moved/edited.
create or replace function public.save_admin_booking_aggregate(p_organization_id uuid,p_actor_id uuid,p_request_id uuid,p_booking_id uuid,p_expected_version bigint,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_owner uuid := (p_input->>'owner_id')::uuid;
  v_ids uuid[]; v_property uuid; v_booking uuid; v_start timestamptz := (p_input->>'scheduled_at')::timestamptz;
  v_sqft integer := (p_input->>'square_footage')::integer;
  v_basement_minutes integer := case when (p_input->>'include_basement')::boolean is true then 15 else 0 end;
  v_duration integer; v_services text[]; v_addons text[];
  v_old public.bookings%rowtype; v_request public.admin_booking_requests%rowtype;
  v_fingerprint jsonb; v_result jsonb; v_retained boolean := false; v_version bigint;
begin
  if not exists(select 1 from public.profiles p join public.organization_members m on m.profile_id=p.id and m.organization_id=p_organization_id where p.id=p_actor_id and p.organization_id=p_organization_id and p.archived_at is null and m.role in ('owner','admin'))
    or not exists(select 1 from public.profiles p where p.id=v_owner and p.organization_id=p_organization_id and p.role='realtor' and p.archived_at is null) then
    raise exception 'Not authorized' using errcode='PB001';
  end if;
  if p_request_id is null then raise exception 'Request key required' using errcode='PB002'; end if;
  select array_agg(value::uuid order by value::uuid) into v_ids from jsonb_array_elements_text(p_input->'catalog_item_ids');
  -- Consent version gates new quotes below; it must not invalidate an already
  -- committed business request. Normalize both sides without rewriting history.
  v_fingerprint := jsonb_build_object('booking',p_booking_id,'version',p_expected_version,'input',(p_input - 'quote_policy_version') || jsonb_build_object('catalog_item_ids',to_jsonb(v_ids)));
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_request_id::text,2));
  select * into v_request from public.admin_booking_requests where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if v_request.actor_id<>p_actor_id or (v_request.input #- '{input,quote_policy_version}') is distinct from v_fingerprint then raise exception 'Changed request' using errcode='PB003'; end if;
    return v_request.result || '{"replayed":true}'::jsonb;
  end if;
  if p_booking_id is not null then
    select * into v_old from public.bookings where id=p_booking_id and organization_id=p_organization_id and owner_id=v_owner for update;
    if not found or p_expected_version is null or v_old.lifecycle_version<>p_expected_version or v_old.status='cancelled' then raise exception 'Booking changed; reload' using errcode='PB004'; end if;
    v_basement_minutes := v_old.basement_duration_minutes;
    v_retained := v_ids is not distinct from (select array_agg(catalog_item_id order by catalog_item_id) from public.booking_line_items where booking_id=p_booking_id);
  end if;
  if nullif(btrim(p_input->>'street_address'),'') is null or (p_booking_id is null and v_start is null) or v_sqft<0 then raise exception 'Invalid input' using errcode='PB002'; end if;
  if not v_retained then
  if p_input->>'quote_policy_version' is distinct from '2026-09-30-v1'
    or public.current_booking_quote_policy() is distinct from '2026-09-30-v1' then
    raise exception 'Booking quote changed; refresh and review before saving' using errcode='PB005';
  end if;
  if coalesce(cardinality(v_ids),0)=0 or cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids) x)
    or exists(select 1 from unnest(v_ids) x left join public.catalog_items c on c.id=x and c.organization_id=p_organization_id and (c.active or exists(select 1 from public.booking_line_items l where l.booking_id=p_booking_id and l.catalog_item_id=x)) where c.id is null)
    or not exists(select 1 from public.catalog_items c where c.id=any(v_ids) and c.kind in ('bundle','a_la_carte'))
    or (select count(*) from public.catalog_items c where c.id=any(v_ids) and c.kind='bundle')>1 then
    raise exception 'Invalid catalog selection' using errcode='PB002';
  end if;
  if exists(select 1 from public.catalog_items a where a.id=any(v_ids) and a.kind='addon' and (
    (a.require_has_video and not exists(select 1 from public.catalog_items c where c.id=any(v_ids) and c.kind<>'addon' and c.is_video)) or
    (a.require_has_media and not exists(select 1 from public.catalog_items c where c.id=any(v_ids) and c.kind<>'addon' and (c.is_video or c.is_photo or c.is_iguide))) or
    (a.exclude_has_aerial and exists(select 1 from public.catalog_items c where c.id=any(v_ids) and c.kind<>'addon' and c.is_aerial)))) then
    raise exception 'Ineligible add-on' using errcode='PB002';
  end if;
  select greatest(sum(coalesce(l.unit_duration_minutes*l.quantity,c.duration_minutes)),60), coalesce(array_agg(coalesce(l.item_slug,c.slug) order by array_position(v_ids,c.id)) filter(where coalesce(l.item_kind,c.kind::text)<>'addon'),'{}'), coalesce(array_agg(coalesce(l.item_slug,c.slug) order by array_position(v_ids,c.id)) filter(where coalesce(l.item_kind,c.kind::text)='addon'),'{}') into v_duration,v_services,v_addons from public.catalog_items c left join public.booking_line_items l on l.booking_id=p_booking_id and l.catalog_item_id=c.id where c.id=any(v_ids);
  else
    select greatest(sum(unit_duration_minutes*quantity),60),coalesce(array_agg(item_slug) filter(where item_kind<>'addon'),'{}'),coalesce(array_agg(item_slug) filter(where item_kind='addon'),'{}') into v_duration,v_services,v_addons from public.booking_line_items where booking_id=p_booking_id;
  end if;
  v_duration := v_duration + v_basement_minutes;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_owner::text||':'||lower(btrim(p_input->>'street_address')),1));
  select id into v_property from public.properties where organization_id=p_organization_id and owner_id=v_owner and lower(btrim(street_address))=lower(btrim(p_input->>'street_address')) and city is not distinct from nullif(p_input->>'city','') and province is not distinct from coalesce(nullif(p_input->>'province',''),'ON') and postal_code is not distinct from nullif(p_input->>'postal_code','') order by created_at,id limit 1;
  if v_property is null then
    insert into public.properties(organization_id,owner_id,street_address,city,province,postal_code) values(p_organization_id,v_owner,btrim(p_input->>'street_address'),nullif(p_input->>'city',''),coalesce(nullif(p_input->>'province',''),'ON'),nullif(p_input->>'postal_code','')) returning id into v_property;
  end if;
  if p_booking_id is null then
  insert into public.bookings(organization_id,owner_id,property_id,status,scheduled_at,scheduled_ends_at,allow_schedule_overlap,services,add_ons,square_footage,unit_number,client_notes,suppress_realtor_notifications,include_basement,basement_duration_minutes)
  values(p_organization_id,v_owner,v_property,'confirmed',v_start,v_start+make_interval(mins=>v_duration),true,v_services,v_addons,v_sqft,nullif(p_input->>'unit_number',''),nullif(p_input->>'client_notes',''),coalesce((p_input->>'suppress_realtor_notifications')::boolean,false),(p_input->>'include_basement')::boolean,v_basement_minutes) returning id,lifecycle_version into v_booking,v_version;
  else
    update public.bookings set property_id=v_property,scheduled_at=v_start,scheduled_ends_at=case when v_retained and v_old.scheduled_at is not null and v_old.scheduled_ends_at is not null then v_start+(v_old.scheduled_ends_at-v_old.scheduled_at) else v_start+make_interval(mins=>v_duration) end,allow_schedule_overlap=true,services=v_services,add_ons=v_addons,square_footage=v_sqft,unit_number=nullif(p_input->>'unit_number',''),client_notes=nullif(p_input->>'client_notes','') where id=p_booking_id returning id,lifecycle_version into v_booking,v_version;
  end if;
  if not v_retained then
    delete from public.booking_line_items where booking_id=v_booking and not (catalog_item_id=any(v_ids));
  insert into public.booking_line_items(booking_id,catalog_item_id,item_name,item_slug,item_kind,quantity,unit_price_cents,unit_duration_minutes)
  select v_booking,id,name,slug,kind::text,1,public.catalog_booking_price_cents(c,v_sqft),duration_minutes from public.catalog_items c where id=any(v_ids) and not exists(select 1 from public.booking_line_items l where l.booking_id=v_booking and l.catalog_item_id=c.id);
  end if;
  if p_input ? 'contact_name' then
    if nullif(btrim(p_input->>'contact_name'),'') is null then raise exception 'Contact name required' using errcode='PB002'; end if;
    update public.profiles set full_name=btrim(p_input->>'contact_name'),phone=nullif(p_input->>'contact_phone',''),brokerage=nullif(p_input->>'brokerage','') where id=v_owner and organization_id=p_organization_id;
  end if;
  if p_booking_id is null then
    insert into public.integration_jobs(organization_id,booking_id,job_type,idempotency_key,payload)
    select p_organization_id,v_booking,j.kind,'booking:'||v_booking||':'||j.kind||':admin-v1',
      jsonb_build_object(
        'schema_version',1,'booking_id',v_booking,'organization_id',p_organization_id,'public_request_id',p_request_id,
        'app_url',coalesce(p_input->>'app_url',''),
        'organization',jsonb_build_object('name',o.name,'from_name',coalesce(nullif(o.email_from_name,''),o.name),
          'reply_to_email',coalesce(nullif(o.reply_to_email,''),nullif(o.admin_notification_email,''),nullif(p_input->>'admin_notification_email','')),
          'admin_notification_email',coalesce(nullif(o.admin_notification_email,''),nullif(p_input->>'admin_notification_email',''))),
        'realtor',jsonb_build_object('id',p.id,'email',p.email,'full_name',coalesce(nullif(p.full_name,''),p.email),'phone',p.phone,'brokerage',p.brokerage,'delivery_cc_emails',coalesce(p.delivery_cc_emails,'{}'::text[])),
        'property',jsonb_build_object('street_address',a.street_address,'city',a.city,'postal_code',a.postal_code,'unit_number',b.unit_number),
        'booking',jsonb_build_object('scheduled_at',b.scheduled_at,'scheduled_ends_at',b.scheduled_ends_at,'square_footage',b.square_footage,'is_vacant',b.is_vacant,'include_basement',b.include_basement,'client_notes',coalesce(b.client_notes,'')),
        'line_items',(select jsonb_agg(jsonb_build_object('catalog_item_id',l.catalog_item_id,'name',l.item_name,'slug',l.item_slug,'kind',l.item_kind,'quantity',l.quantity,'unit_price_cents',l.unit_price_cents,'unit_duration_minutes',l.unit_duration_minutes) order by array_position(v_ids,l.catalog_item_id)) from public.booking_line_items l where l.booking_id=v_booking))
    from public.bookings b join public.properties a on a.id=b.property_id and a.organization_id=b.organization_id
    join public.organizations o on o.id=b.organization_id join public.profiles p on p.id=b.owner_id and p.organization_id=b.organization_id
    cross join (values ('google_calendar.event.create'),('email.booking.confirmation'),('email.admin.new_booking'),('push.admin.new_booking'),('quickbooks.invoice.create')) j(kind)
    where b.id=v_booking and (j.kind<>'quickbooks.invoice.create' or o.invoice_timing='at_booking');
  end if;
  -- Migration-safe hook: finish effect bookkeeping on final snapshots before
  -- capturing CAS. Deferred triggers subsequently see the same payload (no-op).
  if to_regprocedure('public.refresh_booking_effects(uuid,uuid)') is not null then
    execute 'select public.refresh_booking_effects($1,$2)' using p_organization_id,v_booking;
  end if;
  select lifecycle_version into v_version from public.bookings where id=v_booking and organization_id=p_organization_id;
  v_result := jsonb_build_object('booking_id',v_booking,'property_id',v_property,'lifecycle_version',v_version,'replayed',false);
  insert into public.admin_booking_requests values(p_organization_id,p_request_id,p_actor_id,v_fingerprint,v_booking,v_result);
  return v_result;
end $$;
revoke all on function public.save_admin_booking_aggregate(uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_admin_booking_aggregate(uuid,uuid,uuid,uuid,bigint,jsonb) to service_role;

-- Activate only after all quote/snapshot functions and columns are installed.
-- Legacy public writers remain replay-only; versioned forms must reconfirm.
create or replace function public.current_booking_quote_policy()
returns text language sql stable security invoker set search_path = '' as $$ select '2026-09-30-v1'::text $$;
revoke all on function public.current_booking_quote_policy() from public,anon,authenticated;
grant execute on function public.current_booking_quote_policy() to service_role;
