-- Additive application-runtime completion and cleanup correction for AutoHDR sources.

create function public.complete_autohdr_source_file(
  p_organization_id uuid, p_ingest_job_id uuid, p_lease_token uuid,
  p_quarantine_etag text, p_outcome text,
  p_master_version_id uuid, p_master_asset_id uuid, p_master_batch_id uuid,
  p_master_bucket_name text, p_master_object_key text,
  p_verified_width_px integer, p_verified_height_px integer
)
returns table (ingest_job_id uuid, lifecycle_state text, worker_lease_token uuid)
language plpgsql security definer set search_path = '' as $$
declare v_source public.autohdr_source_ingests; v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select * into v_source from public.autohdr_source_ingests
   where organization_id = p_organization_id and autohdr_source_ingests.ingest_job_id = p_ingest_job_id
   for update;
  if not found then raise exception 'AutoHDR source completion scope was not found' using errcode='23503'; end if;
  if v_source.worker_lease_token is distinct from p_lease_token or v_source.worker_lease_expires_at <= v_now then
    raise exception 'AutoHDR source completion lease is stale or fenced' using errcode='55000';
  end if;
  if p_quarantine_etag is distinct from v_source.quarantine_etag
     or p_verified_width_px not between 1 and 100000 or p_verified_height_px not between 1 and 100000
     or p_outcome not in ('accepted','reused_accepted') then
    raise exception 'Invalid AutoHDR source completion evidence' using errcode='22023';
  end if;
  if not exists (select 1 from public.autohdr_source_position_refs r
    where r.organization_id=p_organization_id and r.ingest_job_id=p_ingest_job_id
      and r.master_version_id=p_master_version_id) then
    raise exception 'AutoHDR source completion lacks its durable master reference' using errcode='55000';
  end if;
  perform pg_catalog.set_config('app.autohdr_source_lease_token', p_lease_token::text, true);

  if p_outcome = 'accepted' then
    if p_master_version_id is distinct from v_source.version_id
       or p_master_asset_id is distinct from v_source.asset_id
       or p_master_batch_id is distinct from v_source.batch_id
       or p_master_bucket_name is distinct from v_source.master_bucket_name
       or p_master_object_key is distinct from v_source.master_object_key then
      raise exception 'New source completion master identity drifted' using errcode='22023';
    end if;
    if v_source.lifecycle_state = 'quarantined' then
      perform public.begin_autohdr_source_validation(
        v_source.organization_id,v_source.booking_id,v_source.batch_id,v_source.asset_id,
        v_source.version_id,v_source.ingest_job_id,v_source.quarantine_bucket_name,
        v_source.quarantine_object_key,v_source.quarantine_etag);
    end if;
    perform public.accept_autohdr_quarantined_source_version(
      v_source.organization_id,v_source.booking_id,v_source.batch_id,v_source.asset_id,
      v_source.version_id,v_source.ingest_job_id,v_source.quarantine_bucket_name,
      v_source.quarantine_object_key,v_source.quarantine_etag,v_source.master_bucket_name,
      v_source.master_object_key,v_source.expected_sha256,v_source.expected_byte_size,
      v_source.expected_mime_type,p_verified_width_px,p_verified_height_px);
  else
    if not exists (select 1 from public.media_versions v
      where v.organization_id=p_organization_id and v.id=p_master_version_id
        and v.asset_id=p_master_asset_id and v.batch_id=p_master_batch_id
        and v.bucket_name=p_master_bucket_name and v.object_key=p_master_object_key
        and v.sha256=v_source.expected_sha256 and v.byte_size=v_source.expected_byte_size
        and v.mime_type=v_source.expected_mime_type and v.ingest_state='accepted' and v.accepted_at is not null) then
      raise exception 'Reused AutoHDR master is not durably accepted' using errcode='55000';
    end if;
    update public.media_versions set ingest_state='reconciliation_required'
      where organization_id=p_organization_id and id=v_source.version_id and ingest_state in ('quarantined','validating');
    update public.media_ingest_jobs set state='reconciliation_required', completed_at=v_now,
      last_error_code='accepted_master_reused', last_error_at=v_now
      where organization_id=p_organization_id and id=p_ingest_job_id and state in ('quarantined','validating');
    update public.autohdr_source_ingests set lifecycle_state='reconciliation_required',
      reconciliation_required_at=coalesce(reconciliation_required_at,v_now),
      verified_width_px=p_verified_width_px, verified_height_px=p_verified_height_px,
      last_error_code='accepted_master_reused', last_error_at=v_now
      where organization_id=p_organization_id and autohdr_source_ingests.ingest_job_id=p_ingest_job_id;
  end if;
  update public.autohdr_source_ingests set worker_id=null, worker_lease_token=null,
    worker_lease_expires_at=null where organization_id=p_organization_id
      and autohdr_source_ingests.ingest_job_id=p_ingest_job_id;
  return query select s.ingest_job_id,s.lifecycle_state,s.worker_lease_token
    from public.autohdr_source_ingests s where s.organization_id=p_organization_id and s.ingest_job_id=p_ingest_job_id;
end $$;

create function public.settle_autohdr_source_file(
  p_organization_id uuid, p_ingest_job_id uuid, p_lease_token uuid,
  p_quarantine_etag text, p_outcome text, p_error_code text
)
returns table (ingest_job_id uuid, lifecycle_state text, worker_lease_token uuid)
language plpgsql security definer set search_path = '' as $$
declare v_source public.autohdr_source_ingests; v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select * into v_source from public.autohdr_source_ingests
   where organization_id=p_organization_id and autohdr_source_ingests.ingest_job_id=p_ingest_job_id for update;
  if not found then raise exception 'AutoHDR source settlement scope was not found' using errcode='23503'; end if;
  if v_source.worker_lease_token is distinct from p_lease_token or v_source.worker_lease_expires_at <= v_now then
    raise exception 'AutoHDR source settlement lease is stale or fenced' using errcode='55000'; end if;
  if p_quarantine_etag is distinct from v_source.quarantine_etag
     or p_outcome not in ('retryable','reconciliation_required')
     or p_error_code is null or pg_catalog.char_length(p_error_code) not between 1 and 96 then
    raise exception 'Invalid AutoHDR source settlement' using errcode='22023'; end if;
  perform pg_catalog.set_config('app.autohdr_source_lease_token', p_lease_token::text, true);
  if p_outcome='reconciliation_required' then
    update public.media_versions set ingest_state='reconciliation_required'
      where organization_id=p_organization_id and id=v_source.version_id and ingest_state in ('quarantined','validating');
    update public.media_ingest_jobs set state='reconciliation_required', last_error_code=p_error_code,last_error_at=v_now
      where organization_id=p_organization_id and id=p_ingest_job_id and state in ('quarantined','validating');
    update public.autohdr_source_ingests set lifecycle_state='reconciliation_required',
      reconciliation_required_at=coalesce(reconciliation_required_at,v_now), last_error_code=p_error_code,last_error_at=v_now
      where organization_id=p_organization_id and autohdr_source_ingests.ingest_job_id=p_ingest_job_id;
  else
    update public.autohdr_source_ingests set last_error_code=p_error_code,last_error_at=v_now
      where organization_id=p_organization_id and autohdr_source_ingests.ingest_job_id=p_ingest_job_id;
  end if;
  update public.autohdr_source_ingests set worker_id=null,worker_lease_token=null,worker_lease_expires_at=null
    where organization_id=p_organization_id and autohdr_source_ingests.ingest_job_id=p_ingest_job_id;
  return query select s.ingest_job_id,s.lifecycle_state,s.worker_lease_token from public.autohdr_source_ingests s
    where s.organization_id=p_organization_id and s.ingest_job_id=p_ingest_job_id;
end $$;

-- Accepted rows can retain quarantine objects after a successful durable acceptance.
drop function public.claim_abandoned_autohdr_source_quarantine(integer,integer);
create function public.claim_abandoned_autohdr_source_quarantine(p_limit integer,p_lease_seconds integer)
returns table (organization_id uuid,booking_id uuid,property_id uuid,batch_id uuid,asset_id uuid,version_id uuid,
 ingest_job_id uuid,quarantine_bucket_name text,quarantine_object_key text,quarantine_etag text,
 cleanup_object_etag text,cleanup_attempts integer,cleanup_lease_token uuid,cleanup_lease_expires_at timestamptz,lifecycle_state text)
language plpgsql security definer set search_path='' as $$
begin
 if p_limit not between 1 and 100 or p_lease_seconds not between 30 and 900 then raise exception 'Invalid abandoned quarantine claim bounds' using errcode='22023'; end if;
 return query with due as (
  select s.organization_id,s.ingest_job_id from public.autohdr_source_ingests s
  where s.cleanup_settled_at is null and s.quarantine_etag is not null
    and (s.lifecycle_state='accepted' or s.quarantine_expires_at<=pg_catalog.clock_timestamp())
    and s.cleanup_next_attempt_at<=pg_catalog.clock_timestamp()
    and (s.cleanup_lease_expires_at is null or s.cleanup_lease_expires_at<=pg_catalog.clock_timestamp())
    and s.cleanup_attempts<100 order by s.cleanup_next_attempt_at,s.prepared_at,s.ingest_job_id
    for update skip locked limit p_limit
 ), claimed as (
  update public.autohdr_source_ingests s set cleanup_attempts=s.cleanup_attempts+1,
   cleanup_lease_token=extensions.gen_random_uuid(),cleanup_lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds)
  from due where s.organization_id=due.organization_id and s.ingest_job_id=due.ingest_job_id returning s.*)
 select c.organization_id,c.booking_id,c.property_id,c.batch_id,c.asset_id,c.version_id,c.ingest_job_id,
 c.quarantine_bucket_name,c.quarantine_object_key,c.quarantine_etag,c.cleanup_object_etag,c.cleanup_attempts,
 c.cleanup_lease_token,c.cleanup_lease_expires_at,c.lifecycle_state from claimed c;
end $$;

-- Replace settlement so successful accepted cleanup never downgrades accepted media.
drop function public.settle_autohdr_source_quarantine_cleanup(uuid,uuid,uuid,uuid,text,text,uuid,text,text);
create function public.settle_autohdr_source_quarantine_cleanup(
 p_organization_id uuid,p_booking_id uuid,p_property_id uuid,p_ingest_job_id uuid,
 p_quarantine_object_key text,p_quarantine_etag text,p_cleanup_lease_token uuid,p_outcome text,p_error_code text)
returns table(ingest_job_id uuid,lifecycle_state text,cleanup_next_attempt_at timestamptz,cleanup_settled_at timestamptz,cleanup_outcome text)
language plpgsql security definer set search_path='' as $$
declare v public.autohdr_source_ingests; n timestamptz:=pg_catalog.clock_timestamp();
begin
 select * into v from public.autohdr_source_ingests where organization_id=p_organization_id and booking_id=p_booking_id
  and property_id=p_property_id and autohdr_source_ingests.ingest_job_id=p_ingest_job_id
  and quarantine_object_key=p_quarantine_object_key for update;
 if not found then raise exception 'Quarantine cleanup source identity mismatch' using errcode='23503'; end if;
 if v.cleanup_lease_token is distinct from p_cleanup_lease_token or v.cleanup_lease_expires_at<=n then raise exception 'Quarantine cleanup lease is missing, stale, or fenced' using errcode='55000'; end if;
 if p_outcome not in ('cleaned','not_found','retryable','reconciliation_required') then raise exception 'Invalid cleanup outcome' using errcode='22023'; end if;
 if p_outcome='cleaned' and (p_quarantine_etag is null or p_quarantine_etag is distinct from coalesce(v.quarantine_etag,v.cleanup_object_etag)) then raise exception 'Quarantine cleanup ETag drifted from stored evidence' using errcode='22023'; end if;
 if p_outcome='not_found' and p_quarantine_etag is not null then raise exception 'Invalid not-found evidence' using errcode='22023'; end if;
 if p_outcome in ('cleaned','not_found') then
  update public.autohdr_source_ingests set cleanup_object_etag=p_quarantine_etag,cleanup_settled_at=n,cleanup_outcome=p_outcome,
   cleanup_lease_token=null,cleanup_lease_expires_at=null where organization_id=p_organization_id and autohdr_source_ingests.ingest_job_id=p_ingest_job_id;
 elsif p_outcome='retryable' then
  update public.autohdr_source_ingests set cleanup_next_attempt_at=n+interval '5 minutes',cleanup_lease_token=null,cleanup_lease_expires_at=null,last_error_code=p_error_code,last_error_at=n
   where organization_id=p_organization_id and autohdr_source_ingests.ingest_job_id=p_ingest_job_id;
 else
  if v.lifecycle_state<>'accepted' then
   update public.media_versions set ingest_state='reconciliation_required' where organization_id=p_organization_id and id=v.version_id and ingest_state in ('discovered','quarantined','validating');
   update public.media_ingest_jobs set state='reconciliation_required',last_error_code=p_error_code,last_error_at=n where organization_id=p_organization_id and id=p_ingest_job_id and state in ('discovered','quarantined','validating');
   update public.autohdr_source_ingests set lifecycle_state='reconciliation_required',reconciliation_required_at=coalesce(reconciliation_required_at,n)
    where organization_id=p_organization_id and autohdr_source_ingests.ingest_job_id=p_ingest_job_id;
  end if;
  update public.autohdr_source_ingests set cleanup_next_attempt_at=n+interval '1 day',cleanup_lease_token=null,cleanup_lease_expires_at=null,last_error_code=p_error_code,last_error_at=n
   where organization_id=p_organization_id and autohdr_source_ingests.ingest_job_id=p_ingest_job_id;
 end if;
 return query select s.ingest_job_id,s.lifecycle_state,s.cleanup_next_attempt_at,s.cleanup_settled_at,s.cleanup_outcome from public.autohdr_source_ingests s
  where s.organization_id=p_organization_id and s.ingest_job_id=p_ingest_job_id;
end $$;

revoke all on function public.complete_autohdr_source_file(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.settle_autohdr_source_file(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.claim_abandoned_autohdr_source_quarantine(integer,integer) from public,anon,authenticated;
revoke all on function public.settle_autohdr_source_quarantine_cleanup(uuid,uuid,uuid,uuid,text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.complete_autohdr_source_file(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text,integer,integer) to service_role;
grant execute on function public.settle_autohdr_source_file(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.claim_abandoned_autohdr_source_quarantine(integer,integer) to service_role;
grant execute on function public.settle_autohdr_source_quarantine_cleanup(uuid,uuid,uuid,uuid,text,text,uuid,text,text) to service_role;
