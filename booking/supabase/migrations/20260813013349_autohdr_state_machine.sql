-- Durable, code-dark AutoHDR state machine. The canonical media migration
-- 20260811225000 is a prerequisite: every input file is anchored to an
-- accepted canonical media version, and no provider URLs or secrets persist.

create table public.autohdr_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  booking_id uuid not null,
  property_id uuid not null,
  idempotency_key text not null,
  manifest_sha256 bytea not null,
  file_count integer not null,
  state text not null default 'claimed',
  provider_uid text,
  provider_status text,
  provider_uid_assigned_at timestamptz,
  retrieval_claimed_at timestamptz,
  retrieval_claim_token uuid,
  last_error_code text,
  last_error_at timestamptz,
  state_changed_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint autohdr_jobs_scope_key
    unique (organization_id, id, booking_id, property_id),
  constraint autohdr_jobs_idempotency_key
    unique (organization_id, idempotency_key),
  constraint autohdr_jobs_idempotency_check check (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    and pg_catalog.char_length(idempotency_key) between 1 and 200
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  constraint autohdr_jobs_manifest_check check (
    pg_catalog.octet_length(manifest_sha256) = 32
    and file_count between 1 and 160
  ),
  constraint autohdr_jobs_state_check check (state in (
    'claimed', 'preparing', 'awaiting_upload', 'finalizing', 'processing',
    'ready', 'retrieving', 'review_pending', 'retryable',
    'reconciliation_required', 'rejected'
  )),
  constraint autohdr_jobs_provider_uid_check check (
    provider_uid is null or provider_uid ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$'
  ),
  constraint autohdr_jobs_provider_status_check check (
    provider_status is null or provider_status in (
      'created', 'uploading', 'processing', 'ready', 'failed', 'unknown'
    )
  ),
  constraint autohdr_jobs_provider_assignment_check check (
    (provider_uid is null and provider_uid_assigned_at is null)
    or (provider_uid is not null and provider_uid_assigned_at is not null)
  ),
  constraint autohdr_jobs_provider_workflow_check check (
    state not in (
      'awaiting_upload', 'finalizing', 'processing', 'ready',
      'retrieving', 'review_pending'
    ) or provider_uid is not null
  ),
  constraint autohdr_jobs_retrieval_claim_check check (
    (retrieval_claimed_at is null and retrieval_claim_token is null)
    or (
      retrieval_claimed_at is not null
      and retrieval_claim_token is not null
      and state in (
        'retrieving', 'review_pending', 'reconciliation_required', 'rejected'
      )
    )
  ),
  constraint autohdr_jobs_error_code_check check (
    last_error_code is null
    or last_error_code ~ '^[a-z0-9][a-z0-9._-]{0,95}$'
  ),
  constraint autohdr_jobs_failure_state_check check (
    state not in ('retryable', 'reconciliation_required', 'rejected')
    or last_error_code is not null
  ),
  constraint autohdr_jobs_booking_fkey foreign key (
    organization_id, booking_id, property_id
  ) references public.bookings (
    organization_id, id, property_id
  ) on delete restrict,
  constraint autohdr_jobs_property_fkey foreign key (
    organization_id, property_id
  ) references public.properties (
    organization_id, id
  ) on delete restrict
);

create unique index autohdr_jobs_provider_uid_idx
  on public.autohdr_jobs (organization_id, provider_uid)
  where provider_uid is not null;
create index autohdr_jobs_scope_state_idx
  on public.autohdr_jobs (organization_id, booking_id, property_id, state, updated_at);

create table public.autohdr_job_files (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  booking_id uuid not null,
  property_id uuid not null,
  job_id uuid not null,
  position integer not null,
  source_media_version_id uuid not null,
  source_batch_id uuid not null,
  filename text not null,
  input_sha256 bytea not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint autohdr_job_files_position_check check (position between 0 and 159),
  constraint autohdr_job_files_filename_check check (
    filename = pg_catalog.btrim(filename)
    and pg_catalog.char_length(filename) between 1 and 255
    and filename not in ('.', '..')
    and filename !~ '[\\/[:cntrl:]]'
  ),
  constraint autohdr_job_files_sha256_check
    check (pg_catalog.octet_length(input_sha256) = 32),
  constraint autohdr_job_files_position_key
    unique (organization_id, job_id, position),
  constraint autohdr_job_files_filename_key
    unique (organization_id, job_id, filename),
  constraint autohdr_job_files_source_key
    unique (organization_id, job_id, source_media_version_id),
  constraint autohdr_job_files_job_fkey foreign key (
    organization_id, job_id, booking_id, property_id
  ) references public.autohdr_jobs (
    organization_id, id, booking_id, property_id
  ) on delete restrict,
  constraint autohdr_job_files_source_fkey foreign key (
    organization_id, source_media_version_id, property_id, source_batch_id
  ) references public.media_versions (
    organization_id, id, property_id, batch_id
  ) on delete restrict
);

create or replace function public.is_valid_autohdr_job_transition(
  p_old_state text,
  p_new_state text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_old_state
    when 'claimed' then p_new_state in (
      'preparing', 'retryable', 'reconciliation_required', 'rejected'
    )
    when 'preparing' then p_new_state in (
      'awaiting_upload', 'retryable', 'reconciliation_required', 'rejected'
    )
    when 'awaiting_upload' then p_new_state in (
      'finalizing', 'retryable', 'reconciliation_required', 'rejected'
    )
    when 'finalizing' then p_new_state in (
      'processing', 'retryable', 'reconciliation_required', 'rejected'
    )
    when 'processing' then p_new_state in (
      'ready', 'retryable', 'reconciliation_required', 'rejected'
    )
    when 'ready' then p_new_state in (
      'retrieving', 'reconciliation_required', 'rejected'
    )
    when 'retrieving' then p_new_state in (
      'review_pending', 'reconciliation_required', 'rejected'
    )
    when 'retryable' then p_new_state in (
      'preparing', 'reconciliation_required', 'rejected'
    )
    else false
  end;
$$;

create or replace function public.enforce_autohdr_job_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'claimed'
       or new.provider_uid is not null
       or new.provider_status is not null
       or new.provider_uid_assigned_at is not null
       or new.retrieval_claimed_at is not null
       or new.retrieval_claim_token is not null
       or new.last_error_code is not null
       or new.last_error_at is not null then
      raise exception 'AutoHDR jobs must start in the claimed state'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if (
    new.id, new.organization_id, new.booking_id, new.property_id,
    new.idempotency_key, new.manifest_sha256, new.file_count, new.created_at
  ) is distinct from (
    old.id, old.organization_id, old.booking_id, old.property_id,
    old.idempotency_key, old.manifest_sha256, old.file_count, old.created_at
  ) then
    raise exception 'AutoHDR job identity is immutable' using errcode = '23514';
  end if;

  if new.provider_uid is distinct from old.provider_uid then
    if old.provider_uid is not null
       or new.provider_uid is null
       or old.state <> 'preparing'
       or new.state <> 'preparing' then
      raise exception 'AutoHDR provider uid assignment is invalid'
        using errcode = '23514';
    end if;
  elsif new.provider_uid_assigned_at is distinct from old.provider_uid_assigned_at then
    raise exception 'AutoHDR provider uid assignment timestamp is immutable'
      using errcode = '23514';
  end if;

  if (
    new.retrieval_claimed_at, new.retrieval_claim_token
  ) is distinct from (
    old.retrieval_claimed_at, old.retrieval_claim_token
  ) then
    if old.state <> 'ready'
       or new.state <> 'retrieving'
       or old.retrieval_claimed_at is not null
       or old.retrieval_claim_token is not null
       or new.retrieval_claimed_at is null
       or new.retrieval_claim_token is null then
      raise exception 'AutoHDR retrieval claim is invalid' using errcode = '23514';
    end if;
  end if;

  if new.state is distinct from old.state then
    if not public.is_valid_autohdr_job_transition(old.state, new.state) then
      raise exception 'Invalid AutoHDR job transition' using errcode = '23514';
    end if;
    new.state_changed_at := pg_catalog.now();
  elsif new.state_changed_at is distinct from old.state_changed_at then
    raise exception 'AutoHDR state timestamp is immutable without a transition'
      using errcode = '23514';
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function public.prevent_autohdr_job_file_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'AutoHDR job file manifests are immutable' using errcode = '23514';
end;
$$;

create trigger autohdr_jobs_enforce_write
before insert or update on public.autohdr_jobs
for each row execute function public.enforce_autohdr_job_write();

create trigger autohdr_job_files_immutable
before update or delete on public.autohdr_job_files
for each row execute function public.prevent_autohdr_job_file_mutation();

create or replace function public.claim_autohdr_job(
  p_organization_id uuid,
  p_booking_id uuid,
  p_property_id uuid,
  p_idempotency_key text,
  p_manifest_sha256 bytea,
  p_files jsonb
)
returns setof public.autohdr_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.autohdr_jobs;
  v_file_count integer;
  v_existing_files jsonb;
  v_requested_files jsonb;
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
  on conflict (organization_id, idempotency_key) do nothing
  returning * into v_job;

  if v_job.id is not null then
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
    select job.* from public.autohdr_jobs job
     where job.organization_id = p_organization_id
       and job.booking_id = p_booking_id
       and job.property_id = p_property_id
       and job.id = v_job.id;
end;
$$;

create or replace function public.transition_autohdr_job(
  p_organization_id uuid,
  p_booking_id uuid,
  p_property_id uuid,
  p_job_id uuid,
  p_expected_state text,
  p_new_state text,
  p_provider_status text,
  p_error_code text,
  p_retrieval_claim_token uuid
)
returns setof public.autohdr_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.autohdr_jobs;
begin
  if p_organization_id is null or p_booking_id is null or p_property_id is null
     or p_job_id is null or p_expected_state is null or p_new_state is null
     or (
       p_provider_status is not null
       and p_provider_status not in (
         'created', 'uploading', 'processing', 'ready', 'failed', 'unknown'
       )
     )
     or (
       p_error_code is not null
       and p_error_code !~ '^[a-z0-9][a-z0-9._-]{0,95}$'
     )
     or (
       p_new_state in ('retryable', 'reconciliation_required', 'rejected')
       and p_error_code is null
     ) then
    raise exception 'Invalid AutoHDR transition input' using errcode = '22023';
  end if;

  if p_new_state = 'retrieving'
     or not public.is_valid_autohdr_job_transition(p_expected_state, p_new_state) then
    raise exception 'Invalid AutoHDR job transition' using errcode = '23514';
  end if;

  update public.autohdr_jobs job
     set state = p_new_state,
         provider_status = coalesce(p_provider_status, job.provider_status),
         last_error_code = coalesce(p_error_code, job.last_error_code),
         last_error_at = case
           when p_error_code is not null then pg_catalog.now()
           else job.last_error_at
         end
   where job.organization_id = p_organization_id
     and job.booking_id = p_booking_id
     and job.property_id = p_property_id
     and job.id = p_job_id
     and job.state = p_expected_state
     and (
       p_expected_state <> 'retrieving'
       or (
         p_retrieval_claim_token is not null
         and job.retrieval_claim_token = p_retrieval_claim_token
       )
     )
  returning * into v_job;

  if v_job.id is null then
    if not exists (
      select 1 from public.autohdr_jobs job
       where job.organization_id = p_organization_id
         and job.booking_id = p_booking_id
         and job.property_id = p_property_id
         and job.id = p_job_id
    ) then
      raise no_data_found using message = 'AutoHDR job scope was not found';
    end if;
    raise exception 'AutoHDR job state or retrieval token did not match'
      using errcode = '23514';
  end if;

  return next v_job;
end;
$$;

create or replace function public.assign_autohdr_provider_uid(
  p_organization_id uuid,
  p_booking_id uuid,
  p_property_id uuid,
  p_job_id uuid,
  p_provider_uid text,
  p_provider_status text
)
returns setof public.autohdr_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.autohdr_jobs;
begin
  if p_organization_id is null or p_booking_id is null or p_property_id is null
     or p_job_id is null or p_provider_uid is null
     or p_provider_uid !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$'
     or p_provider_status not in (
       'created', 'uploading', 'processing', 'ready', 'failed', 'unknown'
     ) then
    raise exception 'Invalid AutoHDR provider assignment input'
      using errcode = '22023';
  end if;

  select * into v_job
    from public.autohdr_jobs job
   where job.organization_id = p_organization_id
     and job.booking_id = p_booking_id
     and job.property_id = p_property_id
     and job.id = p_job_id
   for update;

  if v_job.id is null then
    raise no_data_found using message = 'AutoHDR job scope was not found';
  end if;
  if v_job.state <> 'preparing' then
    raise exception 'AutoHDR provider uid requires the preparing state'
      using errcode = '23514';
  end if;
  if v_job.provider_uid is not null and v_job.provider_uid <> p_provider_uid then
    raise exception 'AutoHDR provider uid conflicts with the existing assignment'
      using errcode = '23505';
  end if;

  update public.autohdr_jobs job
     set provider_uid = p_provider_uid,
         provider_status = p_provider_status,
         provider_uid_assigned_at = coalesce(
           job.provider_uid_assigned_at, pg_catalog.now()
         )
   where job.organization_id = p_organization_id
     and job.booking_id = p_booking_id
     and job.property_id = p_property_id
     and job.id = p_job_id
  returning * into v_job;

  return next v_job;
end;
$$;

create or replace function public.claim_autohdr_retrieval(
  p_organization_id uuid,
  p_booking_id uuid,
  p_property_id uuid,
  p_job_id uuid
)
returns setof public.autohdr_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.autohdr_jobs;
begin
  if p_organization_id is null or p_booking_id is null
     or p_property_id is null or p_job_id is null then
    raise exception 'Invalid AutoHDR retrieval claim input' using errcode = '22023';
  end if;

  update public.autohdr_jobs job
     set state = 'retrieving',
         retrieval_claimed_at = pg_catalog.now(),
         retrieval_claim_token = extensions.gen_random_uuid()
   where job.organization_id = p_organization_id
     and job.booking_id = p_booking_id
     and job.property_id = p_property_id
     and job.id = p_job_id
     and job.state = 'ready'
     and job.retrieval_claimed_at is null
     and job.retrieval_claim_token is null
  returning * into v_job;

  if v_job.id is null then
    if not exists (
      select 1 from public.autohdr_jobs job
       where job.organization_id = p_organization_id
         and job.booking_id = p_booking_id
         and job.property_id = p_property_id
         and job.id = p_job_id
    ) then
      raise no_data_found using message = 'AutoHDR job scope was not found';
    end if;
    raise exception 'AutoHDR retrieval is not claimable'
      using errcode = '23514';
  end if;

  return next v_job;
end;
$$;

alter table public.autohdr_jobs enable row level security;
alter table public.autohdr_jobs force row level security;
alter table public.autohdr_job_files enable row level security;
alter table public.autohdr_job_files force row level security;

create policy "autohdr_jobs: org admin read"
  on public.autohdr_jobs for select
  to authenticated
  using (public.is_organization_admin(organization_id));
create policy "autohdr_job_files: org admin read"
  on public.autohdr_job_files for select
  to authenticated
  using (public.is_organization_admin(organization_id));

revoke all on table public.autohdr_jobs, public.autohdr_job_files
  from public, anon, authenticated;
grant select on table public.autohdr_jobs, public.autohdr_job_files
  to authenticated;
grant select, insert, update on table public.autohdr_jobs to service_role;
grant select, insert on table public.autohdr_job_files to service_role;

revoke all on function public.is_valid_autohdr_job_transition(text, text)
  from public, anon, authenticated;
revoke all on function public.enforce_autohdr_job_write()
  from public, anon, authenticated;
revoke all on function public.prevent_autohdr_job_file_mutation()
  from public, anon, authenticated;
revoke all on function public.claim_autohdr_job(uuid, uuid, uuid, text, bytea, jsonb)
  from public, anon, authenticated;
revoke all on function public.transition_autohdr_job(uuid, uuid, uuid, uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.assign_autohdr_provider_uid(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_autohdr_retrieval(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.is_valid_autohdr_job_transition(text, text)
  to service_role;
grant execute on function public.enforce_autohdr_job_write() to service_role;
grant execute on function public.prevent_autohdr_job_file_mutation() to service_role;
grant execute on function public.claim_autohdr_job(uuid, uuid, uuid, text, bytea, jsonb)
  to service_role;
grant execute on function public.transition_autohdr_job(uuid, uuid, uuid, uuid, text, text, text, text, uuid)
  to service_role;
grant execute on function public.assign_autohdr_provider_uid(uuid, uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function public.claim_autohdr_retrieval(uuid, uuid, uuid, uuid)
  to service_role;
