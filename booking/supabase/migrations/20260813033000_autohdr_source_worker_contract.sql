-- Database-only AutoHDR source worker contract.
-- Bounds browser manifests, leases one quarantined source at a time, and
-- serializes tenant-scoped content-addressed master reuse.

alter function public.create_autohdr_source_batch(uuid, uuid, uuid, uuid, jsonb)
  rename to create_autohdr_source_batch_v1;

create function public.create_autohdr_source_batch(
  p_organization_id uuid,
  p_booking_id uuid,
  p_request_id uuid,
  p_created_by uuid,
  p_files jsonb
)
returns table (
  batch_id uuid, asset_id uuid, version_id uuid, ingest_job_id uuid,
  "position" integer, filename text, bucket_name text, object_key text,
  sha256 bytea, byte_size bigint, mime_type text, newly_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_total numeric;
begin
  if p_files is null or pg_catalog.jsonb_typeof(p_files) is distinct from 'array' then
    raise exception 'Invalid AutoHDR source manifest' using errcode = '22023';
  end if;
  v_count := pg_catalog.jsonb_array_length(p_files);
  begin
    select pg_catalog.sum((file_row.value ->> 'byte_size')::numeric)
      into v_total
    from pg_catalog.jsonb_array_elements(p_files) file_row(value);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid AutoHDR source manifest size' using errcode = '22023';
  end;
  if v_count not between 1 and 20
     or coalesce(v_total, 0) > 262144000
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(p_files) file_row(value)
       where pg_catalog.jsonb_typeof(file_row.value -> 'byte_size') is distinct from 'number'
          or (file_row.value ->> 'byte_size') !~ '^[0-9]+$'
          or (file_row.value ->> 'byte_size')::numeric not between 1 and 26214400
     ) then
    raise exception 'AutoHDR source manifest exceeds worker bounds' using errcode = '22023';
  end if;

  return query select * from public.create_autohdr_source_batch_v1(
    p_organization_id, p_booking_id, p_request_id, p_created_by, p_files
  );
end;
$$;

alter table public.autohdr_source_ingests
  add column worker_id text,
  add column worker_lease_token uuid,
  add column worker_lease_expires_at timestamptz,
  add column worker_claimed_at timestamptz,
  add constraint autohdr_source_ingests_worker_lease_check check (
    (worker_id is null and worker_lease_token is null and worker_lease_expires_at is null)
    or (
      worker_id = pg_catalog.btrim(worker_id)
      and pg_catalog.char_length(worker_id) between 1 and 128
      and worker_id !~ '[[:cntrl:]]'
      and worker_lease_token is not null
      and worker_lease_expires_at is not null
      and worker_claimed_at is not null
      and worker_lease_expires_at > worker_claimed_at
    )
  );

create table public.autohdr_source_hash_reservations (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sha256 bytea not null,
  byte_size bigint not null,
  mime_type text not null,
  master_version_id uuid not null,
  master_asset_id uuid not null,
  master_batch_id uuid not null,
  master_property_id uuid not null,
  master_bucket_name text not null,
  master_object_key text not null,
  reserved_by_ingest_job_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint autohdr_source_hash_reservations_pkey primary key (organization_id, sha256),
  constraint autohdr_source_hash_reservations_content_check check (
    pg_catalog.octet_length(sha256) = 32
    and byte_size between 1 and 26214400
    and mime_type in ('image/jpeg', 'image/png')
    and master_bucket_name = 'pixel-blaster-private-media'
  ),
  constraint autohdr_source_hash_reservations_version_fkey foreign key (
    organization_id, master_version_id, master_asset_id, master_property_id, master_batch_id
  ) references public.media_versions (
    organization_id, id, asset_id, property_id, batch_id
  ) on delete restrict,
  constraint autohdr_source_hash_reservations_job_fkey foreign key (
    organization_id, reserved_by_ingest_job_id
  ) references public.autohdr_source_ingests (
    organization_id, ingest_job_id
  ) on delete restrict
);

create table public.autohdr_source_position_refs (
  organization_id uuid not null,
  ingest_job_id uuid not null,
  request_id uuid not null,
  "position" integer not null,
  source_version_id uuid not null,
  master_version_id uuid not null,
  sha256 bytea not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint autohdr_source_position_refs_pkey primary key (organization_id, ingest_job_id),
  constraint autohdr_source_position_refs_position_key unique (organization_id, request_id, "position"),
  constraint autohdr_source_position_refs_position_check check ("position" between 0 and 19),
  constraint autohdr_source_position_refs_source_fkey foreign key (
    organization_id, ingest_job_id
  ) references public.autohdr_source_ingests (
    organization_id, ingest_job_id
  ) on delete restrict,
  constraint autohdr_source_position_refs_reservation_fkey foreign key (
    organization_id, sha256
  ) references public.autohdr_source_hash_reservations (
    organization_id, sha256
  ) on delete restrict
);

create function public.enforce_autohdr_source_worker_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'AutoHDR source hash reservations are retained' using errcode = '23514';
  end if;
  if (new.organization_id, new.sha256, new.created_at) is distinct from
     (old.organization_id, old.sha256, old.created_at) then
    raise exception 'AutoHDR source hash reservation identity is immutable' using errcode = '23514';
  end if;
  if (new.master_version_id, new.master_asset_id, new.master_batch_id,
      new.master_property_id, new.master_bucket_name, new.master_object_key,
      new.byte_size, new.mime_type, new.reserved_by_ingest_job_id) is distinct from
     (old.master_version_id, old.master_asset_id, old.master_batch_id,
      old.master_property_id, old.master_bucket_name, old.master_object_key,
      old.byte_size, old.mime_type, old.reserved_by_ingest_job_id) then
    raise exception 'AutoHDR source master reservation is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger autohdr_source_hash_reservations_immutable
before update or delete on public.autohdr_source_hash_reservations
for each row execute function public.enforce_autohdr_source_worker_identity();

create function public.claim_autohdr_source_file(
  p_organization_id uuid,
  p_worker_id text,
  p_lease_seconds integer
)
returns table (
  organization_id uuid, booking_id uuid, property_id uuid, batch_id uuid,
  asset_id uuid, version_id uuid, ingest_job_id uuid, request_id uuid,
  "position" integer, quarantine_bucket_name text, quarantine_object_key text,
  quarantine_etag text, master_bucket_name text, master_object_key text,
  sha256 bytea, byte_size bigint, mime_type text,
  worker_id text, lease_token uuid, lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_worker_id is null
     or p_worker_id <> pg_catalog.btrim(p_worker_id)
     or pg_catalog.char_length(p_worker_id) not between 1 and 128
     or p_worker_id ~ '[[:cntrl:]]'
     or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'Invalid AutoHDR source claim bounds' using errcode = '22023';
  end if;

  return query
  with candidate as (
    select source.organization_id, source.ingest_job_id
    from public.autohdr_source_ingests source
    where source.organization_id = p_organization_id
      and source.lifecycle_state = 'quarantined'
      and source.quarantine_etag is not null
      and not exists (
        select 1 from public.autohdr_source_position_refs ref
        where ref.organization_id = source.organization_id
          and ref.ingest_job_id = source.ingest_job_id
      )
      and (source.worker_lease_expires_at is null
        or source.worker_lease_expires_at <= pg_catalog.clock_timestamp())
    order by source.prepared_at, source.ingest_job_id
    for update skip locked
    limit 1
  ), claimed as (
    update public.autohdr_source_ingests source
       set worker_id = p_worker_id,
           worker_lease_token = extensions.gen_random_uuid(),
           worker_claimed_at = pg_catalog.clock_timestamp(),
           worker_lease_expires_at = pg_catalog.clock_timestamp() +
             pg_catalog.make_interval(secs => p_lease_seconds)
      from candidate
     where source.organization_id = candidate.organization_id
       and source.ingest_job_id = candidate.ingest_job_id
    returning source.*
  )
  select claimed.organization_id, claimed.booking_id, claimed.property_id,
    claimed.batch_id, claimed.asset_id, claimed.version_id, claimed.ingest_job_id,
    claimed.request_id, claimed.position, claimed.quarantine_bucket_name,
    claimed.quarantine_object_key, claimed.quarantine_etag,
    claimed.master_bucket_name, claimed.master_object_key,
    claimed.expected_sha256, claimed.expected_byte_size, claimed.expected_mime_type,
    claimed.worker_id, claimed.worker_lease_token, claimed.worker_lease_expires_at
  from claimed;
end;
$$;

create function public.reserve_or_reuse_autohdr_source_master(
  p_organization_id uuid,
  p_ingest_job_id uuid,
  p_lease_token uuid,
  p_master_bucket_name text,
  p_master_object_key text,
  p_sha256 bytea,
  p_byte_size bigint,
  p_mime_type text
)
returns table (
  version_id uuid,
  asset_id uuid,
  batch_id uuid,
  bucket_name text,
  object_key text,
  newly_reserved boolean,
  reused_accepted boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.autohdr_source_ingests;
  v_reservation public.autohdr_source_hash_reservations;
  v_inserted boolean := false;
begin
  select source.* into v_source
  from public.autohdr_source_ingests source
  where source.organization_id = p_organization_id
    and source.ingest_job_id = p_ingest_job_id
  for update;
  if not found then
    raise exception 'AutoHDR source lease scope was not found' using errcode = '23503';
  end if;
  if v_source.worker_lease_token is distinct from p_lease_token
     or v_source.worker_lease_expires_at is null
     or v_source.worker_lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'AutoHDR source lease is stale or fenced' using errcode = '55000';
  end if;
  if p_master_bucket_name is distinct from v_source.master_bucket_name
     or p_master_object_key is distinct from v_source.master_object_key
     or p_sha256 is distinct from v_source.expected_sha256
     or p_byte_size is distinct from v_source.expected_byte_size
     or p_mime_type is distinct from v_source.expected_mime_type then
    raise exception 'AutoHDR source master evidence drifted from the claim' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || pg_catalog.encode(p_sha256, 'hex'), 0)
  );

  insert into public.autohdr_source_hash_reservations (
    organization_id, sha256, byte_size, mime_type,
    master_version_id, master_asset_id, master_batch_id, master_property_id,
    master_bucket_name, master_object_key, reserved_by_ingest_job_id
  ) values (
    p_organization_id, p_sha256, p_byte_size, p_mime_type,
    v_source.version_id, v_source.asset_id, v_source.batch_id, v_source.property_id,
    p_master_bucket_name, p_master_object_key, p_ingest_job_id
  ) on conflict (organization_id, sha256) do nothing;
  v_inserted := found;

  select reservation.* into v_reservation
  from public.autohdr_source_hash_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.sha256 = p_sha256;

  if v_reservation.byte_size is distinct from p_byte_size
     or v_reservation.mime_type is distinct from p_mime_type then
    raise exception 'AutoHDR source hash metadata conflicts with its reservation' using errcode = '22023';
  end if;
  if not v_inserted and v_reservation.master_version_id <> v_source.version_id
     and not exists (
       select 1 from public.media_versions version
       where version.organization_id = p_organization_id
         and version.id = v_reservation.master_version_id
         and version.ingest_state = 'accepted'
         and version.accepted_at is not null
         and version.sha256 = p_sha256
         and version.byte_size = p_byte_size
         and version.mime_type = p_mime_type
     ) then
    raise exception 'AutoHDR source hash has a competing unaccepted master reservation'
      using errcode = '55000';
  end if;

  insert into public.autohdr_source_position_refs (
    organization_id, ingest_job_id, request_id, "position",
    source_version_id, master_version_id, sha256
  ) values (
    p_organization_id, p_ingest_job_id, v_source.request_id, v_source.position,
    v_source.version_id, v_reservation.master_version_id, p_sha256
  ) on conflict (organization_id, ingest_job_id) do nothing;

  if not found and not exists (
    select 1 from public.autohdr_source_position_refs ref
    where ref.organization_id = p_organization_id
      and ref.ingest_job_id = p_ingest_job_id
      and ref.request_id = v_source.request_id
      and ref.position = v_source.position
      and ref.source_version_id = v_source.version_id
      and ref.master_version_id = v_reservation.master_version_id
      and ref.sha256 = p_sha256
  ) then
    raise exception 'AutoHDR source position replay conflicts with durable identity' using errcode = '22023';
  end if;

  return query select
    v_reservation.master_version_id, v_reservation.master_asset_id,
    v_reservation.master_batch_id, v_reservation.master_bucket_name,
    v_reservation.master_object_key, v_inserted,
    (not v_inserted and v_reservation.master_version_id <> v_source.version_id);
end;
$$;

alter table public.autohdr_source_hash_reservations enable row level security;
alter table public.autohdr_source_hash_reservations force row level security;
alter table public.autohdr_source_position_refs enable row level security;
alter table public.autohdr_source_position_refs force row level security;

revoke all on table public.autohdr_source_hash_reservations from public, anon, authenticated, service_role;
revoke all on table public.autohdr_source_position_refs from public, anon, authenticated, service_role;
grant select on table public.autohdr_source_hash_reservations to service_role;
grant select on table public.autohdr_source_position_refs to service_role;

revoke all on function public.create_autohdr_source_batch_v1(uuid,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_autohdr_source_batch(uuid,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_autohdr_source_file(uuid,text,integer)
  from public, anon, authenticated;
revoke all on function public.reserve_or_reuse_autohdr_source_master(uuid,uuid,uuid,text,text,bytea,bigint,text)
  from public, anon, authenticated;
revoke all on function public.enforce_autohdr_source_worker_identity()
  from public, anon, authenticated, service_role;

grant execute on function public.claim_autohdr_source_file(uuid,text,integer)
  to service_role;
grant execute on function public.reserve_or_reuse_autohdr_source_master(uuid,uuid,uuid,text,text,bytea,bigint,text)
  to service_role;

comment on function public.claim_autohdr_source_file(uuid,text,integer) is
  'Service-only one-file quarantined source claim with skip-locked leasing and stale-worker fencing.';
comment on function public.reserve_or_reuse_autohdr_source_master(uuid,uuid,uuid,text,text,bytea,bigint,text) is
  'Service-only atomic tenant-scoped source-hash reservation or reuse of an already accepted canonical master.';
