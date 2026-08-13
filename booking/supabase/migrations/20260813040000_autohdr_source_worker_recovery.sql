-- Lease-fenced crash recovery and completion for the AutoHDR source worker.
-- This migration is intentionally additive to the rejected 20260813033000 contract.

alter table public.autohdr_source_hash_reservations
  add column reservation_lease_token uuid,
  add column reservation_lease_expires_at timestamptz,
  add column completed_at timestamptz,
  add constraint autohdr_source_hash_reservations_lease_check check (
    (reservation_lease_token is null and reservation_lease_expires_at is null)
    or (reservation_lease_token is not null and reservation_lease_expires_at is not null)
  );

-- Existing out-of-contract work can never satisfy the bounded worker contract.
update public.autohdr_source_ingests source
set lifecycle_state = 'reconciliation_required',
    reconciliation_required_at = coalesce(source.reconciliation_required_at, pg_catalog.clock_timestamp()),
    last_error_code = 'legacy_source_out_of_worker_bounds',
    last_error_at = pg_catalog.clock_timestamp(),
    worker_id = null,
    worker_lease_token = null,
    worker_lease_expires_at = null
where source.lifecycle_state in ('prepared', 'quarantined', 'validating')
  and (source.position not between 0 and 19 or source.expected_byte_size not between 1 and 26214400);

create function public.fence_autohdr_source_worker_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.worker_lease_token is not null
     and new.lifecycle_state is distinct from old.lifecycle_state
     and coalesce(pg_catalog.current_setting('app.autohdr_source_lease_token', true), '')
       is distinct from old.worker_lease_token::text then
    raise exception 'AutoHDR source transition requires the current worker lease'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger autohdr_source_ingests_worker_transition_fence
before update on public.autohdr_source_ingests
for each row execute function public.fence_autohdr_source_worker_transition();

create or replace function public.claim_autohdr_source_file(
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
language plpgsql security definer set search_path = '' as $$
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
      and source.position between 0 and 19
      and source.expected_byte_size between 1 and 26214400
      and (source.worker_lease_expires_at is null
        or source.worker_lease_expires_at <= pg_catalog.clock_timestamp())
    order by source.prepared_at, source.ingest_job_id
    for update skip locked limit 1
  ), claimed as (
    update public.autohdr_source_ingests source
       set worker_id = p_worker_id,
           worker_lease_token = extensions.gen_random_uuid(),
           worker_claimed_at = pg_catalog.clock_timestamp(),
           worker_lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds)
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

create or replace function public.enforce_autohdr_source_worker_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'AutoHDR source hash reservations are retained' using errcode = '23514';
  end if;
  if (new.organization_id, new.sha256, new.created_at) is distinct from
     (old.organization_id, old.sha256, old.created_at) then
    raise exception 'AutoHDR source hash reservation identity is immutable' using errcode = '23514';
  end if;
  -- Master identity may rotate only while the prior reservation is incomplete
  -- and its reservation lease has expired. Direct service-role writes are revoked.
  if (new.master_version_id, new.master_asset_id, new.master_batch_id,
      new.master_property_id, new.master_bucket_name, new.master_object_key,
      new.byte_size, new.mime_type, new.reserved_by_ingest_job_id) is distinct from
     (old.master_version_id, old.master_asset_id, old.master_batch_id,
      old.master_property_id, old.master_bucket_name, old.master_object_key,
      old.byte_size, old.mime_type, old.reserved_by_ingest_job_id)
     and (old.completed_at is not null or old.reservation_lease_expires_at is null
       or old.reservation_lease_expires_at > pg_catalog.clock_timestamp()) then
    raise exception 'AutoHDR source master reservation is immutable while live or completed' using errcode = '23514';
  end if;
  if old.completed_at is not null and new.completed_at is distinct from old.completed_at then
    raise exception 'AutoHDR source completion evidence is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.reserve_or_reuse_autohdr_source_master(
  p_organization_id uuid, p_ingest_job_id uuid, p_lease_token uuid,
  p_master_bucket_name text, p_master_object_key text, p_sha256 bytea,
  p_byte_size bigint, p_mime_type text
)
returns table (version_id uuid, asset_id uuid, batch_id uuid, bucket_name text,
  object_key text, newly_reserved boolean, reused_accepted boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_source public.autohdr_source_ingests;
  v_reservation public.autohdr_source_hash_reservations;
  v_inserted boolean := false;
  v_reused boolean := false;
begin
  select source.* into v_source from public.autohdr_source_ingests source
  where source.organization_id = p_organization_id and source.ingest_job_id = p_ingest_job_id for update;
  if not found then raise exception 'AutoHDR source lease scope was not found' using errcode = '23503'; end if;
  if v_source.lifecycle_state <> 'quarantined'
     or v_source.worker_lease_token is distinct from p_lease_token
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || pg_catalog.encode(p_sha256, 'hex'), 0));
  select reservation.* into v_reservation from public.autohdr_source_hash_reservations reservation
   where reservation.organization_id = p_organization_id and reservation.sha256 = p_sha256 for update;
  if not found then
    insert into public.autohdr_source_hash_reservations (
      organization_id, sha256, byte_size, mime_type, master_version_id, master_asset_id,
      master_batch_id, master_property_id, master_bucket_name, master_object_key,
      reserved_by_ingest_job_id, reservation_lease_token, reservation_lease_expires_at
    ) values (p_organization_id, p_sha256, p_byte_size, p_mime_type, v_source.version_id,
      v_source.asset_id, v_source.batch_id, v_source.property_id, p_master_bucket_name,
      p_master_object_key, p_ingest_job_id, p_lease_token, v_source.worker_lease_expires_at)
    returning * into v_reservation;
    v_inserted := true;
  elsif v_reservation.byte_size is distinct from p_byte_size or v_reservation.mime_type is distinct from p_mime_type then
    raise exception 'AutoHDR source hash metadata conflicts with its reservation' using errcode = '22023';
  elsif v_reservation.completed_at is not null or exists (
    select 1 from public.media_versions version
    where version.organization_id = p_organization_id
      and version.id = v_reservation.master_version_id
      and version.ingest_state = 'accepted' and version.accepted_at is not null
      and version.sha256 = p_sha256 and version.byte_size = p_byte_size
      and version.mime_type = p_mime_type
  ) then
    update public.autohdr_source_hash_reservations reservation
       set completed_at = coalesce(reservation.completed_at, (
             select version.accepted_at from public.media_versions version
             where version.organization_id=p_organization_id
               and version.id=reservation.master_version_id)),
           reservation_lease_expires_at = least(reservation.reservation_lease_expires_at, pg_catalog.clock_timestamp())
     where reservation.organization_id=p_organization_id and reservation.sha256=p_sha256
     returning * into v_reservation;
    v_reused := true;
  elsif v_reservation.reserved_by_ingest_job_id = p_ingest_job_id then
    update public.autohdr_source_hash_reservations reservation
       set reservation_lease_token = p_lease_token,
           reservation_lease_expires_at = v_source.worker_lease_expires_at
     where reservation.organization_id = p_organization_id and reservation.sha256 = p_sha256
     returning * into v_reservation;
  elsif v_reservation.reservation_lease_expires_at <= pg_catalog.clock_timestamp() then
    delete from public.autohdr_source_position_refs ref
     where ref.organization_id = p_organization_id and ref.sha256 = p_sha256;
    update public.autohdr_source_hash_reservations reservation set
      master_version_id = v_source.version_id, master_asset_id = v_source.asset_id,
      master_batch_id = v_source.batch_id, master_property_id = v_source.property_id,
      master_bucket_name = p_master_bucket_name, master_object_key = p_master_object_key,
      reserved_by_ingest_job_id = p_ingest_job_id,
      reservation_lease_token = p_lease_token,
      reservation_lease_expires_at = v_source.worker_lease_expires_at
    where reservation.organization_id = p_organization_id and reservation.sha256 = p_sha256
    returning * into v_reservation;
    v_inserted := true;
  else
    raise exception 'AutoHDR source hash has a competing live master reservation' using errcode = '55000';
  end if;
  insert into public.autohdr_source_position_refs (
    organization_id, ingest_job_id, request_id, position, source_version_id, master_version_id, sha256
  ) values (p_organization_id, p_ingest_job_id, v_source.request_id, v_source.position,
    v_source.version_id, v_reservation.master_version_id, p_sha256)
  on conflict (organization_id, ingest_job_id) do update set
    master_version_id = excluded.master_version_id, sha256 = excluded.sha256
  where public.autohdr_source_position_refs.request_id = excluded.request_id
    and public.autohdr_source_position_refs.position = excluded.position
    and public.autohdr_source_position_refs.source_version_id = excluded.source_version_id;
  return query select v_reservation.master_version_id, v_reservation.master_asset_id,
    v_reservation.master_batch_id, v_reservation.master_bucket_name,
    v_reservation.master_object_key, v_inserted, v_reused;
end;
$$;

create function public.complete_autohdr_source_file(
  p_organization_id uuid, p_ingest_job_id uuid, p_lease_token uuid,
  p_verified_width_px integer, p_verified_height_px integer
)
returns table (source_version_id uuid, master_version_id uuid, outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_source public.autohdr_source_ingests;
  v_reservation public.autohdr_source_hash_reservations;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select source.* into v_source from public.autohdr_source_ingests source
   where source.organization_id = p_organization_id and source.ingest_job_id = p_ingest_job_id for update;
  if not found then raise exception 'AutoHDR source lease scope was not found' using errcode = '23503'; end if;
  if v_source.worker_lease_token is distinct from p_lease_token
     or v_source.worker_lease_expires_at is null
     or v_source.worker_lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'AutoHDR source lease is stale or fenced' using errcode = '55000';
  end if;
  select reservation.* into v_reservation from public.autohdr_source_hash_reservations reservation
   where reservation.organization_id = p_organization_id
     and reservation.sha256 = v_source.expected_sha256 for update;
  if not found or v_reservation.reservation_lease_token is distinct from p_lease_token
     or v_reservation.reserved_by_ingest_job_id <> p_ingest_job_id
     or v_reservation.reservation_lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'AutoHDR source reservation lease is stale or fenced' using errcode = '55000';
  end if;
  if p_verified_width_px not between 1 and 100000 or p_verified_height_px not between 1 and 100000 then
    raise exception 'Invalid AutoHDR source dimensions' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.autohdr_source_lease_token', p_lease_token::text, true);
  update public.media_versions set ingest_state='validating'
   where organization_id=p_organization_id and id=v_source.version_id and ingest_state='quarantined';
  if not found then raise exception 'Canonical source version is not quarantined' using errcode='55000'; end if;
  update public.media_ingest_jobs set state='validating'
   where organization_id=p_organization_id and id=p_ingest_job_id and state='quarantined';
  update public.autohdr_source_ingests set lifecycle_state='validating', validation_started_at=v_now
   where organization_id=p_organization_id and ingest_job_id=p_ingest_job_id
     and lifecycle_state='quarantined';
  update public.media_versions set ingest_state='accepted', width_px=p_verified_width_px,
    height_px=p_verified_height_px, accepted_at=v_now
   where organization_id=p_organization_id and id=v_source.version_id and ingest_state='validating';
  update public.media_ingest_jobs set state='accepted', completed_at=v_now
   where organization_id=p_organization_id and id=p_ingest_job_id and state='validating';
  update public.autohdr_source_ingests set lifecycle_state='accepted',
    validation_started_at=v_now, verified_width_px=p_verified_width_px,
    verified_height_px=p_verified_height_px, master_promoted_at=v_now, accepted_at=v_now,
    worker_id=null, worker_lease_token=null, worker_lease_expires_at=null
   where organization_id=p_organization_id and ingest_job_id=p_ingest_job_id;
  update public.autohdr_source_hash_reservations set completed_at=v_now,
    reservation_lease_expires_at=v_now
   where organization_id=p_organization_id and sha256=v_source.expected_sha256;
  return query select v_source.version_id, v_reservation.master_version_id, 'accepted'::text;
end;
$$;

revoke all on function public.complete_autohdr_source_file(uuid,uuid,uuid,integer,integer)
  from public, anon, authenticated;
grant execute on function public.complete_autohdr_source_file(uuid,uuid,uuid,integer,integer)
  to service_role;
comment on function public.complete_autohdr_source_file(uuid,uuid,uuid,integer,integer) is
  'Service-only lease-fenced atomic source acceptance and hash-reservation completion.';
