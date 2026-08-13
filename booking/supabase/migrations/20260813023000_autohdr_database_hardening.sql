-- Additive repair for the AutoHDR state-machine database boundary.
-- The original state-machine and canonical-source migrations are immutable.
-- Remaining medium: duplicate canonical checksum reuse across separate source
-- requests is intentionally unchanged by this repair.

drop function public.claim_autohdr_job(uuid, uuid, uuid, text, bytea, jsonb);

create function public.claim_autohdr_job(
  p_organization_id uuid,
  p_booking_id uuid,
  p_property_id uuid,
  p_idempotency_key text,
  p_manifest_sha256 bytea,
  p_files jsonb
)
returns table (
  id uuid,
  organization_id uuid,
  booking_id uuid,
  property_id uuid,
  idempotency_key text,
  manifest_sha256 bytea,
  file_count integer,
  state text,
  provider_uid text,
  provider_status text,
  provider_uid_assigned_at timestamptz,
  retrieval_claimed_at timestamptz,
  retrieval_claim_token uuid,
  last_error_code text,
  last_error_at timestamptz,
  state_changed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  newly_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.autohdr_jobs;
  v_file_count integer;
  v_existing_files jsonb;
  v_requested_files jsonb;
  v_created boolean := false;
begin
  if p_organization_id is null
     or p_booking_id is null
     or p_property_id is null
     or p_idempotency_key is null
     or p_idempotency_key <> pg_catalog.btrim(p_idempotency_key)
     or pg_catalog.char_length(p_idempotency_key) not between 1 and 200
     or p_idempotency_key ~ '[[:cntrl:]]'
     or p_manifest_sha256 is null
     or pg_catalog.octet_length(p_manifest_sha256) <> 32
     or p_files is null
     or pg_catalog.jsonb_typeof(p_files) <> 'array' then
    raise exception 'Invalid AutoHDR claim input' using errcode = '22023';
  end if;

  v_file_count := pg_catalog.jsonb_array_length(p_files);
  if v_file_count not between 1 and 160
     or exists (
       select 1
         from pg_catalog.jsonb_array_elements(p_files) file_row(value)
        where pg_catalog.jsonb_typeof(file_row.value) <> 'object'
           or not file_row.value ?& array['position', 'source_media_version_id', 'filename']
           or (
             select pg_catalog.count(*)
               from pg_catalog.jsonb_object_keys(file_row.value)
           ) <> 3
           or pg_catalog.jsonb_typeof(file_row.value -> 'position') <> 'number'
           or pg_catalog.jsonb_typeof(file_row.value -> 'source_media_version_id') <> 'string'
           or pg_catalog.jsonb_typeof(file_row.value -> 'filename') <> 'string'
     ) then
    raise exception 'Invalid AutoHDR file manifest' using errcode = '22023';
  end if;

  begin
    if exists (
      with requested as (
        select
          (file_row.value ->> 'position')::integer as position,
          (file_row.value ->> 'position')::numeric as position_numeric,
          (file_row.value ->> 'source_media_version_id')::uuid as source_media_version_id,
          file_row.value ->> 'filename' as filename
        from pg_catalog.jsonb_array_elements(p_files) file_row(value)
      )
      select 1 from requested
       where position_numeric <> pg_catalog.trunc(position_numeric)
          or position not between 0 and v_file_count - 1
          or filename <> pg_catalog.btrim(filename)
          or pg_catalog.char_length(filename) not between 1 and 255
          or filename in ('.', '..')
          or filename ~ '[\\/[:cntrl:]]'
    ) or (
      with requested as (
        select
          (file_row.value ->> 'position')::integer as position,
          (file_row.value ->> 'source_media_version_id')::uuid as source_media_version_id,
          file_row.value ->> 'filename' as filename
        from pg_catalog.jsonb_array_elements(p_files) file_row(value)
      )
      select pg_catalog.count(*) <> pg_catalog.count(distinct position)
          or pg_catalog.count(*) <> pg_catalog.count(distinct source_media_version_id)
          or pg_catalog.count(*) <> pg_catalog.count(distinct filename)
        from requested
    ) then
      raise exception 'Invalid AutoHDR file manifest identity' using errcode = '22023';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid AutoHDR file manifest identity' using errcode = '22023';
  end;

  if (
    with requested as (
      select (file_row.value ->> 'source_media_version_id')::uuid as source_media_version_id
        from pg_catalog.jsonb_array_elements(p_files) file_row(value)
    )
    select pg_catalog.count(*)
      from requested
      join public.media_versions version
       on version.organization_id = p_organization_id
       and version.id = requested.source_media_version_id
       and version.property_id = p_property_id
       and version.accepted_at is not null
       and version.sha256 is not null
      join public.media_batches batch
        on batch.organization_id = version.organization_id
       and batch.id = version.batch_id
       and batch.property_id = version.property_id
       and batch.booking_id = p_booking_id
  ) <> v_file_count then
    raise exception 'AutoHDR files must reference accepted booking media'
      using errcode = '23503';
  end if;

  insert into public.autohdr_jobs (
    organization_id, booking_id, property_id, idempotency_key,
    manifest_sha256, file_count
  ) values (
    p_organization_id, p_booking_id, p_property_id, p_idempotency_key,
    p_manifest_sha256, v_file_count
  )
  on conflict on constraint autohdr_jobs_idempotency_key do nothing
  returning * into v_job;
  v_created := found;

  if v_created then
    insert into public.autohdr_job_files (
      organization_id, booking_id, property_id, job_id, position,
      source_media_version_id, source_batch_id, filename, input_sha256
    )
    select
      p_organization_id, p_booking_id, p_property_id, v_job.id,
      (file_row.value ->> 'position')::integer,
      version.id, version.batch_id, file_row.value ->> 'filename', version.sha256
    from pg_catalog.jsonb_array_elements(p_files) file_row(value)
    join public.media_versions version
      on version.organization_id = p_organization_id
     and version.id = (file_row.value ->> 'source_media_version_id')::uuid
     and version.property_id = p_property_id
    order by (file_row.value ->> 'position')::integer;
  else
    select * into v_job
      from public.autohdr_jobs job
     where job.organization_id = p_organization_id
       and job.idempotency_key = p_idempotency_key;

    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'position', file.position,
        'source_media_version_id', file.source_media_version_id::text,
        'filename', file.filename
      ) order by file.position
    ) into v_existing_files
      from public.autohdr_job_files file
     where file.organization_id = p_organization_id
       and file.job_id = v_job.id;

    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'position', (file_row.value ->> 'position')::integer,
        'source_media_version_id', (file_row.value ->> 'source_media_version_id')::uuid::text,
        'filename', file_row.value ->> 'filename'
      ) order by (file_row.value ->> 'position')::integer
    ) into v_requested_files
      from pg_catalog.jsonb_array_elements(p_files) file_row(value);

    if v_job.booking_id <> p_booking_id
       or v_job.property_id <> p_property_id
       or v_job.manifest_sha256 <> p_manifest_sha256
       or v_job.file_count <> v_file_count
       or v_existing_files is distinct from v_requested_files then
      raise exception 'AutoHDR idempotency key conflicts with the existing manifest'
        using errcode = '22023';
    end if;
  end if;

  return query
    select
      job.id, job.organization_id, job.booking_id, job.property_id,
      job.idempotency_key, job.manifest_sha256, job.file_count, job.state,
      job.provider_uid, job.provider_status, job.provider_uid_assigned_at,
      job.retrieval_claimed_at, job.retrieval_claim_token,
      job.last_error_code, job.last_error_at, job.state_changed_at,
      job.created_at, job.updated_at, v_created
    from public.autohdr_jobs job
    where job.organization_id = p_organization_id
      and job.booking_id = p_booking_id
      and job.property_id = p_property_id
      and job.id = v_job.id;
end;
$$;

create function public.list_autohdr_jobs(
  p_organization_id uuid,
  p_booking_id uuid
)
returns table (
  id uuid,
  organization_id uuid,
  booking_id uuid,
  property_id uuid,
  state text,
  provider_uid text,
  provider_status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_booking_id is null then
    raise exception 'Invalid AutoHDR read scope' using errcode = '22023';
  end if;
  if not public.is_organization_admin(p_organization_id) then
    raise exception 'AutoHDR jobs are outside the active admin tenant'
      using errcode = '42501';
  end if;

  return query
    select
      job.id, job.organization_id, job.booking_id, job.property_id,
      job.state, job.provider_uid, job.provider_status,
      job.created_at, job.updated_at
    from public.autohdr_jobs job
    where job.organization_id = p_organization_id
      and job.booking_id = p_booking_id
    order by job.created_at desc
    limit 10;
end;
$$;

revoke insert, update, delete on table public.autohdr_jobs from service_role;
revoke insert, update, delete on table public.autohdr_job_files from service_role;
revoke select on table public.autohdr_jobs from authenticated;

revoke all on function public.claim_autohdr_job(uuid, uuid, uuid, text, bytea, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_autohdr_job(uuid, uuid, uuid, text, bytea, jsonb)
  to service_role;

revoke all on function public.list_autohdr_jobs(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_autohdr_jobs(uuid, uuid)
  to authenticated, service_role;
