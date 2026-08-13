-- Canonical, service-role-only source uploads for AutoHDR.
-- Browser code supplies only the expected byte identity. Dimensions remain
-- untrusted until the application decodes the stored bytes server-side and
-- submits the verified dimensions with exact storage HEAD evidence.

alter table public.media_ingest_jobs
  add column source_version_id uuid;
alter table public.media_ingest_jobs
  add constraint media_ingest_jobs_source_version_fkey foreign key (
    organization_id, source_version_id, property_id, batch_id
  ) references public.media_versions (
    organization_id, id, property_id, batch_id
  ) on delete restrict;
create unique index media_ingest_jobs_source_version_idx
  on public.media_ingest_jobs (organization_id, source_version_id)
  where source_version_id is not null;

create or replace function public.enforce_media_ingest_job_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.organization_id, new.property_id, new.batch_id, new.provider_event_id,
      new.source_version_id, new.job_kind, new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.property_id, old.batch_id, old.provider_event_id,
      old.source_version_id, old.job_kind, old.idempotency_key, old.created_at) then
    raise exception 'Media ingest job identity is immutable' using errcode = '23514';
  end if;
  if new.state is distinct from old.state
     and not public.is_valid_media_ingest_transition(old.state, new.state) then
    raise exception 'Invalid media ingest job transition' using errcode = '23514';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function public.is_valid_autohdr_source_file(
  p_filename text,
  p_mime_type text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    (pg_catalog.lower(p_filename) ~ '\.jpe?g$' and p_mime_type = 'image/jpeg')
    or (pg_catalog.lower(p_filename) ~ '\.png$' and p_mime_type = 'image/png')
$$;

create or replace function public.enforce_autohdr_source_rpc_boundary()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_source boolean := false;
  v_rpc_owner oid;
  v_batch_id uuid;
begin
  select proc.proowner into v_rpc_owner
  from pg_catalog.pg_proc proc
  where proc.oid = 'public.create_autohdr_source_batch(uuid,uuid,uuid,uuid,jsonb)'::pg_catalog.regprocedure;

  if (select oid from pg_catalog.pg_roles where rolname = current_user) = v_rpc_owner then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name in ('media_batches', 'media_assets') then
    v_is_source := coalesce(
      case when tg_op = 'DELETE' then old.source_provider else new.source_provider end,
      ''
    ) = 'autohdr_source_upload';
  else
    v_batch_id := case when tg_op = 'DELETE' then old.batch_id else new.batch_id end;
    select exists (
      select 1 from public.media_batches batch
      where batch.id = v_batch_id
        and batch.source_provider = 'autohdr_source_upload'
    ) into v_is_source;
  end if;

  if v_is_source then
    raise exception 'AutoHDR canonical source rows may only be mutated through source RPCs'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger autohdr_source_batches_rpc_boundary
before insert or update or delete on public.media_batches
for each row execute function public.enforce_autohdr_source_rpc_boundary();
create trigger autohdr_source_assets_rpc_boundary
before insert or update or delete on public.media_assets
for each row execute function public.enforce_autohdr_source_rpc_boundary();
create trigger autohdr_source_versions_rpc_boundary
before insert or update or delete on public.media_versions
for each row execute function public.enforce_autohdr_source_rpc_boundary();
create trigger autohdr_source_ingest_jobs_rpc_boundary
before insert or update or delete on public.media_ingest_jobs
for each row execute function public.enforce_autohdr_source_rpc_boundary();

create or replace function public.create_autohdr_source_batch(
  p_organization_id uuid,
  p_booking_id uuid,
  p_request_id uuid,
  p_created_by uuid,
  p_files jsonb
)
returns table (
  batch_id uuid,
  asset_id uuid,
  version_id uuid,
  ingest_job_id uuid,
  "position" integer,
  filename text,
  bucket_name text,
  object_key text,
  sha256 bytea,
  byte_size bigint,
  mime_type text,
  newly_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property_id uuid;
  v_batch_id uuid;
  v_file_count integer;
  v_created boolean := false;
  v_existing jsonb;
  v_requested jsonb;
  v_file record;
  v_asset_id uuid;
  v_version_id uuid;
begin
  if p_organization_id is null or p_booking_id is null or p_request_id is null
     or p_created_by is null or p_files is null
     or pg_catalog.jsonb_typeof(p_files) is distinct from 'array' then
    raise exception 'Invalid AutoHDR source request' using errcode = '22023';
  end if;

  select booking.property_id into v_property_id
  from public.bookings booking
  where booking.organization_id = p_organization_id
    and booking.id = p_booking_id;
  if not found then
    raise exception 'AutoHDR source booking is outside the tenant'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    join public.organization_members membership
      on membership.organization_id = profile.organization_id
     and membership.profile_id = profile.id
    where profile.organization_id = p_organization_id
      and profile.id = p_created_by
      and profile.role::text = 'admin'
      and profile.archived_at is null
      and membership.role in ('owner', 'admin')
  ) then
    raise exception 'AutoHDR source creator must be an active tenant admin'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.integration_credentials credential
    where credential.organization_id = p_organization_id
      and credential.provider = 'autohdr'
      and pg_catalog.lower(pg_catalog.btrim(credential.credentials ->> 'enabled')) = 'true'
      and pg_catalog.btrim(credential.credentials ->> 'api_key') <> ''
  ) then
    raise exception 'AutoHDR is not enabled for this tenant'
      using errcode = '42501';
  end if;

  v_file_count := pg_catalog.jsonb_array_length(p_files);
  if v_file_count not between 1 and 160
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_files) file_row(value)
       where pg_catalog.jsonb_typeof(file_row.value) is distinct from 'object'
          or not file_row.value ?& array['filename', 'byte_size', 'mime_type', 'sha256']
          or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(file_row.value)) <> 4
          or pg_catalog.jsonb_typeof(file_row.value -> 'filename') is distinct from 'string'
          or pg_catalog.jsonb_typeof(file_row.value -> 'byte_size') is distinct from 'number'
          or pg_catalog.jsonb_typeof(file_row.value -> 'mime_type') is distinct from 'string'
          or pg_catalog.jsonb_typeof(file_row.value -> 'sha256') is distinct from 'string'
     ) then
    raise exception 'Invalid AutoHDR source manifest shape' using errcode = '22023';
  end if;

  begin
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_files) file_row(value)
      cross join lateral (
        select
          file_row.value ->> 'filename' as filename,
          (file_row.value ->> 'byte_size')::bigint as byte_size,
          file_row.value ->> 'mime_type' as mime_type,
          file_row.value ->> 'sha256' as sha256
      ) parsed
      where parsed.filename <> pg_catalog.btrim(parsed.filename)
         or pg_catalog.char_length(parsed.filename) not between 1 and 255
         or pg_catalog.octet_length(parsed.filename) > 1024
         or parsed.filename in ('.', '..')
         or parsed.filename ~ '[\\/[:cntrl:]]'
         or (file_row.value ->> 'byte_size') !~ '^[0-9]+$'
         or parsed.byte_size not between 1 and 21474836480
         or parsed.mime_type <> pg_catalog.btrim(parsed.mime_type)
         or parsed.sha256 !~ '^[0-9a-f]{64}$'
         or not public.is_valid_autohdr_source_file(parsed.filename, parsed.mime_type)
    ) then
      raise exception 'Invalid AutoHDR source file' using errcode = '22023';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid AutoHDR source file' using errcode = '22023';
  end;

  if (
    select pg_catalog.count(*) <> pg_catalog.count(distinct file_row.value ->> 'filename')
        or pg_catalog.count(*) <> pg_catalog.count(distinct file_row.value ->> 'sha256')
    from pg_catalog.jsonb_array_elements(p_files) file_row(value)
  ) then
    raise exception 'AutoHDR source filenames and hashes must be unique within a request'
      using errcode = '22023';
  end if;

  insert into public.media_batches (
    organization_id, property_id, booking_id, source_provider,
    provider_connection_key, provider_job_id, provider_revision, created_by
  ) values (
    p_organization_id, v_property_id, p_booking_id, 'autohdr_source_upload',
    'autohdr:' || p_organization_id::text, p_request_id::text, 0, p_created_by
  )
  on conflict (
    organization_id, source_provider, provider_connection_key,
    provider_job_id, provider_revision
  ) do nothing
  returning id into v_batch_id;
  v_created := found;

  if not v_created then
    select batch.id into v_batch_id
    from public.media_batches batch
    where batch.organization_id = p_organization_id
      and batch.source_provider = 'autohdr_source_upload'
      and batch.provider_connection_key = 'autohdr:' || p_organization_id::text
      and batch.provider_job_id = p_request_id::text
      and batch.provider_revision = 0
    for update;
  end if;

  if v_created then
    for v_file in
      select
        (file_row.ordinal - 1)::integer as position,
        file_row.value ->> 'filename' as filename,
        (file_row.value ->> 'byte_size')::bigint as byte_size,
        file_row.value ->> 'mime_type' as mime_type,
        file_row.value ->> 'sha256' as sha256
      from pg_catalog.jsonb_array_elements(p_files) with ordinality file_row(value, ordinal)
      order by file_row.ordinal
    loop
      v_asset_id := extensions.gen_random_uuid();
      v_version_id := extensions.gen_random_uuid();

      insert into public.media_assets (
        id, organization_id, property_id, batch_id, source_provider,
        provider_connection_key, provider_job_id, provider_output_id,
        provider_revision, media_kind, original_filename, capture_sequence
      ) values (
        v_asset_id, p_organization_id, v_property_id, v_batch_id, 'autohdr_source_upload',
        'autohdr:' || p_organization_id::text, p_request_id::text,
        'source-' || pg_catalog.lpad(v_file.position::text, 3, '0'),
        0, 'image', v_file.filename, v_file.position
      );

      insert into public.media_versions (
        id, organization_id, property_id, batch_id, asset_id, version_number,
        ingest_state, object_tier, bucket_name, object_key, sha256, byte_size,
        mime_type, width_px, height_px, edit_class, disclosure_class
      ) values (
        v_version_id, p_organization_id, v_property_id, v_batch_id, v_asset_id, 1,
        'discovered', 'master', 'pixel-blaster-private-media',
        'masters/' || p_organization_id::text || '/' || v_asset_id::text || '/' ||
          v_version_id::text || '/' || v_file.sha256 ||
          case v_file.mime_type when 'image/jpeg' then '.jpg' else '.png' end,
        pg_catalog.decode(v_file.sha256, 'hex'), v_file.byte_size,
        v_file.mime_type, null, null, 'original', 'none'
      );

      insert into public.media_ingest_jobs (
        organization_id, property_id, batch_id, source_version_id,
        job_kind, idempotency_key, state
      ) values (
        p_organization_id, v_property_id, v_batch_id, v_version_id,
        'ingest', 'autohdr-source:' || p_request_id::text || ':' ||
          pg_catalog.lpad(v_file.position::text, 3, '0'), 'discovered'
      );
    end loop;
  else
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'filename', asset.original_filename,
        'byte_size', version.byte_size,
        'mime_type', version.mime_type,
        'sha256', pg_catalog.encode(version.sha256, 'hex')
      ) order by asset.capture_sequence
    ) into v_existing
    from public.media_assets asset
    join public.media_versions version
      on version.organization_id = asset.organization_id
     and version.asset_id = asset.id
     and version.batch_id = asset.batch_id
     and version.version_number = 1
    where asset.organization_id = p_organization_id
      and asset.batch_id = v_batch_id;

    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'filename', file_row.value ->> 'filename',
        'byte_size', (file_row.value ->> 'byte_size')::bigint,
        'mime_type', file_row.value ->> 'mime_type',
        'sha256', file_row.value ->> 'sha256'
      ) order by file_row.ordinal
    ) into v_requested
    from pg_catalog.jsonb_array_elements(p_files) with ordinality file_row(value, ordinal);

    if not exists (
      select 1 from public.media_batches batch
      where batch.id = v_batch_id
        and batch.organization_id = p_organization_id
        and batch.booking_id = p_booking_id
        and batch.property_id = v_property_id
        and batch.created_by = p_created_by
    ) or v_existing is distinct from v_requested then
      raise exception 'AutoHDR source request UUID conflicts with existing input'
        using errcode = '22023';
    end if;
  end if;

  return query
  select
    batch.id,
    asset.id,
    version.id,
    job.id,
    asset.capture_sequence,
    asset.original_filename,
    version.bucket_name,
    version.object_key,
    version.sha256,
    version.byte_size,
    version.mime_type,
    v_created
  from public.media_batches batch
  join public.media_assets asset
    on asset.organization_id = batch.organization_id
   and asset.batch_id = batch.id
   and asset.property_id = batch.property_id
  join public.media_versions version
    on version.organization_id = asset.organization_id
   and version.asset_id = asset.id
   and version.batch_id = asset.batch_id
   and version.version_number = 1
  join public.media_ingest_jobs job
    on job.organization_id = version.organization_id
   and job.source_version_id = version.id
   and job.batch_id = version.batch_id
  where batch.organization_id = p_organization_id
    and batch.id = v_batch_id
  order by asset.capture_sequence;
end;
$$;

create or replace function public.accept_autohdr_source_version(
  p_organization_id uuid,
  p_booking_id uuid,
  p_batch_id uuid,
  p_asset_id uuid,
  p_version_id uuid,
  p_ingest_job_id uuid,
  p_bucket_name text,
  p_object_key text,
  p_sha256 bytea,
  p_byte_size bigint,
  p_mime_type text,
  p_verified_width_px integer,
  p_verified_height_px integer
)
returns table (
  version_id uuid,
  ingest_state text,
  accepted_at timestamptz,
  ingest_job_id uuid,
  ingest_job_state text,
  ingest_completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.media_versions;
  v_job public.media_ingest_jobs;
  v_created_by uuid;
begin
  if p_organization_id is null or p_booking_id is null or p_batch_id is null
     or p_asset_id is null or p_version_id is null or p_ingest_job_id is null
     or p_bucket_name is null or p_object_key is null or p_sha256 is null
     or p_byte_size is null or p_mime_type is null
     or p_verified_width_px is null or p_verified_height_px is null
     or p_verified_width_px not between 1 and 100000
     or p_verified_height_px not between 1 and 100000
     or pg_catalog.octet_length(p_sha256) <> 32 then
    raise exception 'Invalid AutoHDR source acceptance identity' using errcode = '22023';
  end if;

  select version.*
    into v_version
  from public.media_batches batch
  join public.media_assets asset
    on asset.organization_id = batch.organization_id
   and asset.batch_id = batch.id
   and asset.property_id = batch.property_id
   and asset.id = p_asset_id
   and asset.source_provider = 'autohdr_source_upload'
  join public.media_versions version
    on version.organization_id = asset.organization_id
   and version.batch_id = asset.batch_id
   and version.asset_id = asset.id
   and version.property_id = asset.property_id
   and version.id = p_version_id
  where batch.organization_id = p_organization_id
    and batch.id = p_batch_id
    and batch.booking_id = p_booking_id
    and batch.source_provider = 'autohdr_source_upload'
  for update of version;
  if not found then
    raise exception 'AutoHDR source version identity mismatch' using errcode = '23503';
  end if;

  select batch.created_by into v_created_by
  from public.media_batches batch
  where batch.organization_id = p_organization_id
    and batch.id = p_batch_id;

  select job.* into v_job
  from public.media_ingest_jobs job
  where job.organization_id = p_organization_id
    and job.id = p_ingest_job_id
    and job.batch_id = p_batch_id
    and job.property_id = v_version.property_id
    and job.source_version_id = p_version_id
    and job.job_kind = 'ingest'
  for update;
  if not found then
    raise exception 'AutoHDR source ingest job identity mismatch' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    join public.organization_members membership
      on membership.organization_id = profile.organization_id
     and membership.profile_id = profile.id
    where profile.organization_id = p_organization_id
      and profile.id = v_created_by
      and profile.role::text = 'admin'
      and profile.archived_at is null
      and membership.role in ('owner', 'admin')
  ) or not exists (
    select 1
    from public.integration_credentials credential
    where credential.organization_id = p_organization_id
      and credential.provider = 'autohdr'
      and pg_catalog.lower(pg_catalog.btrim(credential.credentials ->> 'enabled')) = 'true'
      and pg_catalog.btrim(credential.credentials ->> 'api_key') <> ''
  ) then
    raise exception 'AutoHDR source acceptance is not enabled for this tenant admin'
      using errcode = '42501';
  end if;

  if p_bucket_name <> 'pixel-blaster-private-media'
     or p_bucket_name is distinct from v_version.bucket_name
     or p_object_key is distinct from v_version.object_key
     or p_sha256 is distinct from v_version.sha256
     or p_byte_size is distinct from v_version.byte_size
     or p_mime_type is distinct from v_version.mime_type then
    raise exception 'Storage HEAD evidence does not match canonical source identity'
      using errcode = '22023';
  end if;

  if v_version.ingest_state = 'accepted' and v_version.accepted_at is not null
     and v_job.state = 'accepted' and v_job.completed_at is not null then
    if p_verified_width_px is distinct from v_version.width_px
       or p_verified_height_px is distinct from v_version.height_px then
      raise exception 'Verified dimensions do not match accepted canonical source identity'
        using errcode = '22023';
    end if;
    return query select v_version.id, v_version.ingest_state, v_version.accepted_at,
      v_job.id, v_job.state, v_job.completed_at;
    return;
  end if;
  if v_version.ingest_state <> 'discovered' or v_version.accepted_at is not null
     or v_version.width_px is not null or v_version.height_px is not null
     or v_job.state <> 'discovered' or v_job.completed_at is not null then
    raise exception 'AutoHDR source acceptance is not in discovered state'
      using errcode = '23514';
  end if;

  update public.media_versions set ingest_state = 'url_ready' where id = v_version.id;
  update public.media_ingest_jobs set state = 'url_ready' where id = v_job.id;
  update public.media_versions set ingest_state = 'fetching' where id = v_version.id;
  update public.media_ingest_jobs set state = 'fetching' where id = v_job.id;
  update public.media_versions set ingest_state = 'quarantined' where id = v_version.id;
  update public.media_ingest_jobs set state = 'quarantined' where id = v_job.id;
  update public.media_versions set ingest_state = 'validating' where id = v_version.id;
  update public.media_ingest_jobs set state = 'validating' where id = v_job.id;
  update public.media_versions set ingest_state = 'scanning' where id = v_version.id;
  update public.media_ingest_jobs set state = 'scanning' where id = v_job.id;
  update public.media_versions
    set ingest_state = 'accepted',
        width_px = p_verified_width_px,
        height_px = p_verified_height_px,
        accepted_at = pg_catalog.now()
    where id = v_version.id
    returning * into v_version;
  update public.media_ingest_jobs
    set state = 'accepted', completed_at = pg_catalog.now()
    where id = v_job.id
    returning * into v_job;

  return query select v_version.id, v_version.ingest_state, v_version.accepted_at,
    v_job.id, v_job.state, v_job.completed_at;
end;
$$;

revoke all on function public.is_valid_autohdr_source_file(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_autohdr_source_rpc_boundary()
  from public, anon, authenticated, service_role;
revoke all on function public.create_autohdr_source_batch(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.accept_autohdr_source_version(uuid, uuid, uuid, uuid, uuid, uuid, text, text, bytea, bigint, text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.create_autohdr_source_batch(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.accept_autohdr_source_version(uuid, uuid, uuid, uuid, uuid, uuid, text, text, bytea, bigint, text, integer, integer)
  to service_role;

comment on function public.create_autohdr_source_batch(uuid, uuid, uuid, uuid, jsonb) is
  'Service-only idempotent creation of booking-bound JPEG/PNG canonical source upload identities with a per-response creation marker.';
comment on function public.accept_autohdr_source_version(uuid, uuid, uuid, uuid, uuid, uuid, text, text, bytea, bigint, text, integer, integer) is
  'Service-only atomic acceptance of exact canonical storage HEAD evidence and server-decoded dimensions.';
