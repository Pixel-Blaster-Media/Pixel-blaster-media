-- Canonical inventory, not browser storage, owns upload identity.
create function public.photo_finals_recover_intent(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_request uuid,p_intent uuid,p_sha256 text,p_bytes bigint)
returns public.media_ingest_jobs language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; latest_batch public.media_batches; request_id uuid;
begin
 perform public.photo_finals_access(p_org,p_actor,p_booking,p_property,true);
 if p_request is null or p_intent is null or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_bytes is null or p_bytes not between 1 and 33554432 then raise exception 'finals_input_invalid' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finals:'||p_org,0));
 select jobs.* into j from public.media_ingest_jobs jobs join public.media_batches b on b.organization_id=jobs.organization_id and b.id=jobs.batch_id
 where jobs.organization_id=p_org and jobs.property_id=p_property and b.booking_id=p_booking and jobs.finals_actor_id=p_actor and jobs.finals_sha256=decode(p_sha256,'hex') and jobs.finals_byte_size=p_bytes;
 if found then return j;end if;
 -- Only the newest batch can be extended: never resurrect an older abandoned batch.
 select b.* into latest_batch from public.media_batches b
 where b.organization_id=p_org and b.property_id=p_property and b.booking_id=p_booking and b.source_provider='manual_finals'
 order by b.created_at desc,b.id desc limit 1;
 if latest_batch.created_by=p_actor and not exists(select 1 from public.gallery_releases r where r.organization_id=p_org and r.batch_id=latest_batch.id and r.approved_at is not null) then request_id:=latest_batch.provider_job_id::uuid;end if;
 if request_id is null and exists(select 1 from public.media_batches where organization_id=p_org and source_provider='manual_finals' and provider_job_id=p_request::text) then request_id:=pg_catalog.gen_random_uuid();end if;
 return public.photo_finals_create_intent(p_org,p_actor,p_booking,p_property,coalesce(request_id,p_request),p_intent,p_sha256,p_bytes);
end $$;
create function public.photo_finals_inventory(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare inventory jsonb;
begin
 perform public.photo_finals_access(p_org,p_actor,p_booking,p_property,true);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into inventory from (
 select j.id as "jobId",b.id as "batchId",j.state,j.finals_deadline as "expiresAt",j.completed_at as "completedAt",j.finals_version_id as "versionId"
 from public.media_ingest_jobs j join public.media_batches b on b.organization_id=j.organization_id and b.id=j.batch_id
 where j.organization_id=p_org and j.property_id=p_property and b.booking_id=p_booking and j.finals_actor_id=p_actor and j.finals_version_id is not null
 order by j.created_at desc,j.id desc limit 101) x;
 -- Explicit bound, never claim an incomplete inventory is complete.
 return jsonb_build_object('items',inventory,'hasMore',jsonb_array_length(inventory)>100);
end $$;
create function public.photo_finals_reconcile_expired(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; settled integer:=0;
begin
 perform public.photo_finals_access(p_org,p_actor,p_booking,p_property,true);
 for j in select jobs.* from public.media_ingest_jobs jobs join public.media_batches b on b.organization_id=jobs.organization_id and b.id=jobs.batch_id
 where jobs.organization_id=p_org and jobs.property_id=p_property and b.booking_id=p_booking and jobs.finals_actor_id=p_actor and jobs.finals_version_id is not null
 and jobs.completed_at is null and jobs.finals_deadline<=clock_timestamp() and jobs.next_attempt_at<=clock_timestamp()
 and (jobs.finals_lease_expires_at is null or jobs.finals_lease_expires_at<=clock_timestamp())
 order by jobs.created_at,jobs.id limit 100 for update of jobs skip locked loop
  perform public.photo_finals_claim(p_org,p_booking,p_property,j.id,'application-reconciliation');
  if exists(select 1 from public.media_ingest_jobs where organization_id=p_org and id=j.id and completed_at is not null and state='dead_letter') then settled:=settled+1;end if;
 end loop;
 return settled;
end $$;
revoke all on function public.photo_finals_reconcile_expired(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.photo_finals_reconcile_expired(uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.photo_finals_recover_intent(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint),public.photo_finals_inventory(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.photo_finals_recover_intent(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint),public.photo_finals_inventory(uuid,uuid,uuid,uuid) to service_role;
