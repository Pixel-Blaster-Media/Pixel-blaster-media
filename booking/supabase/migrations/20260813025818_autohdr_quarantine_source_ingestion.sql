-- Quarantine-first, resumable AutoHDR browser source ingestion.
-- Canonical media constraints remain unchanged. This migration adds a
-- source-specific evidence ledger and narrowly permits only truthful direct
-- transitions used by its security-definer RPC boundary.

create table public.autohdr_source_ingests (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  booking_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  asset_id uuid not null,
  version_id uuid not null,
  ingest_job_id uuid not null,
  request_id uuid not null,
  position integer not null,
  quarantine_bucket_name text not null,
  quarantine_object_key text not null,
  quarantine_etag text,
  master_bucket_name text not null,
  master_object_key text not null,
  expected_sha256 bytea not null,
  expected_byte_size bigint not null,
  expected_mime_type text not null,
  verified_width_px integer,
  verified_height_px integer,
  lifecycle_state text not null default 'prepared',
  prepared_at timestamptz not null default pg_catalog.now(),
  quarantined_at timestamptz,
  validation_started_at timestamptz,
  master_promoted_at timestamptz,
  accepted_at timestamptz,
  reconciliation_required_at timestamptz,
  quarantine_expires_at timestamptz not null default (pg_catalog.now() + interval '1 day'),
  cleanup_next_attempt_at timestamptz not null default (pg_catalog.now() + interval '1 day'),
  cleanup_attempts integer not null default 0,
  cleanup_lease_token uuid,
  cleanup_lease_expires_at timestamptz,
  cleanup_settled_at timestamptz,
  cleanup_outcome text,
  cleanup_object_etag text,
  last_error_code text,
  last_error_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint autohdr_source_ingests_pkey primary key (organization_id, ingest_job_id),
  constraint autohdr_source_ingests_version_key unique (organization_id, version_id),
  constraint autohdr_source_ingests_request_position_key unique (organization_id, request_id, position),
  constraint autohdr_source_ingests_position_check check (position between 0 and 159),
  constraint autohdr_source_ingests_expected_check check (
    pg_catalog.octet_length(expected_sha256) = 32
    and expected_byte_size between 1 and 21474836480
    and expected_mime_type in ('image/jpeg', 'image/png')
  ),
  constraint autohdr_source_ingests_quarantine_key_check check (
    quarantine_bucket_name = 'pixel-blaster-private-media'
    and quarantine_object_key ~ (
      '^quarantine/' || organization_id::text || '/' || ingest_job_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ),
  constraint autohdr_source_ingests_master_key_check check (
    master_bucket_name = 'pixel-blaster-private-media'
    and master_object_key = 'masters/' || organization_id::text || '/' || asset_id::text || '/' ||
      version_id::text || '/' || pg_catalog.encode(expected_sha256, 'hex') ||
      case expected_mime_type when 'image/jpeg' then '.jpg' else '.png' end
  ),
  constraint autohdr_source_ingests_etag_check check (
    quarantine_etag is null or (
      quarantine_etag = pg_catalog.btrim(quarantine_etag)
      and pg_catalog.char_length(quarantine_etag) between 1 and 512
      and quarantine_etag !~ '[[:cntrl:]]'
    )
  ),
  constraint autohdr_source_ingests_state_check check (
    lifecycle_state in ('prepared', 'quarantined', 'validating', 'accepted', 'reconciliation_required')
  ),
  constraint autohdr_source_ingests_dimensions_check check (
    (verified_width_px is null and verified_height_px is null)
    or (verified_width_px between 1 and 100000 and verified_height_px between 1 and 100000)
  ),
  constraint autohdr_source_ingests_lifecycle_evidence_check check (
    (lifecycle_state = 'prepared'
      and quarantine_etag is null and quarantined_at is null and validation_started_at is null
      and master_promoted_at is null and accepted_at is null
      and verified_width_px is null and verified_height_px is null)
    or (lifecycle_state = 'quarantined'
      and quarantine_etag is not null and quarantined_at is not null and validation_started_at is null
      and master_promoted_at is null and accepted_at is null
      and verified_width_px is null and verified_height_px is null)
    or (lifecycle_state = 'validating'
      and quarantine_etag is not null and quarantined_at is not null and validation_started_at is not null
      and master_promoted_at is null and accepted_at is null
      and verified_width_px is null and verified_height_px is null)
    or (lifecycle_state = 'accepted'
      and quarantine_etag is not null and quarantined_at is not null and validation_started_at is not null
      and master_promoted_at is not null and accepted_at is not null
      and verified_width_px is not null and verified_height_px is not null)
    or (lifecycle_state = 'reconciliation_required' and reconciliation_required_at is not null)
  ),
  constraint autohdr_source_ingests_expiry_check check (
    quarantine_expires_at > prepared_at and cleanup_next_attempt_at >= prepared_at
  ),
  constraint autohdr_source_ingests_cleanup_check check (
    cleanup_attempts between 0 and 100
    and ((cleanup_lease_token is null) = (cleanup_lease_expires_at is null))
    and (cleanup_settled_at is null or (cleanup_lease_token is null and cleanup_outcome in ('cleaned', 'not_found')))
    and (cleanup_outcome is null or cleanup_outcome in ('cleaned', 'not_found'))
    and (cleanup_object_etag is null or (
      cleanup_object_etag = pg_catalog.btrim(cleanup_object_etag)
      and pg_catalog.char_length(cleanup_object_etag) between 1 and 512
      and cleanup_object_etag !~ '[[:cntrl:]]'
    ))
  ),
  constraint autohdr_source_ingests_error_check check (
    last_error_code is null or (
      last_error_code = pg_catalog.btrim(last_error_code)
      and pg_catalog.char_length(last_error_code) between 1 and 96
      and last_error_code !~ '[[:cntrl:]]'
    )
  ),
  constraint autohdr_source_ingests_batch_fkey foreign key (
    organization_id, batch_id, property_id, booking_id
  ) references public.media_batches (
    organization_id, id, property_id, booking_id
  ) on delete restrict,
  constraint autohdr_source_ingests_version_fkey foreign key (
    organization_id, version_id, asset_id, property_id, batch_id
  ) references public.media_versions (
    organization_id, id, asset_id, property_id, batch_id
  ) on delete restrict,
  constraint autohdr_source_ingests_job_fkey foreign key (
    organization_id, ingest_job_id, property_id, batch_id
  ) references public.media_ingest_jobs (
    organization_id, id, property_id, batch_id
  ) on delete restrict
);

create index autohdr_source_ingests_cleanup_due_idx
  on public.autohdr_source_ingests (cleanup_next_attempt_at, prepared_at, ingest_job_id)
  where cleanup_settled_at is null and lifecycle_state <> 'accepted';

create or replace function public.is_valid_autohdr_source_transition(
  p_organization_id uuid,
  p_batch_id uuid,
  p_from_state text,
  p_to_state text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.media_batches batch
    where batch.organization_id = p_organization_id
      and batch.id = p_batch_id
      and batch.source_provider = 'autohdr_source_upload'
  ) and (
    (p_from_state = 'discovered' and p_to_state in ('quarantined', 'reconciliation_required'))
    or (p_from_state = 'quarantined' and p_to_state in ('validating', 'reconciliation_required'))
    or (p_from_state = 'validating' and p_to_state in ('accepted', 'reconciliation_required'))
  )
$$;

create or replace function public.prevent_media_storage_identity_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'media_versions' then
    if (new.id, new.organization_id, new.property_id, new.batch_id, new.asset_id,
        new.version_number, new.parent_version_id, new.created_at)
       is distinct from
       (old.id, old.organization_id, old.property_id, old.batch_id, old.asset_id,
        old.version_number, old.parent_version_id, old.created_at) then
      raise exception 'Media version identity is immutable' using errcode = '23514';
    end if;
    if new.ingest_state is distinct from old.ingest_state
       and not public.is_valid_media_ingest_transition(old.ingest_state, new.ingest_state)
       and not public.is_valid_autohdr_source_transition(
         old.organization_id, old.batch_id, old.ingest_state, new.ingest_state
       ) then
      raise exception 'Invalid media ingest transition' using errcode = '23514';
    end if;
    if old.accepted_at is not null and (
      new.object_tier is distinct from old.object_tier
      or new.bucket_name is distinct from old.bucket_name
      or new.object_key is distinct from old.object_key
      or new.sha256 is distinct from old.sha256
      or new.byte_size is distinct from old.byte_size
      or new.mime_type is distinct from old.mime_type
      or new.width_px is distinct from old.width_px
      or new.height_px is distinct from old.height_px
      or new.edit_class is distinct from old.edit_class
      or new.disclosure_class is distinct from old.disclosure_class
      or new.rights_effective_at is distinct from old.rights_effective_at
      or new.rights_expires_at is distinct from old.rights_expires_at
      or new.accepted_at is distinct from old.accepted_at
    ) then
      raise exception 'Accepted media object identity is immutable' using errcode = '23514';
    end if;
  elsif tg_table_name = 'media_derivatives' then
    if (new.id, new.organization_id, new.property_id, new.batch_id, new.source_version_id,
        new.profile_id, new.profile_version, new.derivative_class, new.profile_status, new.created_at)
       is distinct from
       (old.id, old.organization_id, old.property_id, old.batch_id, old.source_version_id,
        old.profile_id, old.profile_version, old.derivative_class, old.profile_status, old.created_at) then
      raise exception 'Derivative identity is immutable' using errcode = '23514';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'queued' and new.status in ('processing', 'retryable', 'rejected', 'dead_letter'))
      or (old.status = 'processing' and new.status in ('ready', 'retryable', 'rejected', 'dead_letter'))
      or (old.status = 'retryable' and new.status in ('processing', 'rejected', 'dead_letter'))
    ) then
      raise exception 'Invalid derivative transition' using errcode = '23514';
    end if;
    if old.ready_at is not null and (
      new.bucket_name is distinct from old.bucket_name
      or new.object_key is distinct from old.object_key
      or new.sha256 is distinct from old.sha256
      or new.byte_size is distinct from old.byte_size
      or new.mime_type is distinct from old.mime_type
      or new.width_px is distinct from old.width_px
      or new.height_px is distinct from old.height_px
      or new.ready_at is distinct from old.ready_at
    ) then
      raise exception 'Ready derivative object identity is immutable' using errcode = '23514';
    end if;
    new.updated_at := pg_catalog.now();
  elsif tg_table_name = 'media_packages' then
    if (new.id, new.organization_id, new.property_id, new.batch_id, new.release_id,
        new.package_type, new.manifest_sha256, new.created_at)
       is distinct from
       (old.id, old.organization_id, old.property_id, old.batch_id, old.release_id,
        old.package_type, old.manifest_sha256, old.created_at) then
      raise exception 'Package release identity is immutable' using errcode = '23514';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'queued' and new.status in ('building', 'failed', 'dead_letter'))
      or (old.status = 'building' and new.status in ('ready', 'retryable', 'reconciliation_required', 'failed', 'dead_letter'))
      or (old.status in ('retryable', 'reconciliation_required') and new.status in ('building', 'failed', 'dead_letter'))
    ) then
      raise exception 'Invalid package transition' using errcode = '23514';
    end if;
    if old.ready_at is not null and (
      new.bucket_name is distinct from old.bucket_name
      or new.object_key is distinct from old.object_key
      or new.package_sha256 is distinct from old.package_sha256
      or new.byte_size is distinct from old.byte_size
      or new.entry_count is distinct from old.entry_count
      or new.ready_at is distinct from old.ready_at
    ) then
      raise exception 'Ready package object identity is immutable' using errcode = '23514';
    end if;
    new.updated_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

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
     and not public.is_valid_media_ingest_transition(old.state, new.state)
     and not (
       old.source_version_id is not null
       and public.is_valid_autohdr_source_transition(
         old.organization_id, old.batch_id, old.state, new.state
       )
     ) then
    raise exception 'Invalid media ingest job transition' using errcode = '23514';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function public.enforce_autohdr_source_ingest_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'AutoHDR source ingest evidence is retained'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if (new.organization_id, new.booking_id, new.property_id, new.batch_id,
        new.asset_id, new.version_id, new.ingest_job_id, new.request_id,
        new.position, new.quarantine_bucket_name, new.quarantine_object_key,
        new.master_bucket_name, new.master_object_key, new.expected_sha256,
        new.expected_byte_size, new.expected_mime_type, new.prepared_at,
        new.quarantine_expires_at)
       is distinct from
       (old.organization_id, old.booking_id, old.property_id, old.batch_id,
        old.asset_id, old.version_id, old.ingest_job_id, old.request_id,
        old.position, old.quarantine_bucket_name, old.quarantine_object_key,
        old.master_bucket_name, old.master_object_key, old.expected_sha256,
        old.expected_byte_size, old.expected_mime_type, old.prepared_at,
        old.quarantine_expires_at) then
      raise exception 'AutoHDR source ingest identity is immutable'
        using errcode = '23514';
    end if;
    if new.lifecycle_state is distinct from old.lifecycle_state and not (
      (old.lifecycle_state = 'prepared' and new.lifecycle_state in ('quarantined', 'reconciliation_required'))
      or (old.lifecycle_state = 'quarantined' and new.lifecycle_state in ('validating', 'reconciliation_required'))
      or (old.lifecycle_state = 'validating' and new.lifecycle_state in ('accepted', 'reconciliation_required'))
    ) then
      raise exception 'Invalid AutoHDR source ingest lifecycle transition'
        using errcode = '23514';
    end if;
    if (old.quarantine_etag is not null and new.quarantine_etag is distinct from old.quarantine_etag)
       or (old.quarantined_at is not null and new.quarantined_at is distinct from old.quarantined_at)
       or (old.validation_started_at is not null and new.validation_started_at is distinct from old.validation_started_at)
       or (old.master_promoted_at is not null and new.master_promoted_at is distinct from old.master_promoted_at)
       or (old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at)
       or (old.reconciliation_required_at is not null and new.reconciliation_required_at is distinct from old.reconciliation_required_at)
       or (old.verified_width_px is not null and new.verified_width_px is distinct from old.verified_width_px)
       or (old.verified_height_px is not null and new.verified_height_px is distinct from old.verified_height_px)
       or (old.cleanup_settled_at is not null and new.cleanup_settled_at is distinct from old.cleanup_settled_at)
       or (old.cleanup_outcome is not null and new.cleanup_outcome is distinct from old.cleanup_outcome)
       or (old.cleanup_object_etag is not null and new.cleanup_object_etag is distinct from old.cleanup_object_etag) then
      raise exception 'AutoHDR source lifecycle evidence is append-only'
        using errcode = '23514';
    end if;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger autohdr_source_ingests_evidence
before update or delete on public.autohdr_source_ingests
for each row execute function public.enforce_autohdr_source_ingest_evidence();

create or replace function public.seed_autohdr_source_ingest_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_version_id is null then
    return new;
  end if;
  insert into public.autohdr_source_ingests (
    organization_id, booking_id, property_id, batch_id, asset_id,
    version_id, ingest_job_id, request_id, position,
    quarantine_bucket_name, quarantine_object_key,
    master_bucket_name, master_object_key,
    expected_sha256, expected_byte_size, expected_mime_type
  )
  select
    new.organization_id, batch.booking_id, new.property_id, new.batch_id, version.asset_id,
    version.id, new.id, batch.provider_job_id::uuid, asset.capture_sequence,
    'pixel-blaster-private-media',
    'quarantine/' || new.organization_id::text || '/' || new.id::text || '/' ||
      extensions.gen_random_uuid()::text,
    version.bucket_name, version.object_key,
    version.sha256, version.byte_size, version.mime_type
  from public.media_versions version
  join public.media_assets asset
    on asset.organization_id = version.organization_id
   and asset.id = version.asset_id
   and asset.batch_id = version.batch_id
  join public.media_batches batch
    on batch.organization_id = version.organization_id
   and batch.id = version.batch_id
   and batch.property_id = version.property_id
  where version.organization_id = new.organization_id
    and version.id = new.source_version_id
    and version.batch_id = new.batch_id
    and batch.source_provider = 'autohdr_source_upload';
  return new;
end;
$$;

create trigger autohdr_source_ingest_identity_seed
after insert on public.media_ingest_jobs
for each row execute function public.seed_autohdr_source_ingest_identity();

-- Existing rows cannot prove quarantine evidence retroactively. Preserve their
-- canonical rows but make the evidence gap explicit for reconciliation.
insert into public.autohdr_source_ingests (
  organization_id, booking_id, property_id, batch_id, asset_id,
  version_id, ingest_job_id, request_id, position,
  quarantine_bucket_name, quarantine_object_key,
  master_bucket_name, master_object_key,
  expected_sha256, expected_byte_size, expected_mime_type,
  lifecycle_state, reconciliation_required_at, last_error_code, last_error_at
)
select
  job.organization_id, batch.booking_id, job.property_id, job.batch_id, version.asset_id,
  version.id, job.id, batch.provider_job_id::uuid, asset.capture_sequence,
  'pixel-blaster-private-media',
  'quarantine/' || job.organization_id::text || '/' || job.id::text || '/' ||
    extensions.gen_random_uuid()::text,
  version.bucket_name, version.object_key,
  version.sha256, version.byte_size, version.mime_type,
  'reconciliation_required', pg_catalog.now(), 'legacy_quarantine_evidence_missing', pg_catalog.now()
from public.media_ingest_jobs job
join public.media_versions version
  on version.organization_id = job.organization_id
 and version.id = job.source_version_id
 and version.batch_id = job.batch_id
join public.media_assets asset
  on asset.organization_id = version.organization_id
 and asset.id = version.asset_id
 and asset.batch_id = version.batch_id
join public.media_batches batch
  on batch.organization_id = job.organization_id
 and batch.id = job.batch_id
 and batch.property_id = job.property_id
where batch.source_provider = 'autohdr_source_upload'
on conflict do nothing;

create function public.prepare_autohdr_source_batch(
  p_organization_id uuid,
  p_booking_id uuid,
  p_request_id uuid,
  p_created_by uuid,
  p_files jsonb
)
returns table (
  organization_id uuid,
  booking_id uuid,
  property_id uuid,
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
  newly_created boolean,
  quarantine_bucket_name text,
  quarantine_object_key text,
  master_bucket_name text,
  master_object_key text,
  prepared_at timestamptz,
  quarantine_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_created boolean;
begin
  select pg_catalog.bool_or(created.newly_created) into v_created
  from public.create_autohdr_source_batch(
    p_organization_id, p_booking_id, p_request_id, p_created_by, p_files
  ) created;

  return query
  select
    source.organization_id, source.booking_id, source.property_id,
    batch.id, asset.id, version.id, source.ingest_job_id,
    asset.capture_sequence, asset.original_filename,
    version.bucket_name, version.object_key, version.sha256, version.byte_size,
    version.mime_type, v_created,
    source.quarantine_bucket_name, source.quarantine_object_key,
    source.master_bucket_name, source.master_object_key,
    source.prepared_at, source.quarantine_expires_at
  from public.autohdr_source_ingests source
  join public.media_batches batch
    on batch.organization_id = source.organization_id
   and batch.id = source.batch_id
  join public.media_assets asset
    on asset.organization_id = source.organization_id
   and asset.id = source.asset_id
   and asset.batch_id = source.batch_id
  join public.media_versions version
    on version.organization_id = source.organization_id
   and version.id = source.version_id
   and version.asset_id = source.asset_id
  where source.organization_id = p_organization_id
    and source.booking_id = p_booking_id
    and source.request_id = p_request_id
  order by source.position;
end;
$$;

create function public.mark_autohdr_source_quarantined(
  p_organization_id uuid,
  p_booking_id uuid,
  p_batch_id uuid,
  p_asset_id uuid,
  p_version_id uuid,
  p_ingest_job_id uuid,
  p_quarantine_bucket_name text,
  p_quarantine_object_key text,
  p_quarantine_etag text,
  p_sha256 bytea,
  p_byte_size bigint,
  p_mime_type text
)
returns table (
  version_id uuid,
  ingest_job_id uuid,
  lifecycle_state text,
  quarantined_at timestamptz,
  validation_started_at timestamptz,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.autohdr_source_ingests;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_organization_id is null or p_booking_id is null or p_batch_id is null
     or p_asset_id is null or p_version_id is null or p_ingest_job_id is null
     or p_quarantine_bucket_name is null or p_quarantine_object_key is null
     or p_quarantine_etag is null or p_quarantine_etag <> pg_catalog.btrim(p_quarantine_etag)
     or pg_catalog.char_length(p_quarantine_etag) not between 1 and 512
     or p_quarantine_etag ~ '[[:cntrl:]]'
     or p_sha256 is null or pg_catalog.octet_length(p_sha256) <> 32
     or p_byte_size is null or p_mime_type is null then
    raise exception 'Invalid AutoHDR quarantine evidence' using errcode = '22023';
  end if;

  select source.* into v_source
  from public.autohdr_source_ingests source
  where source.organization_id = p_organization_id
    and source.booking_id = p_booking_id
    and source.batch_id = p_batch_id
    and source.asset_id = p_asset_id
    and source.version_id = p_version_id
    and source.ingest_job_id = p_ingest_job_id
  for update;
  if not found then
    raise exception 'AutoHDR quarantine source identity mismatch' using errcode = '23503';
  end if;

  if p_quarantine_bucket_name is distinct from v_source.quarantine_bucket_name
     or p_quarantine_object_key is distinct from v_source.quarantine_object_key
     or p_sha256 is distinct from v_source.expected_sha256
     or p_byte_size is distinct from v_source.expected_byte_size
     or p_mime_type is distinct from v_source.expected_mime_type then
    raise exception 'Quarantine evidence does not match prepared source identity'
      using errcode = '22023';
  end if;

  if v_source.quarantine_etag is not null then
    if p_quarantine_etag is distinct from v_source.quarantine_etag then
      raise exception 'Quarantine ETag drifted from durable source evidence'
        using errcode = '22023';
    end if;
    return query select v_source.version_id, v_source.ingest_job_id,
      v_source.lifecycle_state, v_source.quarantined_at,
      v_source.validation_started_at, v_source.accepted_at;
    return;
  end if;
  if v_source.lifecycle_state <> 'prepared' then
    raise exception 'AutoHDR source is not prepared for quarantine evidence'
      using errcode = '55000';
  end if;
  if v_source.quarantine_expires_at <= v_now then
    raise exception 'AutoHDR quarantine upload identity has expired'
      using errcode = '55000';
  end if;

  update public.media_versions version
    set ingest_state = 'quarantined'
    where version.organization_id = p_organization_id
      and version.id = p_version_id
      and version.ingest_state = 'discovered';
  if not found then
    raise exception 'Canonical source version is not prepared for quarantine'
      using errcode = '55000';
  end if;
  update public.media_ingest_jobs job
    set state = 'quarantined'
    where job.organization_id = p_organization_id
      and job.id = p_ingest_job_id
      and job.source_version_id = p_version_id
      and job.state = 'discovered';
  if not found then
    raise exception 'Canonical source ingest job is not prepared for quarantine'
      using errcode = '55000';
  end if;
  update public.autohdr_source_ingests source
    set lifecycle_state = 'quarantined',
        quarantine_etag = p_quarantine_etag,
        quarantined_at = v_now,
        cleanup_next_attempt_at = greatest(source.cleanup_next_attempt_at, v_now + interval '1 hour')
    where source.organization_id = p_organization_id
      and source.ingest_job_id = p_ingest_job_id
    returning * into v_source;

  return query select v_source.version_id, v_source.ingest_job_id,
    v_source.lifecycle_state, v_source.quarantined_at,
    v_source.validation_started_at, v_source.accepted_at;
end;
$$;

create function public.begin_autohdr_source_validation(
  p_organization_id uuid,
  p_booking_id uuid,
  p_batch_id uuid,
  p_asset_id uuid,
  p_version_id uuid,
  p_ingest_job_id uuid,
  p_quarantine_bucket_name text,
  p_quarantine_object_key text,
  p_quarantine_etag text
)
returns table (
  version_id uuid,
  ingest_job_id uuid,
  lifecycle_state text,
  quarantined_at timestamptz,
  validation_started_at timestamptz,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.autohdr_source_ingests;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select source.* into v_source
  from public.autohdr_source_ingests source
  where source.organization_id = p_organization_id
    and source.booking_id = p_booking_id
    and source.batch_id = p_batch_id
    and source.asset_id = p_asset_id
    and source.version_id = p_version_id
    and source.ingest_job_id = p_ingest_job_id
  for update;
  if not found then
    raise exception 'AutoHDR validation source identity mismatch' using errcode = '23503';
  end if;
  if p_quarantine_bucket_name is distinct from v_source.quarantine_bucket_name
     or p_quarantine_object_key is distinct from v_source.quarantine_object_key
     or p_quarantine_etag is distinct from v_source.quarantine_etag then
    raise exception 'Validation evidence does not match quarantined source identity'
      using errcode = '22023';
  end if;
  if v_source.lifecycle_state in ('validating', 'accepted') then
    return query select v_source.version_id, v_source.ingest_job_id,
      v_source.lifecycle_state, v_source.quarantined_at,
      v_source.validation_started_at, v_source.accepted_at;
    return;
  end if;
  if v_source.lifecycle_state <> 'quarantined' then
    raise exception 'AutoHDR source is not quarantined for validation'
      using errcode = '55000';
  end if;

  update public.media_versions version
    set ingest_state = 'validating'
    where version.organization_id = p_organization_id
      and version.id = p_version_id
      and version.ingest_state = 'quarantined';
  if not found then
    raise exception 'Canonical source version is not quarantined'
      using errcode = '55000';
  end if;
  update public.media_ingest_jobs job
    set state = 'validating'
    where job.organization_id = p_organization_id
      and job.id = p_ingest_job_id
      and job.state = 'quarantined';
  if not found then
    raise exception 'Canonical source ingest job is not quarantined'
      using errcode = '55000';
  end if;
  update public.autohdr_source_ingests source
    set lifecycle_state = 'validating',
        validation_started_at = v_now,
        cleanup_next_attempt_at = greatest(source.cleanup_next_attempt_at, v_now + interval '1 hour')
    where source.organization_id = p_organization_id
      and source.ingest_job_id = p_ingest_job_id
    returning * into v_source;

  return query select v_source.version_id, v_source.ingest_job_id,
    v_source.lifecycle_state, v_source.quarantined_at,
    v_source.validation_started_at, v_source.accepted_at;
end;
$$;

create function public.accept_autohdr_quarantined_source_version(
  p_organization_id uuid,
  p_booking_id uuid,
  p_batch_id uuid,
  p_asset_id uuid,
  p_version_id uuid,
  p_ingest_job_id uuid,
  p_quarantine_bucket_name text,
  p_quarantine_object_key text,
  p_quarantine_etag text,
  p_master_bucket_name text,
  p_master_object_key text,
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
  ingest_completed_at timestamptz,
  quarantined_at timestamptz,
  validation_started_at timestamptz,
  master_promoted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.autohdr_source_ingests;
  v_version public.media_versions;
  v_job public.media_ingest_jobs;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_organization_id is null or p_booking_id is null or p_batch_id is null
     or p_asset_id is null or p_version_id is null or p_ingest_job_id is null
     or p_quarantine_bucket_name is null or p_quarantine_object_key is null
     or p_quarantine_etag is null or p_master_bucket_name is null
     or p_master_object_key is null or p_sha256 is null
     or pg_catalog.octet_length(p_sha256) <> 32
     or p_byte_size is null or p_mime_type is null
     or p_verified_width_px is null or p_verified_height_px is null
     or p_verified_width_px not between 1 and 100000
     or p_verified_height_px not between 1 and 100000 then
    raise exception 'Invalid AutoHDR accepted source evidence' using errcode = '22023';
  end if;

  select source.* into v_source
  from public.autohdr_source_ingests source
  where source.organization_id = p_organization_id
    and source.booking_id = p_booking_id
    and source.batch_id = p_batch_id
    and source.asset_id = p_asset_id
    and source.version_id = p_version_id
    and source.ingest_job_id = p_ingest_job_id
  for update;
  if not found then
    raise exception 'AutoHDR accepted source identity mismatch' using errcode = '23503';
  end if;

  select version.* into v_version
  from public.media_versions version
  where version.organization_id = p_organization_id
    and version.id = p_version_id
    and version.asset_id = p_asset_id
    and version.batch_id = p_batch_id
    and version.property_id = v_source.property_id
  for update;
  if not found then
    raise exception 'Canonical accepted source version identity mismatch' using errcode = '23503';
  end if;
  select job.* into v_job
  from public.media_ingest_jobs job
  where job.organization_id = p_organization_id
    and job.id = p_ingest_job_id
    and job.source_version_id = p_version_id
    and job.batch_id = p_batch_id
    and job.property_id = v_source.property_id
  for update;
  if not found then
    raise exception 'Canonical accepted source job identity mismatch' using errcode = '23503';
  end if;

  if p_quarantine_bucket_name is distinct from v_source.quarantine_bucket_name
     or p_quarantine_object_key is distinct from v_source.quarantine_object_key
     or p_quarantine_etag is distinct from v_source.quarantine_etag
     or p_master_bucket_name is distinct from v_source.master_bucket_name
     or p_master_object_key is distinct from v_source.master_object_key
     or p_sha256 is distinct from v_source.expected_sha256
     or p_byte_size is distinct from v_source.expected_byte_size
     or p_mime_type is distinct from v_source.expected_mime_type
     or p_master_bucket_name is distinct from v_version.bucket_name
     or p_master_object_key is distinct from v_version.object_key
     or p_sha256 is distinct from v_version.sha256
     or p_byte_size is distinct from v_version.byte_size
     or p_mime_type is distinct from v_version.mime_type then
    raise exception 'Accepted source evidence drifted from quarantine/master identity'
      using errcode = '22023';
  end if;

  if v_source.lifecycle_state = 'accepted' then
    if p_verified_width_px is distinct from v_source.verified_width_px
       or p_verified_height_px is distinct from v_source.verified_height_px
       or p_verified_width_px is distinct from v_version.width_px
       or p_verified_height_px is distinct from v_version.height_px
       or v_version.ingest_state <> 'accepted' or v_version.accepted_at is null
       or v_job.state <> 'accepted' or v_job.completed_at is null then
      raise exception 'Accepted source replay evidence drifted'
        using errcode = '22023';
    end if;
    return query select
      v_version.id, v_version.ingest_state, v_version.accepted_at,
      v_job.id, v_job.state, v_job.completed_at,
      v_source.quarantined_at, v_source.validation_started_at, v_source.master_promoted_at;
    return;
  end if;
  if v_source.lifecycle_state <> 'validating'
     or v_version.ingest_state <> 'validating'
     or v_job.state <> 'validating' then
    raise exception 'AutoHDR source is not validating for acceptance'
      using errcode = '55000';
  end if;

  update public.media_versions version
    set ingest_state = 'accepted',
        width_px = p_verified_width_px,
        height_px = p_verified_height_px,
        accepted_at = v_now
    where version.organization_id = p_organization_id
      and version.id = p_version_id
    returning * into v_version;
  update public.media_ingest_jobs job
    set state = 'accepted', completed_at = v_now
    where job.organization_id = p_organization_id
      and job.id = p_ingest_job_id
    returning * into v_job;
  update public.autohdr_source_ingests source
    set lifecycle_state = 'accepted',
        verified_width_px = p_verified_width_px,
        verified_height_px = p_verified_height_px,
        master_promoted_at = v_now,
        accepted_at = v_now,
        cleanup_lease_token = null,
        cleanup_lease_expires_at = null
    where source.organization_id = p_organization_id
      and source.ingest_job_id = p_ingest_job_id
    returning * into v_source;

  return query select
    v_version.id, v_version.ingest_state, v_version.accepted_at,
    v_job.id, v_job.state, v_job.completed_at,
    v_source.quarantined_at, v_source.validation_started_at, v_source.master_promoted_at;
end;
$$;

-- The original signature is retained as a compatibility boundary, but it can
-- no longer manufacture intermediate states. It succeeds only after the new
-- quarantine and validation RPCs have stored exact evidence.
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
declare v_source public.autohdr_source_ingests;
begin
  select source.* into v_source
  from public.autohdr_source_ingests source
  where source.organization_id = p_organization_id
    and source.booking_id = p_booking_id
    and source.batch_id = p_batch_id
    and source.asset_id = p_asset_id
    and source.version_id = p_version_id
    and source.ingest_job_id = p_ingest_job_id;
  if not found or v_source.quarantine_etag is null then
    raise exception 'Quarantine validation evidence is required before source acceptance'
      using errcode = '55000';
  end if;
  return query
  select accepted.version_id, accepted.ingest_state, accepted.accepted_at,
         accepted.ingest_job_id, accepted.ingest_job_state, accepted.ingest_completed_at
  from public.accept_autohdr_quarantined_source_version(
    p_organization_id, p_booking_id, p_batch_id, p_asset_id, p_version_id, p_ingest_job_id,
    v_source.quarantine_bucket_name, v_source.quarantine_object_key, v_source.quarantine_etag,
    p_bucket_name, p_object_key, p_sha256, p_byte_size, p_mime_type,
    p_verified_width_px, p_verified_height_px
  ) accepted;
end;
$$;

create function public.claim_abandoned_autohdr_source_quarantine(
  p_limit integer,
  p_lease_seconds integer
)
returns table (
  organization_id uuid,
  booking_id uuid,
  property_id uuid,
  batch_id uuid,
  asset_id uuid,
  version_id uuid,
  ingest_job_id uuid,
  quarantine_bucket_name text,
  quarantine_object_key text,
  quarantine_etag text,
  cleanup_object_etag text,
  cleanup_attempts integer,
  cleanup_lease_token uuid,
  cleanup_lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100
     or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'Invalid abandoned quarantine claim bounds' using errcode = '22023';
  end if;
  return query
  with due as (
    select source.organization_id, source.ingest_job_id
    from public.autohdr_source_ingests source
    where source.cleanup_settled_at is null
      and source.lifecycle_state in ('prepared', 'quarantined', 'validating', 'reconciliation_required')
      and source.quarantine_expires_at <= pg_catalog.clock_timestamp()
      and source.cleanup_next_attempt_at <= pg_catalog.clock_timestamp()
      and (source.cleanup_lease_expires_at is null
        or source.cleanup_lease_expires_at <= pg_catalog.clock_timestamp())
    order by source.cleanup_next_attempt_at, source.prepared_at, source.ingest_job_id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.autohdr_source_ingests source
      set cleanup_attempts = source.cleanup_attempts + 1,
          cleanup_lease_token = extensions.gen_random_uuid(),
          cleanup_lease_expires_at = pg_catalog.clock_timestamp() +
            pg_catalog.make_interval(secs => p_lease_seconds)
    from due
    where source.organization_id = due.organization_id
      and source.ingest_job_id = due.ingest_job_id
      and source.cleanup_attempts < 100
    returning source.*
  )
  select
    claimed.organization_id, claimed.booking_id, claimed.property_id,
    claimed.batch_id, claimed.asset_id, claimed.version_id, claimed.ingest_job_id,
    claimed.quarantine_bucket_name, claimed.quarantine_object_key,
    claimed.quarantine_etag, claimed.cleanup_object_etag, claimed.cleanup_attempts,
    claimed.cleanup_lease_token, claimed.cleanup_lease_expires_at
  from claimed
  order by claimed.cleanup_next_attempt_at, claimed.prepared_at, claimed.ingest_job_id;
end;
$$;

create function public.settle_autohdr_source_quarantine_cleanup(
  p_organization_id uuid,
  p_booking_id uuid,
  p_property_id uuid,
  p_ingest_job_id uuid,
  p_quarantine_object_key text,
  p_quarantine_etag text,
  p_cleanup_lease_token uuid,
  p_outcome text,
  p_error_code text
)
returns table (
  ingest_job_id uuid,
  lifecycle_state text,
  cleanup_next_attempt_at timestamptz,
  cleanup_settled_at timestamptz,
  cleanup_outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.autohdr_source_ingests;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_organization_id is null or p_booking_id is null or p_property_id is null
     or p_ingest_job_id is null or p_quarantine_object_key is null
     or p_cleanup_lease_token is null
     or p_outcome is null
     or p_outcome not in ('cleaned', 'not_found', 'retryable', 'reconciliation_required')
     or (p_quarantine_etag is not null and (
       p_quarantine_etag <> pg_catalog.btrim(p_quarantine_etag)
       or pg_catalog.char_length(p_quarantine_etag) not between 1 and 512
       or p_quarantine_etag ~ '[[:cntrl:]]'
     ))
     or (p_outcome in ('retryable', 'reconciliation_required') and (
       p_error_code is null or p_error_code <> pg_catalog.btrim(p_error_code)
       or pg_catalog.char_length(p_error_code) not between 1 and 96
       or p_error_code ~ '[[:cntrl:]]'
     ))
     or (p_outcome in ('cleaned', 'not_found') and p_error_code is not null)
     or (p_outcome = 'cleaned' and p_quarantine_etag is null)
     or (p_outcome = 'not_found' and p_quarantine_etag is not null) then
    raise exception 'Invalid quarantine cleanup settlement' using errcode = '22023';
  end if;

  select source.* into v_source
  from public.autohdr_source_ingests source
  where source.organization_id = p_organization_id
    and source.booking_id = p_booking_id
    and source.property_id = p_property_id
    and source.ingest_job_id = p_ingest_job_id
    and source.quarantine_object_key = p_quarantine_object_key
  for update;
  if not found then
    raise exception 'Quarantine cleanup source identity mismatch' using errcode = '23503';
  end if;
  if v_source.cleanup_lease_token is distinct from p_cleanup_lease_token
     or v_source.cleanup_lease_expires_at is null
     or v_source.cleanup_lease_expires_at <= v_now then
    raise exception 'Quarantine cleanup lease is missing, stale, or fenced'
      using errcode = '55000';
  end if;
  if coalesce(v_source.quarantine_etag, v_source.cleanup_object_etag) is not null
     and p_quarantine_etag is not null
     and coalesce(v_source.quarantine_etag, v_source.cleanup_object_etag) is distinct from p_quarantine_etag then
    raise exception 'Quarantine cleanup ETag drifted from stored evidence'
      using errcode = '22023';
  end if;

  if p_outcome in ('cleaned', 'not_found') then
    if v_source.lifecycle_state <> 'reconciliation_required' then
      update public.media_versions version
        set ingest_state = 'reconciliation_required'
        where version.organization_id = p_organization_id
          and version.id = v_source.version_id;
      update public.media_ingest_jobs job
        set state = 'reconciliation_required',
            last_error_code = 'abandoned_quarantine_settled',
            last_error_at = v_now
        where job.organization_id = p_organization_id
          and job.id = p_ingest_job_id;
    end if;
    update public.autohdr_source_ingests source
      set lifecycle_state = 'reconciliation_required',
          reconciliation_required_at = coalesce(source.reconciliation_required_at, v_now),
          cleanup_object_etag = p_quarantine_etag,
          cleanup_settled_at = v_now,
          cleanup_outcome = p_outcome,
          cleanup_lease_token = null,
          cleanup_lease_expires_at = null,
          last_error_code = 'abandoned_quarantine_settled',
          last_error_at = v_now
      where source.organization_id = p_organization_id
        and source.ingest_job_id = p_ingest_job_id
      returning * into v_source;
  elsif p_outcome = 'retryable' then
    update public.autohdr_source_ingests source
      set cleanup_next_attempt_at = v_now + interval '5 minutes',
          cleanup_lease_token = null,
          cleanup_lease_expires_at = null,
          last_error_code = p_error_code,
          last_error_at = v_now
      where source.organization_id = p_organization_id
        and source.ingest_job_id = p_ingest_job_id
      returning * into v_source;
  else
    if v_source.lifecycle_state <> 'reconciliation_required' then
      update public.media_versions version
        set ingest_state = 'reconciliation_required'
        where version.organization_id = p_organization_id
          and version.id = v_source.version_id;
      update public.media_ingest_jobs job
        set state = 'reconciliation_required',
            last_error_code = p_error_code,
            last_error_at = v_now
        where job.organization_id = p_organization_id
          and job.id = p_ingest_job_id;
    end if;
    update public.autohdr_source_ingests source
      set lifecycle_state = 'reconciliation_required',
          reconciliation_required_at = coalesce(source.reconciliation_required_at, v_now),
          cleanup_next_attempt_at = v_now + interval '1 day',
          cleanup_lease_token = null,
          cleanup_lease_expires_at = null,
          last_error_code = p_error_code,
          last_error_at = v_now
      where source.organization_id = p_organization_id
        and source.ingest_job_id = p_ingest_job_id
      returning * into v_source;
  end if;

  return query select v_source.ingest_job_id, v_source.lifecycle_state,
    v_source.cleanup_next_attempt_at, v_source.cleanup_settled_at, v_source.cleanup_outcome;
end;
$$;

alter table public.autohdr_source_ingests enable row level security;
alter table public.autohdr_source_ingests force row level security;

revoke all on table public.autohdr_source_ingests from public, anon, authenticated, service_role;
grant select on table public.autohdr_source_ingests to service_role;

revoke all on function public.is_valid_autohdr_source_transition(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_autohdr_source_ingest_evidence()
  from public, anon, authenticated, service_role;
revoke all on function public.seed_autohdr_source_ingest_identity()
  from public, anon, authenticated, service_role;
revoke all on function public.create_autohdr_source_batch(uuid, uuid, uuid, uuid, jsonb)
  from service_role;
revoke all on function public.prepare_autohdr_source_batch(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.mark_autohdr_source_quarantined(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, bytea, bigint, text)
  from public, anon, authenticated;
revoke all on function public.begin_autohdr_source_validation(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.accept_autohdr_quarantined_source_version(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, bytea, bigint, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.claim_abandoned_autohdr_source_quarantine(integer, integer)
  from public, anon, authenticated;
revoke all on function public.settle_autohdr_source_quarantine_cleanup(uuid, uuid, uuid, uuid, text, text, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.prepare_autohdr_source_batch(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.mark_autohdr_source_quarantined(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, bytea, bigint, text)
  to service_role;
grant execute on function public.begin_autohdr_source_validation(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.accept_autohdr_quarantined_source_version(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, bytea, bigint, text, integer, integer)
  to service_role;
grant execute on function public.claim_abandoned_autohdr_source_quarantine(integer, integer)
  to service_role;
grant execute on function public.settle_autohdr_source_quarantine_cleanup(uuid, uuid, uuid, uuid, text, text, uuid, text, text)
  to service_role;

comment on table public.autohdr_source_ingests is
  'Service-only durable quarantine/master identities, truthful lifecycle evidence, and fenced cleanup recovery for AutoHDR browser sources.';
comment on function public.prepare_autohdr_source_batch(uuid, uuid, uuid, uuid, jsonb) is
  'Service-only idempotent preparation returning a random quarantine key and separately preserved deterministic master key.';
comment on function public.claim_abandoned_autohdr_source_quarantine(integer, integer) is
  'Service-only bounded due-list claim; object deletion remains an application responsibility and requires lease-fenced settlement.';
