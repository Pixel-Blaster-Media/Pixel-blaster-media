-- Canonical Release 1 media control plane.
-- Additive and code-dark: no application path writes these tables yet.

create unique index if not exists properties_organization_id_id_idx
  on public.properties (organization_id, id);
create unique index if not exists bookings_organization_id_id_property_id_idx
  on public.bookings (organization_id, id, property_id);
create unique index if not exists profiles_organization_id_id_idx
  on public.profiles (organization_id, id);
create unique index if not exists listing_websites_organization_id_id_property_id_idx
  on public.listing_websites (organization_id, id, property_id);

create table public.media_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  booking_id uuid not null,
  source_provider text not null,
  provider_connection_key text not null,
  provider_job_id text not null,
  provider_revision integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint media_batches_provider_check check (
    source_provider = pg_catalog.btrim(source_provider)
    and pg_catalog.char_length(source_provider) between 1 and 96
    and provider_connection_key = pg_catalog.btrim(provider_connection_key)
    and pg_catalog.char_length(provider_connection_key) between 1 and 255
    and provider_job_id = pg_catalog.btrim(provider_job_id)
    and pg_catalog.char_length(provider_job_id) between 1 and 255
    and provider_revision >= 0
  ),
  constraint media_batches_organization_id_id_key unique (organization_id, id),
  constraint media_batches_org_id_property_id_key
    unique (organization_id, id, property_id),
  constraint media_batches_org_id_property_id_booking_id_key
    unique (organization_id, id, property_id, booking_id),
  constraint media_batches_provider_identity_key
    unique (
      organization_id, source_provider, provider_connection_key,
      provider_job_id, provider_revision
    ),
  constraint media_batches_provider_anchor_key
    unique (
      organization_id, id, property_id, source_provider,
      provider_connection_key, provider_job_id, provider_revision
    ),
  constraint media_batches_property_fkey
    foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete restrict,
  constraint media_batches_booking_fkey
    foreign key (organization_id, booking_id, property_id)
    references public.bookings (organization_id, id, property_id) on delete restrict,
  constraint media_batches_created_by_fkey
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete restrict
);

create table public.media_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  source_provider text not null,
  provider_connection_key text not null,
  provider_job_id text not null,
  provider_output_id text not null,
  provider_revision integer not null default 0,
  media_kind text not null default 'image',
  original_filename text,
  capture_sequence integer,
  created_at timestamptz not null default now(),
  constraint media_assets_provider_check check (
    source_provider = pg_catalog.btrim(source_provider)
    and pg_catalog.char_length(source_provider) between 1 and 96
    and provider_connection_key = pg_catalog.btrim(provider_connection_key)
    and pg_catalog.char_length(provider_connection_key) between 1 and 255
    and provider_job_id = pg_catalog.btrim(provider_job_id)
    and pg_catalog.char_length(provider_job_id) between 1 and 255
    and provider_output_id = pg_catalog.btrim(provider_output_id)
    and pg_catalog.char_length(provider_output_id) between 1 and 255
    and provider_revision >= 0
  ),
  constraint media_assets_kind_check
    check (media_kind in ('image', 'video', 'floor_plan', 'document')),
  constraint media_assets_filename_check check (
    original_filename is null or (
      pg_catalog.char_length(original_filename) between 1 and 255
      and original_filename !~ '[\\/[:cntrl:]]'
    )
  ),
  constraint media_assets_sequence_check check (capture_sequence is null or capture_sequence >= 0),
  constraint media_assets_organization_id_id_key unique (organization_id, id),
  constraint media_assets_anchor_key unique (organization_id, id, property_id, batch_id),
  constraint media_assets_provider_output_key unique (
    organization_id, provider_connection_key, provider_job_id,
    provider_output_id, provider_revision
  ),
  constraint media_assets_batch_output_key
    unique (organization_id, batch_id, provider_output_id, provider_revision),
  constraint media_assets_batch_fkey foreign key (
    organization_id, batch_id, property_id, source_provider,
    provider_connection_key, provider_job_id, provider_revision
  ) references public.media_batches (
    organization_id, id, property_id, source_provider,
    provider_connection_key, provider_job_id, provider_revision
  ) on delete restrict
);

create table public.media_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  asset_id uuid not null,
  version_number integer not null,
  parent_version_id uuid,
  ingest_state text not null default 'discovered',
  object_tier text,
  bucket_name text,
  object_key text,
  sha256 bytea,
  byte_size bigint,
  mime_type text,
  width_px integer,
  height_px integer,
  edit_class text not null default 'original',
  disclosure_class text not null default 'none',
  rights_effective_at timestamptz,
  rights_expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint media_versions_number_check check (version_number >= 1),
  constraint media_versions_ingest_state_check check (ingest_state in (
    'discovered', 'url_ready', 'fetching', 'quarantined', 'validating', 'scanning',
    'accepted', 'deriving', 'review_pending', 'retryable', 'source_expired',
    'reconciliation_required', 'rejected', 'dead_letter'
  )),
  constraint media_versions_object_tier_check
    check (object_tier is null or object_tier in ('quarantine', 'master')),
  constraint media_versions_edit_class_check
    check (edit_class in ('original', 'corrective', 'hdr', 'virtual_staging', 'generative')),
  constraint media_versions_disclosure_class_check
    check (disclosure_class in ('none', 'virtually_staged', 'material_edit')),
  constraint media_versions_rights_check
    check (rights_expires_at is null or rights_effective_at is null or rights_expires_at > rights_effective_at),
  constraint media_versions_dimensions_check check (
    (byte_size is null or byte_size > 0)
    and (width_px is null or width_px > 0)
    and (height_px is null or height_px > 0)
  ),
  constraint media_versions_sha256_check
    check (sha256 is null or pg_catalog.octet_length(sha256) = 32),
  constraint media_versions_object_key_check check (
    object_key is null or (
      pg_catalog.char_length(object_key) between 1 and 1024
      and object_key !~ '(^|/)\.\.(/|$)'
      and object_key !~ '(^/|[\\[:cntrl:]])'
    )
  ),
  constraint media_versions_accepted_check check (
    (accepted_at is null and ingest_state not in ('accepted', 'deriving', 'review_pending'))
    or (
      accepted_at is not null
      and ingest_state in ('accepted', 'deriving', 'review_pending', 'reconciliation_required')
      and object_tier = 'master'
      and bucket_name is not null and pg_catalog.char_length(bucket_name) between 1 and 255
      and object_key is not null and sha256 is not null and byte_size is not null
      and mime_type is not null and pg_catalog.char_length(mime_type) between 1 and 255
      and width_px is not null and height_px is not null
    )
  ),
  constraint media_versions_organization_id_id_key unique (organization_id, id),
  constraint media_versions_asset_revision_key unique (organization_id, asset_id, version_number),
  constraint media_versions_anchor_key unique (organization_id, id, asset_id, property_id, batch_id),
  constraint media_versions_release_anchor_key unique (organization_id, id, property_id, batch_id),
  constraint media_versions_asset_fkey foreign key (
    organization_id, asset_id, property_id, batch_id
  ) references public.media_assets (
    organization_id, id, property_id, batch_id
  ) on delete restrict,
  constraint media_versions_parent_fkey foreign key (
    organization_id, parent_version_id, asset_id, property_id, batch_id
  ) references public.media_versions (
    organization_id, id, asset_id, property_id, batch_id
  ) on delete restrict
);

create unique index media_versions_accepted_sha256_idx
  on public.media_versions (organization_id, sha256)
  where accepted_at is not null;

create table public.media_derivatives (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  source_version_id uuid not null,
  profile_id text not null,
  profile_version integer not null,
  derivative_class text not null,
  profile_status text not null,
  status text not null default 'queued',
  bucket_name text,
  object_key text,
  sha256 bytea,
  byte_size bigint,
  mime_type text,
  width_px integer,
  height_px integer,
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_derivatives_profile_id_check check (profile_id in (
    'original.camera.v1', 'client.fullres.share.v1',
    'ontario.proptx.provisional.2026-08-11.v1',
    'web.listing.320.v1', 'web.listing.640.v1', 'web.listing.1280.v1',
    'web.listing.2048.v1', 'thumbnail.admin.320.v1'
  )),
  constraint media_derivatives_profile_version_check check (profile_version >= 1),
  constraint media_derivatives_class_check
    check (derivative_class in ('master', 'full_res', 'mls', 'web', 'thumbnail')),
  constraint media_derivatives_profile_status_check
    check (profile_status in ('defined', 'provisional')),
  constraint media_derivatives_status_check check (
    status in ('queued', 'processing', 'ready', 'retryable', 'rejected', 'dead_letter')
  ),
  constraint media_derivatives_sha256_check
    check (sha256 is null or pg_catalog.octet_length(sha256) = 32),
  constraint media_derivatives_dimensions_check check (
    (byte_size is null or byte_size > 0)
    and (width_px is null or width_px > 0)
    and (height_px is null or height_px > 0)
  ),
  constraint media_derivatives_object_key_check check (
    object_key is null or (
      pg_catalog.char_length(object_key) between 1 and 1024
      and object_key !~ '(^|/)\.\.(/|$)'
      and object_key !~ '(^/|[\\[:cntrl:]])'
    )
  ),
  constraint media_derivatives_ready_check check (
    (status <> 'ready' and ready_at is null)
    or (
      status = 'ready' and ready_at is not null
      and bucket_name is not null and object_key is not null
      and sha256 is not null and byte_size is not null and mime_type is not null
      and width_px is not null and height_px is not null
    )
  ),
  constraint media_derivatives_organization_id_id_key unique (organization_id, id),
  constraint media_derivatives_profile_key unique (
    organization_id, source_version_id, profile_id, profile_version
  ),
  constraint media_derivatives_anchor_key unique (
    organization_id, id, source_version_id, property_id, batch_id
  ),
  constraint media_derivatives_source_fkey foreign key (
    organization_id, source_version_id, property_id, batch_id
  ) references public.media_versions (
    organization_id, id, property_id, batch_id
  ) on delete restrict
);

create table public.provider_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  provider text not null,
  provider_connection_key text not null,
  provider_event_id text not null,
  event_type text not null,
  batch_id uuid,
  payload_sha256 bytea not null,
  payload_redacted jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  constraint provider_events_identity_check check (
    provider = pg_catalog.btrim(provider) and pg_catalog.char_length(provider) between 1 and 96
    and provider_connection_key = pg_catalog.btrim(provider_connection_key)
    and pg_catalog.char_length(provider_connection_key) between 1 and 255
    and provider_event_id = pg_catalog.btrim(provider_event_id)
    and pg_catalog.char_length(provider_event_id) between 1 and 255
    and event_type = pg_catalog.btrim(event_type)
    and pg_catalog.char_length(event_type) between 1 and 128
  ),
  constraint provider_events_payload_check check (
    pg_catalog.octet_length(payload_sha256) = 32
    and pg_catalog.jsonb_typeof(payload_redacted) = 'object'
    and pg_catalog.octet_length(payload_redacted::text) <= 65536
  ),
  constraint provider_events_organization_id_id_key unique (organization_id, id),
  constraint provider_events_external_key unique (
    organization_id, provider, provider_connection_key, provider_event_id
  ),
  constraint provider_events_batch_fkey foreign key (organization_id, batch_id)
    references public.media_batches (organization_id, id) on delete restrict
);

create table public.media_ingest_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  provider_event_id uuid,
  job_kind text not null,
  idempotency_key text not null,
  state text not null default 'discovered',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  last_error_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_ingest_jobs_kind_check check (job_kind in ('ingest', 'derive', 'package')),
  constraint media_ingest_jobs_state_check check (state in (
    'discovered', 'url_ready', 'fetching', 'quarantined', 'validating', 'scanning',
    'accepted', 'deriving', 'review_pending', 'retryable', 'source_expired',
    'reconciliation_required', 'rejected', 'dead_letter'
  )),
  constraint media_ingest_jobs_attempts_check
    check (max_attempts between 1 and 100 and attempts between 0 and max_attempts),
  constraint media_ingest_jobs_idempotency_check
    check (idempotency_key = pg_catalog.btrim(idempotency_key) and pg_catalog.char_length(idempotency_key) between 1 and 255),
  constraint media_ingest_jobs_error_check
    check (last_error_code is null or pg_catalog.char_length(last_error_code) between 1 and 96),
  constraint media_ingest_jobs_terminal_check check (
    state not in ('review_pending', 'rejected', 'dead_letter') or completed_at is not null
  ),
  constraint media_ingest_jobs_organization_id_id_key unique (organization_id, id),
  constraint media_ingest_jobs_idempotency_key unique (organization_id, idempotency_key),
  constraint media_ingest_jobs_anchor_key unique (organization_id, id, property_id, batch_id),
  constraint media_ingest_jobs_batch_fkey foreign key (organization_id, batch_id, property_id)
    references public.media_batches (organization_id, id, property_id) on delete restrict,
  constraint media_ingest_jobs_provider_event_fkey foreign key (organization_id, provider_event_id)
    references public.provider_events (organization_id, id) on delete restrict
);

create table public.media_job_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  job_id uuid not null,
  attempt_number integer not null,
  worker_id text not null,
  outcome text not null,
  error_code text,
  started_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint media_job_attempts_number_check check (attempt_number >= 1),
  constraint media_job_attempts_worker_check
    check (worker_id = pg_catalog.btrim(worker_id) and pg_catalog.char_length(worker_id) between 1 and 96),
  constraint media_job_attempts_outcome_check check (
    outcome in ('processing', 'succeeded', 'retryable', 'reconciliation_required', 'rejected', 'dead_letter')
  ),
  constraint media_job_attempts_finished_check check (
    (outcome = 'processing' and finished_at is null)
    or (outcome <> 'processing' and finished_at is not null and finished_at >= started_at)
  ),
  constraint media_job_attempts_error_check
    check (error_code is null or pg_catalog.char_length(error_code) between 1 and 96),
  constraint media_job_attempts_organization_id_id_key unique (organization_id, id),
  constraint media_job_attempts_number_key unique (organization_id, job_id, attempt_number),
  constraint media_job_attempts_job_fkey foreign key (organization_id, job_id, property_id, batch_id)
    references public.media_ingest_jobs (organization_id, id, property_id, batch_id) on delete restrict
);

create table public.gallery_releases (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  revision_number integer not null,
  supersedes_release_id uuid,
  state text not null default 'draft',
  manifest_version integer not null default 1,
  manifest jsonb,
  manifest_sha256 bytea,
  approved_by uuid,
  approved_at timestamptz,
  withdrawn_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gallery_releases_revision_check check (revision_number >= 1 and manifest_version >= 1),
  constraint gallery_releases_state_check check (state in (
    'draft', 'review_pending', 'changes_requested', 'revision_processing',
    'approved', 'packaging', 'ready', 'published', 'superseded', 'withdrawn'
  )),
  constraint gallery_releases_manifest_check check (
    manifest is null or (
      pg_catalog.jsonb_typeof(manifest) = 'object'
      and pg_catalog.octet_length(manifest::text) <= 1048576
    )
  ),
  constraint gallery_releases_hash_check
    check (manifest_sha256 is null or pg_catalog.octet_length(manifest_sha256) = 32),
  constraint gallery_releases_approval_check check (
    state not in ('approved', 'packaging', 'ready', 'published', 'superseded') or (
      manifest is not null and manifest_sha256 is not null
      and approved_by is not null and approved_at is not null
    )
  ),
  constraint gallery_releases_withdrawal_check check (
    (state = 'withdrawn' and withdrawn_at is not null)
    or (state <> 'withdrawn' and withdrawn_at is null)
  ),
  constraint gallery_releases_organization_id_id_key unique (organization_id, id),
  constraint gallery_releases_revision_key
    unique (organization_id, property_id, batch_id, revision_number),
  constraint gallery_releases_anchor_key unique (organization_id, id, property_id, batch_id),
  constraint gallery_releases_manifest_anchor_key
    unique (organization_id, id, property_id, batch_id, manifest_sha256),
  constraint gallery_releases_batch_fkey foreign key (organization_id, batch_id, property_id)
    references public.media_batches (organization_id, id, property_id) on delete restrict,
  constraint gallery_releases_supersedes_fkey foreign key (
    organization_id, supersedes_release_id, property_id, batch_id
  ) references public.gallery_releases (
    organization_id, id, property_id, batch_id
  ) on delete restrict,
  constraint gallery_releases_approved_by_fkey foreign key (organization_id, approved_by)
    references public.profiles (organization_id, id) on delete restrict,
  constraint gallery_releases_created_by_fkey foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete restrict
);

create table public.gallery_release_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  release_id uuid not null,
  media_version_id uuid not null,
  display_derivative_id uuid not null,
  download_derivative_id uuid,
  position integer not null,
  display_filename text not null,
  alt_text text,
  approval_state text not null default 'pending',
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint gallery_release_items_position_check check (position >= 0),
  constraint gallery_release_items_filename_check check (
    pg_catalog.char_length(display_filename) between 1 and 255
    and display_filename !~ '[\\/[:cntrl:]]'
  ),
  constraint gallery_release_items_alt_text_check
    check (alt_text is null or pg_catalog.char_length(alt_text) <= 500),
  constraint gallery_release_items_approval_state_check
    check (approval_state in ('pending', 'approved', 'rejected')),
  constraint gallery_release_items_approval_check check (
    (approval_state = 'approved' and approved_by is not null and approved_at is not null)
    or (approval_state <> 'approved' and approved_by is null and approved_at is null)
  ),
  constraint gallery_release_items_organization_id_id_key unique (organization_id, id),
  constraint gallery_release_items_position_key unique (organization_id, release_id, position),
  constraint gallery_release_items_version_key unique (organization_id, release_id, media_version_id),
  constraint gallery_release_items_anchor_key unique (
    organization_id, id, release_id, property_id, batch_id,
    media_version_id, display_derivative_id
  ),
  constraint gallery_release_items_release_fkey foreign key (
    organization_id, release_id, property_id, batch_id
  ) references public.gallery_releases (
    organization_id, id, property_id, batch_id
  ) on delete restrict,
  constraint gallery_release_items_version_fkey foreign key (
    organization_id, media_version_id, property_id, batch_id
  ) references public.media_versions (
    organization_id, id, property_id, batch_id
  ) on delete restrict,
  constraint gallery_release_items_display_derivative_fkey foreign key (
    organization_id, display_derivative_id, media_version_id, property_id, batch_id
  ) references public.media_derivatives (
    organization_id, id, source_version_id, property_id, batch_id
  ) on delete restrict,
  constraint gallery_release_items_download_derivative_fkey foreign key (
    organization_id, download_derivative_id, media_version_id, property_id, batch_id
  ) references public.media_derivatives (
    organization_id, id, source_version_id, property_id, batch_id
  ) on delete restrict,
  constraint gallery_release_items_approved_by_fkey foreign key (organization_id, approved_by)
    references public.profiles (organization_id, id) on delete restrict
);

create table public.media_packages (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  release_id uuid not null,
  package_type text not null,
  manifest_sha256 bytea not null,
  status text not null default 'queued',
  bucket_name text,
  object_key text,
  package_sha256 bytea,
  byte_size bigint,
  entry_count integer,
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_packages_type_check check (package_type in ('full_res_zip', 'mls_zip')),
  constraint media_packages_status_check check (
    status in ('queued', 'building', 'ready', 'retryable', 'reconciliation_required', 'failed', 'dead_letter')
  ),
  constraint media_packages_hash_check check (
    pg_catalog.octet_length(manifest_sha256) = 32
    and (package_sha256 is null or pg_catalog.octet_length(package_sha256) = 32)
  ),
  constraint media_packages_size_check check (
    (byte_size is null or byte_size > 0) and (entry_count is null or entry_count >= 0)
  ),
  constraint media_packages_object_key_check check (
    object_key is null or (
      pg_catalog.char_length(object_key) between 1 and 1024
      and object_key !~ '(^|/)\.\.(/|$)'
      and object_key !~ '(^/|[\\[:cntrl:]])'
    )
  ),
  constraint media_packages_ready_check check (
    (status <> 'ready' and ready_at is null)
    or (
      status = 'ready' and ready_at is not null
      and bucket_name is not null and object_key is not null
      and package_sha256 is not null and byte_size is not null and entry_count is not null
    )
  ),
  constraint media_packages_organization_id_id_key unique (organization_id, id),
  constraint media_packages_release_manifest_key
    unique (organization_id, release_id, package_type, manifest_sha256),
  constraint media_packages_anchor_key unique (
    organization_id, id, release_id, property_id, batch_id
  ),
  constraint media_packages_release_fkey foreign key (
    organization_id, release_id, property_id, batch_id, manifest_sha256
  ) references public.gallery_releases (
    organization_id, id, property_id, batch_id, manifest_sha256
  ) on delete restrict
);

create table public.download_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  release_id uuid not null,
  package_id uuid not null,
  grantee_profile_id uuid,
  grantee_email_hash bytea,
  token_key_id text not null,
  token_hash bytea not null,
  expires_at timestamptz not null,
  max_resolutions integer not null default 1,
  resolution_count integer not null default 0,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint download_grants_principal_check check (
    (grantee_profile_id is not null) <> (grantee_email_hash is not null)
  ),
  constraint download_grants_email_hash_check
    check (grantee_email_hash is null or pg_catalog.octet_length(grantee_email_hash) = 32),
  constraint download_grants_token_key_check
    check (token_key_id = pg_catalog.btrim(token_key_id) and pg_catalog.char_length(token_key_id) between 1 and 96),
  constraint download_grants_token_hash_check
    check (pg_catalog.octet_length(token_hash) = 32),
  constraint download_grants_expiry_check check (expires_at > created_at),
  constraint download_grants_count_check check (
    max_resolutions between 1 and 1000 and resolution_count between 0 and max_resolutions
  ),
  constraint download_grants_organization_id_id_key unique (organization_id, id),
  constraint download_grants_token_key unique (token_key_id, token_hash),
  constraint download_grants_anchor_key unique (
    organization_id, id, package_id, release_id, property_id, batch_id
  ),
  constraint download_grants_package_fkey foreign key (
    organization_id, package_id, release_id, property_id, batch_id
  ) references public.media_packages (
    organization_id, id, release_id, property_id, batch_id
  ) on delete restrict,
  constraint download_grants_grantee_fkey foreign key (organization_id, grantee_profile_id)
    references public.profiles (organization_id, id) on delete restrict,
  constraint download_grants_created_by_fkey foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete restrict
);

create table public.download_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  property_id uuid not null,
  batch_id uuid not null,
  release_id uuid not null,
  package_id uuid not null,
  grant_id uuid not null,
  event_type text not null,
  actor_profile_id uuid,
  request_id uuid not null,
  ip_hash bytea,
  user_agent_hash bytea,
  occurred_at timestamptz not null default now(),
  constraint download_events_type_check check (
    event_type in ('grant_resolved', 'object_url_issued', 'controlled_proxy_completed', 'denied')
  ),
  constraint download_events_hash_check check (
    (ip_hash is null or pg_catalog.octet_length(ip_hash) = 32)
    and (user_agent_hash is null or pg_catalog.octet_length(user_agent_hash) = 32)
  ),
  constraint download_events_organization_id_id_key unique (organization_id, id),
  constraint download_events_request_key
    unique (organization_id, grant_id, request_id, event_type),
  constraint download_events_grant_fkey foreign key (
    organization_id, grant_id, package_id, release_id, property_id, batch_id
  ) references public.download_grants (
    organization_id, id, package_id, release_id, property_id, batch_id
  ) on delete restrict,
  constraint download_events_actor_fkey foreign key (organization_id, actor_profile_id)
    references public.profiles (organization_id, id) on delete restrict
);

create table public.listing_gallery_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  listing_website_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  release_id uuid not null,
  release_item_id uuid not null,
  media_version_id uuid not null,
  derivative_id uuid not null,
  position integer not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint listing_gallery_items_position_check check (position >= 0),
  constraint listing_gallery_items_organization_id_id_key unique (organization_id, id),
  constraint listing_gallery_items_listing_fkey foreign key (
    organization_id, listing_website_id, property_id
  ) references public.listing_websites (
    organization_id, id, property_id
  ) on delete restrict,
  constraint listing_gallery_items_release_item_fkey foreign key (
    organization_id, release_item_id, release_id, property_id, batch_id,
    media_version_id, derivative_id
  ) references public.gallery_release_items (
    organization_id, id, release_id, property_id, batch_id,
    media_version_id, display_derivative_id
  ) on delete restrict
);

create unique index listing_gallery_items_active_position_idx
  on public.listing_gallery_items (organization_id, listing_website_id, position)
  where removed_at is null;
create unique index listing_gallery_items_active_release_item_idx
  on public.listing_gallery_items (organization_id, listing_website_id, release_item_id)
  where removed_at is null;

create index media_batches_property_created_idx
  on public.media_batches (organization_id, property_id, created_at desc);
create index media_assets_batch_sequence_idx
  on public.media_assets (organization_id, batch_id, capture_sequence, id);
create index media_versions_asset_version_idx
  on public.media_versions (organization_id, asset_id, version_number desc);
create index media_derivatives_work_idx
  on public.media_derivatives (organization_id, status, created_at)
  where status in ('queued', 'retryable');
create index provider_events_received_idx
  on public.provider_events (organization_id, received_at desc);
create index media_ingest_jobs_due_idx
  on public.media_ingest_jobs (next_attempt_at, created_at)
  where state in ('discovered', 'url_ready', 'retryable', 'reconciliation_required');
create index media_job_attempts_job_idx
  on public.media_job_attempts (organization_id, job_id, attempt_number desc);
create index gallery_releases_property_created_idx
  on public.gallery_releases (organization_id, property_id, created_at desc);
create index media_packages_release_status_idx
  on public.media_packages (organization_id, release_id, status);
create index download_grants_expiry_idx
  on public.download_grants (expires_at) where revoked_at is null;
create index download_events_release_idx
  on public.download_events (organization_id, release_id, occurred_at desc);

create or replace function public.is_valid_media_ingest_transition(from_state text, to_state text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case from_state
    when 'discovered' then to_state in ('url_ready', 'rejected', 'dead_letter')
    when 'url_ready' then to_state in ('fetching', 'source_expired', 'rejected', 'dead_letter')
    when 'fetching' then to_state in ('quarantined', 'retryable', 'source_expired', 'reconciliation_required', 'rejected', 'dead_letter')
    when 'quarantined' then to_state in ('validating', 'rejected', 'dead_letter')
    when 'validating' then to_state in ('scanning', 'rejected', 'dead_letter')
    when 'scanning' then to_state in ('accepted', 'retryable', 'reconciliation_required', 'rejected', 'dead_letter')
    when 'accepted' then to_state in ('deriving', 'review_pending', 'reconciliation_required')
    when 'deriving' then to_state in ('review_pending', 'retryable', 'reconciliation_required', 'dead_letter')
    when 'retryable' then to_state in ('fetching', 'validating', 'scanning', 'deriving', 'reconciliation_required', 'dead_letter')
    when 'source_expired' then to_state in ('url_ready', 'rejected', 'dead_letter')
    when 'reconciliation_required' then to_state in ('fetching', 'quarantined', 'validating', 'scanning', 'deriving', 'review_pending', 'rejected', 'dead_letter')
    else false
  end
$$;

create or replace function public.is_valid_gallery_release_transition(from_state text, to_state text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case from_state
    when 'draft' then to_state in ('review_pending', 'withdrawn')
    when 'review_pending' then to_state in ('changes_requested', 'approved', 'withdrawn')
    when 'changes_requested' then to_state in ('revision_processing', 'withdrawn')
    when 'revision_processing' then to_state in ('review_pending', 'changes_requested', 'withdrawn')
    when 'approved' then to_state in ('packaging', 'withdrawn')
    when 'packaging' then to_state in ('ready', 'withdrawn')
    when 'ready' then to_state in ('published', 'superseded', 'withdrawn')
    when 'published' then to_state in ('superseded', 'withdrawn')
    else false
  end
$$;

create or replace function public.prevent_media_row_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Canonical media rows are retained; use an explicit terminal state'
    using errcode = '23514';
end;
$$;

create or replace function public.prevent_media_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Canonical media evidence is append-only'
    using errcode = '23514';
end;
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
       and not public.is_valid_media_ingest_transition(old.ingest_state, new.ingest_state) then
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
    new.updated_at := now();
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
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.enforce_media_initial_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare package_release_state text;
begin
  if tg_table_name = 'media_versions' and pg_catalog.to_jsonb(new)->>'ingest_state' is distinct from 'discovered' then
    raise exception 'Media versions must start discovered' using errcode = '23514';
  elsif tg_table_name = 'media_ingest_jobs' and pg_catalog.to_jsonb(new)->>'state' is distinct from 'discovered' then
    raise exception 'Media ingest jobs must start discovered' using errcode = '23514';
  elsif tg_table_name = 'media_derivatives' and pg_catalog.to_jsonb(new)->>'status' is distinct from 'queued' then
    raise exception 'Media derivatives must start queued' using errcode = '23514';
  elsif tg_table_name = 'media_packages' then
    if pg_catalog.to_jsonb(new)->>'status' is distinct from 'queued' then
      raise exception 'Media packages must start queued' using errcode = '23514';
    end if;
    select release.state into package_release_state
      from public.gallery_releases release
     where release.organization_id = (pg_catalog.to_jsonb(new)->>'organization_id')::uuid
       and release.id = (pg_catalog.to_jsonb(new)->>'release_id')::uuid
     for update;
    if package_release_state is null
       or package_release_state not in ('approved', 'packaging', 'ready', 'published') then
      raise exception 'Media packages require an approved release snapshot' using errcode = '23514';
    end if;
  elsif tg_table_name = 'gallery_releases' and pg_catalog.to_jsonb(new)->>'state' is distinct from 'draft' then
    raise exception 'Gallery releases must start draft' using errcode = '23514';
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
      new.job_kind, new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.property_id, old.batch_id, old.provider_event_id,
      old.job_kind, old.idempotency_key, old.created_at) then
    raise exception 'Media ingest job identity is immutable' using errcode = '23514';
  end if;
  if new.state is distinct from old.state
     and not public.is_valid_media_ingest_transition(old.state, new.state) then
    raise exception 'Invalid media ingest job transition' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prevent_approved_release_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.organization_id, new.property_id, new.batch_id, new.revision_number,
      new.supersedes_release_id, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.property_id, old.batch_id, old.revision_number,
      old.supersedes_release_id, old.created_by, old.created_at) then
    raise exception 'Release identity is immutable' using errcode = '23514';
  end if;
  if new.state is distinct from old.state
     and not public.is_valid_gallery_release_transition(old.state, new.state) then
    raise exception 'Invalid gallery release transition' using errcode = '23514';
  end if;
  if old.approved_at is not null and (
    new.manifest_version is distinct from old.manifest_version
    or new.manifest is distinct from old.manifest
    or new.manifest_sha256 is distinct from old.manifest_sha256
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
  ) then
    raise exception 'Approved release snapshot is immutable' using errcode = '23514';
  end if;
  if new.state = 'approved' and old.state is distinct from 'approved' then
    if not exists (
      select 1 from public.gallery_release_items item
       where item.organization_id = new.organization_id and item.release_id = new.id
    ) or exists (
      select 1 from public.gallery_release_items item
       where item.organization_id = new.organization_id and item.release_id = new.id
         and item.approval_state <> 'approved'
    ) then
      raise exception 'Every release item must be approved before release approval'
        using errcode = '23514';
    end if;
  end if;
  if new.state in ('superseded', 'withdrawn') and old.state is distinct from new.state
     and exists (
       select 1 from public.listing_gallery_items listing_item
        where listing_item.organization_id = new.organization_id
          and listing_item.release_id = new.id
          and listing_item.removed_at is null
     ) then
    raise exception 'Active listing items must be removed before release withdrawal or supersession'
      using errcode = '23514';
  end if;
  if new.state in ('superseded', 'withdrawn') and old.state is distinct from new.state
     and exists (
       select 1 from public.download_grants grant_row
        where grant_row.organization_id = new.organization_id
          and grant_row.release_id = new.id
          and grant_row.revoked_at is null
     ) then
    raise exception 'Active download grants must be revoked before release withdrawal or supersession'
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_release_item_mutability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare release_approved_at timestamptz;
declare target_organization_id uuid;
declare target_release_id uuid;
begin
  target_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  target_release_id := case when tg_op = 'DELETE' then old.release_id else new.release_id end;
  select release.approved_at into release_approved_at
    from public.gallery_releases release
   where release.organization_id = target_organization_id
     and release.id = target_release_id
   for update;
  if release_approved_at is not null then
    raise exception 'Approved release items are immutable' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.approval_state = 'approved' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.property_id is distinct from old.property_id
    or new.batch_id is distinct from old.batch_id
    or new.release_id is distinct from old.release_id
    or new.media_version_id is distinct from old.media_version_id
    or new.display_derivative_id is distinct from old.display_derivative_id
    or new.download_derivative_id is distinct from old.download_derivative_id
    or new.position is distinct from old.position
    or new.display_filename is distinct from old.display_filename
    or new.alt_text is distinct from old.alt_text
    or new.approval_state is distinct from old.approval_state
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Approved release item approval is bound to immutable content'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.enforce_download_grant_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.organization_id, new.property_id, new.batch_id, new.release_id, new.package_id,
      new.grantee_profile_id, new.grantee_email_hash, new.token_key_id, new.token_hash,
      new.expires_at, new.max_resolutions, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.property_id, old.batch_id, old.release_id, old.package_id,
      old.grantee_profile_id, old.grantee_email_hash, old.token_key_id, old.token_hash,
      old.expires_at, old.max_resolutions, old.created_by, old.created_at) then
    raise exception 'Download grant identity is immutable' using errcode = '23514';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'Download grant revocation is irreversible' using errcode = '23514';
  end if;
  if new.resolution_count < old.resolution_count then
    raise exception 'Download grant resolution count cannot decrease' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_download_grant_validity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare release_state text;
begin
  select release.state into release_state
    from public.gallery_releases release
   where release.organization_id = new.organization_id
     and release.id = new.release_id
   for update;
  if release_state is null
     or release_state not in ('ready', 'published')
     or not exists (
       select 1
         from public.media_packages package_row
        where package_row.organization_id = new.organization_id
          and package_row.id = new.package_id
          and package_row.release_id = new.release_id
          and package_row.status = 'ready'
     ) then
    raise exception 'Download grants require a ready package and ready release'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_listing_gallery_item_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
declare release_state text;
declare item_state text;
declare derivative_state text;
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.organization_id, new.listing_website_id, new.property_id, new.batch_id,
        new.release_id, new.release_item_id, new.media_version_id, new.derivative_id,
        new.position, new.created_at)
       is distinct from
       (old.id, old.organization_id, old.listing_website_id, old.property_id, old.batch_id,
        old.release_id, old.release_item_id, old.media_version_id, old.derivative_id,
        old.position, old.created_at) then
      raise exception 'Listing gallery identity is immutable' using errcode = '23514';
    end if;
    if old.removed_at is not null and new.removed_at is distinct from old.removed_at then
      raise exception 'Listing gallery removal is irreversible' using errcode = '23514';
    end if;
  end if;
  if new.removed_at is null then
    select release.state, item.approval_state, derivative.status
      into release_state, item_state, derivative_state
      from public.gallery_releases release
      join public.gallery_release_items item
        on item.organization_id = release.organization_id and item.release_id = release.id
      join public.media_derivatives derivative
        on derivative.organization_id = item.organization_id
       and derivative.id = item.display_derivative_id
     where release.organization_id = new.organization_id
       and release.id = new.release_id
       and item.id = new.release_item_id
       and derivative.id = new.derivative_id
     for update of release;
    if release_state not in ('approved', 'packaging', 'ready', 'published')
       or item_state <> 'approved' or derivative_state <> 'ready' then
      raise exception 'Listing gallery requires an approved release item and ready derivative'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger media_batches_append_only
before update on public.media_batches for each row execute function public.prevent_media_append_only_mutation();
create trigger media_assets_append_only
before update on public.media_assets for each row execute function public.prevent_media_append_only_mutation();
create trigger provider_events_append_only
before update on public.provider_events for each row execute function public.prevent_media_append_only_mutation();
create trigger media_job_attempts_append_only
before update on public.media_job_attempts for each row execute function public.prevent_media_append_only_mutation();
create trigger download_events_append_only
before update on public.download_events for each row execute function public.prevent_media_append_only_mutation();

create trigger media_versions_storage_identity
before update on public.media_versions for each row execute function public.prevent_media_storage_identity_mutation();
create trigger media_derivatives_storage_identity
before update on public.media_derivatives for each row execute function public.prevent_media_storage_identity_mutation();
create trigger media_packages_storage_identity
before update on public.media_packages for each row execute function public.prevent_media_storage_identity_mutation();
create trigger media_ingest_jobs_transition
before update on public.media_ingest_jobs for each row execute function public.enforce_media_ingest_job_transition();
create trigger gallery_releases_immutability
before update on public.gallery_releases for each row execute function public.prevent_approved_release_mutation();
create trigger gallery_release_items_mutability
before insert or update or delete on public.gallery_release_items
for each row execute function public.enforce_release_item_mutability();
create trigger download_grants_immutability
before update on public.download_grants for each row execute function public.enforce_download_grant_immutability();
create trigger download_grants_validity
before insert on public.download_grants for each row execute function public.enforce_download_grant_validity();
create trigger listing_gallery_items_approval
before insert or update on public.listing_gallery_items
for each row execute function public.enforce_listing_gallery_item_approval();

create trigger media_versions_initial_state before insert on public.media_versions
for each row execute function public.enforce_media_initial_state();
create trigger media_derivatives_initial_state before insert on public.media_derivatives
for each row execute function public.enforce_media_initial_state();
create trigger media_ingest_jobs_initial_state before insert on public.media_ingest_jobs
for each row execute function public.enforce_media_initial_state();
create trigger gallery_releases_initial_state before insert on public.gallery_releases
for each row execute function public.enforce_media_initial_state();
create trigger media_packages_initial_state before insert on public.media_packages
for each row execute function public.enforce_media_initial_state();

create trigger media_batches_no_delete before delete on public.media_batches
for each row execute function public.prevent_media_row_delete();
create trigger media_assets_no_delete before delete on public.media_assets
for each row execute function public.prevent_media_row_delete();
create trigger media_versions_no_delete before delete on public.media_versions
for each row execute function public.prevent_media_row_delete();
create trigger media_derivatives_no_delete before delete on public.media_derivatives
for each row execute function public.prevent_media_row_delete();
create trigger provider_events_no_delete before delete on public.provider_events
for each row execute function public.prevent_media_row_delete();
create trigger media_ingest_jobs_no_delete before delete on public.media_ingest_jobs
for each row execute function public.prevent_media_row_delete();
create trigger media_job_attempts_no_delete before delete on public.media_job_attempts
for each row execute function public.prevent_media_row_delete();
create trigger gallery_releases_no_delete before delete on public.gallery_releases
for each row execute function public.prevent_media_row_delete();
create trigger media_packages_no_delete before delete on public.media_packages
for each row execute function public.prevent_media_row_delete();
create trigger download_grants_no_delete before delete on public.download_grants
for each row execute function public.prevent_media_row_delete();
create trigger download_events_no_delete before delete on public.download_events
for each row execute function public.prevent_media_row_delete();
create trigger listing_gallery_items_no_delete before delete on public.listing_gallery_items
for each row execute function public.prevent_media_row_delete();

alter table public.media_batches enable row level security;
alter table public.media_batches force row level security;
alter table public.media_assets enable row level security;
alter table public.media_assets force row level security;
alter table public.media_versions enable row level security;
alter table public.media_versions force row level security;
alter table public.media_derivatives enable row level security;
alter table public.media_derivatives force row level security;
alter table public.provider_events enable row level security;
alter table public.provider_events force row level security;
alter table public.media_ingest_jobs enable row level security;
alter table public.media_ingest_jobs force row level security;
alter table public.media_job_attempts enable row level security;
alter table public.media_job_attempts force row level security;
alter table public.gallery_releases enable row level security;
alter table public.gallery_releases force row level security;
alter table public.gallery_release_items enable row level security;
alter table public.gallery_release_items force row level security;
alter table public.media_packages enable row level security;
alter table public.media_packages force row level security;
alter table public.download_grants enable row level security;
alter table public.download_grants force row level security;
alter table public.download_events enable row level security;
alter table public.download_events force row level security;
alter table public.listing_gallery_items enable row level security;
alter table public.listing_gallery_items force row level security;

revoke all on table
  public.media_batches, public.media_assets, public.media_versions,
  public.media_derivatives, public.provider_events, public.media_ingest_jobs,
  public.media_job_attempts, public.gallery_releases, public.gallery_release_items,
  public.media_packages, public.download_grants, public.download_events,
  public.listing_gallery_items
from public, anon, authenticated;

grant select, insert, update on table
  public.media_versions, public.media_derivatives, public.media_ingest_jobs,
  public.gallery_releases, public.gallery_release_items, public.media_packages,
  public.download_grants, public.listing_gallery_items
  to service_role;
grant select, insert on table
  public.media_batches, public.media_assets, public.provider_events,
  public.media_job_attempts, public.download_events
  to service_role;

revoke all on function public.is_valid_media_ingest_transition(text, text) from public, anon, authenticated;
revoke all on function public.is_valid_gallery_release_transition(text, text) from public, anon, authenticated;
revoke all on function public.prevent_media_row_delete() from public, anon, authenticated;
revoke all on function public.prevent_media_append_only_mutation() from public, anon, authenticated;
revoke all on function public.prevent_media_storage_identity_mutation() from public, anon, authenticated;
revoke all on function public.enforce_media_initial_state() from public, anon, authenticated;
revoke all on function public.enforce_media_ingest_job_transition() from public, anon, authenticated;
revoke all on function public.prevent_approved_release_mutation() from public, anon, authenticated;
revoke all on function public.enforce_release_item_mutability() from public, anon, authenticated;
revoke all on function public.enforce_download_grant_immutability() from public, anon, authenticated;
revoke all on function public.enforce_download_grant_validity() from public, anon, authenticated;
revoke all on function public.enforce_listing_gallery_item_approval() from public, anon, authenticated;

grant execute on function public.is_valid_media_ingest_transition(text, text) to service_role;
grant execute on function public.is_valid_gallery_release_transition(text, text) to service_role;
grant execute on function public.prevent_media_row_delete() to service_role;
grant execute on function public.prevent_media_append_only_mutation() to service_role;
grant execute on function public.prevent_media_storage_identity_mutation() to service_role;
grant execute on function public.enforce_media_initial_state() to service_role;
grant execute on function public.enforce_media_ingest_job_transition() to service_role;
grant execute on function public.prevent_approved_release_mutation() to service_role;
grant execute on function public.enforce_release_item_mutability() to service_role;
grant execute on function public.enforce_download_grant_immutability() to service_role;
grant execute on function public.enforce_download_grant_validity() to service_role;
grant execute on function public.enforce_listing_gallery_item_approval() to service_role;
