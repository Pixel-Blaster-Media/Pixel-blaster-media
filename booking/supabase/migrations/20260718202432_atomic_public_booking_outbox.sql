-- Commit the public booking aggregate and its consequential integration work in
-- one Postgres transaction. The RPCs are service-role-only and SECURITY INVOKER;
-- the function still independently verifies tenant, profile, membership, cart,
-- schedule, and request-idempotency invariants.

alter table public.bookings
  add column if not exists public_request_id uuid,
  add column if not exists public_request_fingerprint text;

alter table public.booking_line_items
  add column if not exists item_name text,
  add column if not exists item_slug text,
  add column if not exists item_kind text;

update public.booking_line_items line
set item_name = catalog.name,
    item_slug = catalog.slug,
    item_kind = catalog.kind::text
from public.catalog_items catalog
where catalog.id = line.catalog_item_id
  and (
    line.item_name is null
    or line.item_slug is null
    or line.item_kind is null
  );

create or replace function public.snapshot_booking_line_item_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.catalog_item_id is distinct from old.catalog_item_id then
      raise exception 'Booking line catalog identity is immutable'
        using errcode = '23514';
    end if;
    new.item_name := old.item_name;
    new.item_slug := old.item_slug;
    new.item_kind := old.item_kind;
    new.unit_price_cents := old.unit_price_cents;
    new.unit_duration_minutes := old.unit_duration_minutes;
    return new;
  end if;

  select catalog.name, catalog.slug, catalog.kind::text
    into new.item_name, new.item_slug, new.item_kind
  from public.catalog_items catalog
  where catalog.id = new.catalog_item_id;

  if not found then
    raise exception 'Catalog item does not exist'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger snapshot_booking_line_item_identity_trigger
before insert or update on public.booking_line_items
for each row execute function public.snapshot_booking_line_item_identity();

alter table public.booking_line_items
  alter column item_name set not null,
  alter column item_slug set not null,
  alter column item_kind set not null,
  add constraint booking_line_items_item_kind_check
    check (item_kind in ('bundle', 'a_la_carte', 'addon'));

create unique index if not exists bookings_public_request_org_idx
  on public.bookings(organization_id, public_request_id)
  where public_request_id is not null;

create unique index if not exists bookings_organization_id_id_idx
  on public.bookings(organization_id, id);

create or replace function public.is_valid_booking_integration_payload(
  p_payload jsonb,
  p_organization_id uuid,
  p_booking_id uuid
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  org jsonb;
  realtor jsonb;
  property_snapshot jsonb;
  booking_snapshot jsonb;
  item jsonb;
  cc jsonb;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if coalesce((jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload->'schema_version') <> 'number'
    or (p_payload->>'schema_version')::numeric <> 1
    or jsonb_typeof(p_payload->'booking_id') <> 'string'
    or p_payload->>'booking_id' <> p_booking_id::text
    or jsonb_typeof(p_payload->'organization_id') <> 'string'
    or p_payload->>'organization_id' <> p_organization_id::text
    or jsonb_typeof(p_payload->'public_request_id') <> 'string'
    or p_payload->>'public_request_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_payload->'app_url') <> 'string'
    or p_payload->>'app_url' ~* '^https?://[^/[:space:]]*@'
    or not (
      p_payload->>'app_url' = ''
      or p_payload->>'app_url' ~* '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?([/?#][^[:space:]<>"'']*)?$'
      or p_payload->>'app_url' ~* '^http://(localhost|127\.0\.0\.1)(:(0|[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?([/?#][^[:space:]<>"'']*)?$'
    )
  ), true) then return false;
  end if;

  org := p_payload->'organization';
  realtor := p_payload->'realtor';
  property_snapshot := p_payload->'property';
  booking_snapshot := p_payload->'booking';
  if coalesce((jsonb_typeof(org) <> 'object'
    or jsonb_typeof(org->'name') <> 'string'
    or nullif(pg_catalog.btrim(org->>'name'), '') is null
    or jsonb_typeof(org->'from_name') <> 'string'
    or nullif(pg_catalog.btrim(org->>'from_name'), '') is null
    or not (org ?& array['reply_to_email', 'admin_notification_email'])
    or (jsonb_typeof(org->'reply_to_email') <> 'null' and (
      jsonb_typeof(org->'reply_to_email') <> 'string'
      or org->>'reply_to_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ))
    or (jsonb_typeof(org->'admin_notification_email') <> 'null' and (
      jsonb_typeof(org->'admin_notification_email') <> 'string'
      or org->>'admin_notification_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ))
  ), true) then return false;
  end if;

  if coalesce((jsonb_typeof(realtor) <> 'object'
    or jsonb_typeof(realtor->'id') <> 'string'
    or realtor->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(realtor->'email') <> 'string'
    or realtor->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or jsonb_typeof(realtor->'full_name') <> 'string'
    or nullif(pg_catalog.btrim(realtor->>'full_name'), '') is null
    or not (realtor ?& array['phone', 'brokerage', 'delivery_cc_emails'])
    or jsonb_typeof(realtor->'phone') not in ('string', 'null')
    or jsonb_typeof(realtor->'brokerage') not in ('string', 'null')
    or jsonb_typeof(realtor->'delivery_cc_emails') <> 'array'
  ), true) then return false;
  end if;
  for cc in select value from jsonb_array_elements(realtor->'delivery_cc_emails') loop
    if jsonb_typeof(cc) <> 'string'
      or (cc #>> '{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then return false;
    end if;
  end loop;

  if coalesce((jsonb_typeof(property_snapshot) <> 'object'
    or jsonb_typeof(property_snapshot->'street_address') <> 'string'
    or nullif(pg_catalog.btrim(property_snapshot->>'street_address'), '') is null
    or not (property_snapshot ?& array['city', 'postal_code', 'unit_number'])
    or jsonb_typeof(property_snapshot->'city') not in ('string', 'null')
    or jsonb_typeof(property_snapshot->'postal_code') not in ('string', 'null')
    or jsonb_typeof(property_snapshot->'unit_number') not in ('string', 'null')
  ), true) then return false;
  end if;

  if coalesce((jsonb_typeof(booking_snapshot) <> 'object'
    or not (booking_snapshot ?& array[
      'scheduled_at', 'scheduled_ends_at', 'square_footage',
      'is_vacant', 'include_basement', 'client_notes'
    ])
    or jsonb_typeof(booking_snapshot->'scheduled_at') <> 'string'
    or booking_snapshot->>'scheduled_at' !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$'
    or jsonb_typeof(booking_snapshot->'scheduled_ends_at') <> 'string'
    or booking_snapshot->>'scheduled_ends_at' !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$'
    or jsonb_typeof(booking_snapshot->'square_footage') not in ('number', 'null')
    or (jsonb_typeof(booking_snapshot->'square_footage') = 'number' and (
      (booking_snapshot->>'square_footage')::numeric < 0
      or (booking_snapshot->>'square_footage')::numeric <> pg_catalog.trunc((booking_snapshot->>'square_footage')::numeric)
      or (booking_snapshot->>'square_footage')::numeric > 9007199254740991
    ))
    or jsonb_typeof(booking_snapshot->'is_vacant') not in ('string', 'null')
    or (jsonb_typeof(booking_snapshot->'is_vacant') = 'string'
      and booking_snapshot->>'is_vacant' not in ('vacant', 'occupied', 'partial'))
    or jsonb_typeof(booking_snapshot->'include_basement') not in ('boolean', 'null')
    or jsonb_typeof(booking_snapshot->'client_notes') <> 'string'
  ), true) then return false;
  end if;
  starts_at := (booking_snapshot->>'scheduled_at')::timestamptz;
  ends_at := (booking_snapshot->>'scheduled_ends_at')::timestamptz;
  if not pg_catalog.isfinite(starts_at)
    or not pg_catalog.isfinite(ends_at)
    or ends_at <= starts_at
  then return false;
  end if;

  if coalesce((jsonb_typeof(p_payload->'line_items') <> 'array'
    or jsonb_array_length(p_payload->'line_items') = 0
  ), true) then return false;
  end if;
  for item in select value from jsonb_array_elements(p_payload->'line_items') loop
    if coalesce((jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'catalog_item_id') <> 'string'
      or item->>'catalog_item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'name') <> 'string'
      or nullif(pg_catalog.btrim(item->>'name'), '') is null
      or jsonb_typeof(item->'slug') <> 'string'
      or nullif(pg_catalog.btrim(item->>'slug'), '') is null
      or jsonb_typeof(item->'kind') <> 'string'
      or item->>'kind' not in ('bundle', 'a_la_carte', 'addon')
      or jsonb_typeof(item->'quantity') <> 'number'
      or (item->>'quantity')::numeric < 1
      or (item->>'quantity')::numeric <> pg_catalog.trunc((item->>'quantity')::numeric)
      or (item->>'quantity')::numeric > 9007199254740991
      or jsonb_typeof(item->'unit_price_cents') <> 'number'
      or (item->>'unit_price_cents')::numeric < 0
      or (item->>'unit_price_cents')::numeric <> pg_catalog.trunc((item->>'unit_price_cents')::numeric)
      or (item->>'unit_price_cents')::numeric > 9007199254740991
      or jsonb_typeof(item->'unit_duration_minutes') <> 'number'
      or (item->>'unit_duration_minutes')::numeric < 0
      or (item->>'unit_duration_minutes')::numeric <> pg_catalog.trunc((item->>'unit_duration_minutes')::numeric)
      or (item->>'unit_duration_minutes')::numeric > 9007199254740991
    ), true) then return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

create table public.integration_jobs (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  booking_id            uuid not null,
  job_type              text not null check (job_type in (
                          'quickbooks.invoice.create',
                          'google_calendar.event.create',
                          'email.booking.confirmation',
                          'email.admin.new_booking',
                          'push.admin.new_booking'
                        )),
  idempotency_key       text not null,
  payload_version       integer not null default 1 check (payload_version = 1),
  payload               jsonb not null check (
                          public.is_valid_booking_integration_payload(
                            payload, organization_id, booking_id
                          )
                        ),
  status                text not null default 'pending'
                        check (status in (
                          'pending',
                          'processing',
                          'retryable',
                          'completed',
                          'skipped',
                          'cancelled',
                          'dead_letter'
                        )),
  attempts              integer not null default 0 check (attempts >= 0),
  max_attempts          integer not null default 8 check (max_attempts > 0),
  next_attempt_at       timestamptz not null default now(),
  lease_token           uuid,
  locked_by             text,
  locked_at             timestamptz,
  lease_expires_at      timestamptz,
  provider_external_id  text,
  provider_result       jsonb,
  last_error_code       text,
  last_error_message    text,
  last_error_at         timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint integration_jobs_booking_tenant_fk
    foreign key (organization_id, booking_id)
    references public.bookings(organization_id, id)
    on delete restrict,
  unique (organization_id, idempotency_key),
  unique (organization_id, booking_id, job_type),
  check (
    status <> 'processing'
    or (
      lease_token is not null
      and locked_by is not null
      and locked_at is not null
      and lease_expires_at is not null
    )
  ),
  check (
    status not in ('completed', 'skipped', 'cancelled', 'dead_letter')
    or completed_at is not null
  )
);

create index integration_jobs_ready_idx
  on public.integration_jobs(next_attempt_at, created_at)
  where status in ('pending', 'retryable');

create index integration_jobs_booking_idx
  on public.integration_jobs(organization_id, booking_id, created_at);

create index integration_jobs_processing_idx
  on public.integration_jobs(lease_expires_at)
  where status = 'processing';

alter table public.integration_jobs enable row level security;

revoke all on table public.integration_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_jobs to service_role;

create or replace function public.preserve_integration_job_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.booking_id is distinct from old.booking_id
     or new.job_type is distinct from old.job_type
     or new.idempotency_key is distinct from old.idempotency_key
     or new.payload_version is distinct from old.payload_version
     or new.payload is distinct from old.payload then
    raise exception 'Integration job identity and payload are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger integration_jobs_preserve_identity_trigger
before update on public.integration_jobs
for each row execute function public.preserve_integration_job_identity();

comment on table public.integration_jobs is
  'Tenant-scoped durable outbox for consequential booking and delivery integrations.';
comment on column public.integration_jobs.idempotency_key is
  'Stable logical-effect key reused for provider idempotency and reconciliation.';
comment on column public.bookings.public_request_id is
  'Client-generated retry key for one public confirmation-page submission.';
comment on column public.bookings.public_request_fingerprint is
  'Normalized payload fingerprint; the same request id cannot silently accept changed booking data.';

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

create or replace function public.claim_integration_job(
  p_organization_id uuid,
  p_booking_id uuid,
  p_job_type text,
  p_worker_id text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed record;
begin
  if p_lease_token is null or nullif(pg_catalog.btrim(p_worker_id), '') is null then
    raise exception 'Integration job lease identity is required'
      using errcode = 'PB003';
  end if;

  -- Expired ambiguous provider attempts are terminalized for reconciliation instead
  -- of being blindly replayed. Email attempts are reclaimable because Resend is
  -- called with the durable provider idempotency key.
  update public.integration_jobs job
  set status = 'dead_letter',
      completed_at = pg_catalog.now(),
      last_error_code = 'lease_expired_ambiguous',
      last_error_message = 'Provider attempt lease expired; manual reconciliation required',
      last_error_at = pg_catalog.now(),
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.status = 'processing'
    and job.lease_expires_at <= pg_catalog.now()
    and (
      job.job_type not in (
        'email.booking.confirmation',
        'email.admin.new_booking'
      )
      or job.attempts >= job.max_attempts
      or job.created_at <= pg_catalog.now() - interval '23 hours'
    );

  -- Retryable means a provider attempt already happened. Once Resend's
  -- idempotency window is near expiry, another email attempt is unsafe.
  update public.integration_jobs job
  set status = 'dead_letter',
      completed_at = pg_catalog.now(),
      last_error_code = 'provider_idempotency_window_expired',
      last_error_message = 'Email retry exceeded the safe provider idempotency window',
      last_error_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.status = 'retryable'
    and job.job_type in ('email.booking.confirmation', 'email.admin.new_booking')
    and job.created_at <= pg_catalog.now() - interval '23 hours';

  update public.integration_jobs job
  set status = 'processing',
      attempts = job.attempts + 1,
      lease_token = p_lease_token,
      locked_by = pg_catalog.btrim(p_worker_id),
      locked_at = pg_catalog.now(),
      lease_expires_at = pg_catalog.now() + interval '10 minutes',
      completed_at = null,
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.attempts < job.max_attempts
    and (
      job.job_type <> 'email.booking.confirmation'
      or not exists (
        select 1
        from public.integration_jobs invoice_job
        where invoice_job.organization_id = job.organization_id
          and invoice_job.booking_id = job.booking_id
          and invoice_job.job_type = 'quickbooks.invoice.create'
          and invoice_job.status not in ('completed', 'skipped', 'cancelled', 'dead_letter')
      )
    )
    and (
      (
        (
          job.status = 'pending'
          or (
            job.status = 'retryable'
            and (
              job.job_type not in ('email.booking.confirmation', 'email.admin.new_booking')
              or job.created_at > pg_catalog.now() - interval '23 hours'
            )
          )
        )
        and job.next_attempt_at <= pg_catalog.now()
      )
      or (
        job.status = 'processing'
        and job.lease_expires_at <= pg_catalog.now()
        and job.created_at > pg_catalog.now() - interval '23 hours'
        and job.job_type in (
          'email.booking.confirmation',
          'email.admin.new_booking'
        )
      )
    )
  returning job.* into claimed;

  if not found then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', claimed.id,
    'organization_id', claimed.organization_id,
    'booking_id', claimed.booking_id,
    'job_type', claimed.job_type,
    'payload_version', claimed.payload_version,
    'idempotency_key', claimed.idempotency_key,
    'payload', claimed.payload,
    'dependency_result', case
      when claimed.job_type = 'email.booking.confirmation' then (
        select invoice_job.provider_result
        from public.integration_jobs invoice_job
        where invoice_job.organization_id = claimed.organization_id
          and invoice_job.booking_id = claimed.booking_id
          and invoice_job.job_type = 'quickbooks.invoice.create'
          and invoice_job.status = 'completed'
        limit 1
      )
      else null
    end,
    'attempts', claimed.attempts,
    'max_attempts', claimed.max_attempts,
    'lease_token', p_lease_token
  );
end;
$$;

create or replace function public.finish_integration_job(
  p_organization_id uuid,
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_provider_external_id text,
  p_provider_result jsonb,
  p_error_code text,
  p_error_message text,
  p_next_attempt_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_id uuid;
  current_attempts integer;
  current_max_attempts integer;
  final_status text;
begin
  if p_status not in ('completed', 'skipped', 'retryable', 'dead_letter') then
    raise exception 'Invalid integration job completion status'
      using errcode = 'PB003';
  end if;

  select job.attempts, job.max_attempts
    into current_attempts, current_max_attempts
  from public.integration_jobs job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.status = 'processing'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > pg_catalog.now()
  for update;

  if not found then
    return false;
  end if;

  final_status := case
    when p_status = 'retryable' and current_attempts >= current_max_attempts
      then 'dead_letter'
    else p_status
  end;

  update public.integration_jobs job
  set status = final_status,
      provider_external_id = nullif(p_provider_external_id, ''),
      provider_result = coalesce(p_provider_result, '{}'::jsonb),
      last_error_code = case
        when final_status in ('retryable', 'dead_letter') then nullif(p_error_code, '')
        else null
      end,
      last_error_message = case
        when final_status in ('retryable', 'dead_letter') then nullif(p_error_message, '')
        else null
      end,
      last_error_at = case
        when final_status in ('retryable', 'dead_letter') then pg_catalog.now()
        else null
      end,
      next_attempt_at = case
        when final_status = 'retryable'
          then coalesce(p_next_attempt_at, pg_catalog.now() + interval '5 minutes')
        else job.next_attempt_at
      end,
      completed_at = case
        when final_status in ('completed', 'skipped', 'dead_letter') then pg_catalog.now()
        else null
      end,
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.status = 'processing'
    and job.lease_token = p_lease_token
  returning job.id into changed_id;

  return changed_id is not null;
end;
$$;

revoke all on function public.is_valid_booking_integration_payload(jsonb, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.is_valid_booking_integration_payload(jsonb, uuid, uuid)
  to service_role;

revoke all on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) to service_role;

revoke all on function public.claim_integration_job(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_integration_job(uuid, uuid, text, text, uuid)
  to service_role;

revoke all on function public.finish_integration_job(
  uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.finish_integration_job(
  uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz
) to service_role;

comment on function public.create_public_booking_with_jobs(
  uuid, uuid, uuid, text, text, text, text, timestamptz, integer,
  text, boolean, text, uuid[], uuid[], text, text
) is
  'Atomically derives tenant catalog pricing/duration, reuses or creates property, creates booking + snapshots, and commits durable integration jobs.';
comment on function public.claim_integration_job(uuid, uuid, text, text, uuid) is
  'Leases pending/retryable work, reclaims expired idempotent email attempts only inside a 23-hour provider window, and terminalizes older or ambiguous attempts.';
comment on function public.finish_integration_job(
  uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz
) is
  'Completes a leased integration job only when tenant, job, and lease token all match.';
