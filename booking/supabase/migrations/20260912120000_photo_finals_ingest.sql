-- Code-dark, additive; requires canonical_media_releases. No storage configuration.
-- One canonical job is the durable file intent. Hash collisions are rejected, never shared.
alter table public.media_ingest_jobs
  add column finals_version_id uuid,
  add column finals_sha256 bytea,
  add column finals_byte_size bigint,
  add column finals_quarantine_key text,
  add column finals_actor_id uuid,
  add column finals_deadline timestamptz,
  add column finals_lease_token uuid,
  add column finals_lease_started_at timestamptz,
  add column finals_lease_expires_at timestamptz,
  add column finals_worker_id text,
  add constraint finals_version_fkey foreign key (organization_id,finals_version_id,property_id,batch_id)
    references public.media_versions(organization_id,id,property_id,batch_id) on delete restrict,
  add constraint finals_actor_fkey foreign key (organization_id,finals_actor_id)
    references public.profiles(organization_id,id) on delete restrict,
  add constraint finals_intent_shape check (finals_version_id is null or coalesce((
    job_kind='ingest' and octet_length(finals_sha256)=32 and finals_byte_size between 1 and 33554432
    and finals_quarantine_key ~ ('^quarantine/'||organization_id||'/'||id||'/[0-9a-f-]{36}$')
    and finals_actor_id is not null and finals_deadline is not null),false)),
  add constraint finals_lease_shape check (
    (finals_lease_token is null and finals_lease_started_at is null and finals_lease_expires_at is null and finals_worker_id is null)
    or (finals_lease_token is not null and finals_lease_started_at is not null and finals_lease_expires_at is not null
        and finals_lease_expires_at>finals_lease_started_at and finals_worker_id is not null));
create unique index finals_reserved_hash on public.media_ingest_jobs(organization_id,finals_sha256) where finals_version_id is not null;
create index finals_due on public.media_ingest_jobs(organization_id,next_attempt_at) where finals_version_id is not null and completed_at is null;

create function public.photo_finals_actor(p_org uuid,p_actor uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if not exists (select 1 from public.profiles p join public.organization_members m
    on m.organization_id=p.organization_id and m.profile_id=p.id
    where p.organization_id=p_org and p.id=p_actor and p.archived_at is null
      and p.role='admin' and m.role in ('owner','admin')) then
    raise exception 'finals_actor_denied' using errcode='42501';
  end if;
end $$;

create function public.photo_finals_intent_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.finals_version_id,new.finals_sha256,new.finals_byte_size,new.finals_quarantine_key,new.finals_actor_id,new.finals_deadline)
 is distinct from (old.finals_version_id,old.finals_sha256,old.finals_byte_size,old.finals_quarantine_key,old.finals_actor_id,old.finals_deadline) then
 raise exception 'finals_intent_immutable' using errcode='23514'; end if;
 return new;
end $$;
create trigger finals_intent_immutable before update on public.media_ingest_jobs
for each row execute function public.photo_finals_intent_immutable();

create function public.photo_finals_create_intent(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_request uuid,p_intent uuid,p_sha256 text,p_bytes bigint)
returns public.media_ingest_jobs language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; b public.media_batches; a uuid; v uuid;
begin
 perform public.photo_finals_actor(p_org,p_actor);
 if p_request is null or p_intent is null or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
 or p_bytes is null or p_bytes not between 1 and 33554432 then raise exception 'finals_input_invalid' using errcode='22023'; end if;
 -- All intent/quota writers serialize by tenant; idempotency before mutable quota checks.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finals:'||p_org,0));
 if not exists(select 1 from public.bookings where organization_id=p_org and id=p_booking and property_id=p_property) then
 raise exception 'finals_booking_denied' using errcode='42501'; end if;
 select * into j from public.media_ingest_jobs where organization_id=p_org and idempotency_key='manual_finals:'||p_intent;
 if found then
   if j.finals_sha256 is distinct from decode(p_sha256,'hex') or j.finals_byte_size is distinct from p_bytes or j.property_id<>p_property
   or not exists(select 1 from public.media_batches where organization_id=p_org and id=j.batch_id and booking_id=p_booking and provider_job_id=p_request::text)
   then raise exception 'finals_intent_payload_conflict' using errcode='23514'; end if;
   return j;
 end if;
 if exists(select 1 from public.media_versions where organization_id=p_org and sha256=decode(p_sha256,'hex') and accepted_at is not null)
 or exists(select 1 from public.media_ingest_jobs where organization_id=p_org and finals_sha256=decode(p_sha256,'hex')) then
 raise exception 'finals_hash_collision_other_intent_or_booking' using errcode='23505'; end if;
 if (select count(*) from public.media_ingest_jobs where organization_id=p_org and finals_version_id is not null and completed_at is null)>=32
 or (select count(*) from public.media_ingest_jobs where organization_id=p_org and finals_version_id is not null and created_at>clock_timestamp()-interval '1 hour')>=200 then
 raise exception 'finals_tenant_quota' using errcode='54000'; end if;
 select * into b from public.media_batches where organization_id=p_org and source_provider='manual_finals'
 and provider_connection_key='manual_finals.v1' and provider_job_id=p_request::text and provider_revision=0;
 if found and (b.booking_id<>p_booking or b.property_id<>p_property) then raise exception 'finals_batch_conflict' using errcode='23514'; end if;
 if b.id is null then
 insert into public.media_batches(organization_id,property_id,booking_id,source_provider,provider_connection_key,provider_job_id,created_by)
 values(p_org,p_property,p_booking,'manual_finals','manual_finals.v1',p_request::text,p_actor) returning * into b;
 end if;
 if (select count(*) from public.media_ingest_jobs where organization_id=p_org and batch_id=b.id)>=100
 or (select coalesce(sum(finals_byte_size),0) from public.media_ingest_jobs where organization_id=p_org and batch_id=b.id)+p_bytes>1073741824 then
 raise exception 'finals_batch_quota' using errcode='54000'; end if;
 insert into public.media_assets(organization_id,property_id,batch_id,source_provider,provider_connection_key,provider_job_id,provider_output_id)
 values(p_org,p_property,b.id,'manual_finals','manual_finals.v1',p_request::text,p_intent::text) returning id into a;
 insert into public.media_versions(organization_id,property_id,batch_id,asset_id,version_number)
 values(p_org,p_property,b.id,a,1) returning id into v;
 insert into public.media_ingest_jobs(id,organization_id,property_id,batch_id,job_kind,idempotency_key,finals_version_id,finals_sha256,finals_byte_size,finals_quarantine_key,finals_actor_id,finals_deadline)
 values(p_intent,p_org,p_property,b.id,'ingest','manual_finals:'||p_intent,v,decode(p_sha256,'hex'),p_bytes,
 'quarantine/'||p_org||'/'||p_intent||'/'||pg_catalog.gen_random_uuid(),p_actor,clock_timestamp()+interval '24 hours') returning * into j;
 update public.media_versions set ingest_state='url_ready' where organization_id=p_org and id=v;
 update public.media_ingest_jobs set state='url_ready' where organization_id=p_org and id=j.id returning * into j;
 return j;
end $$;

-- Attempts are append-only: write the final outcome once, including expired takeovers.
create function public.photo_finals_attempt(p_job public.media_ingest_jobs,p_outcome text) returns void
language sql security invoker set search_path='' as $$
 insert into public.media_job_attempts(organization_id,property_id,batch_id,job_id,attempt_number,worker_id,outcome,started_at,finished_at)
 values(p_job.organization_id,p_job.property_id,p_job.batch_id,p_job.id,p_job.attempts,p_job.finals_worker_id,p_outcome,p_job.finals_lease_started_at,clock_timestamp());
$$;

create function public.photo_finals_claim(p_org uuid,p_booking uuid,p_property uuid,p_job uuid,p_worker text) returns public.media_ingest_jobs
language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs;
begin
 if p_worker is null or p_worker !~ '^[a-zA-Z0-9_-]{1,96}$' then raise exception 'finals_worker_invalid' using errcode='22023'; end if;
 -- Validate exact eligible scope before recording attempts, expiry or lease changes.
 select jobs.* into j from public.media_ingest_jobs jobs
 join public.media_batches b on b.organization_id=jobs.organization_id and b.id=jobs.batch_id and b.property_id=jobs.property_id
 where jobs.organization_id=p_org and jobs.property_id=p_property and b.booking_id=p_booking
 and jobs.id=p_job and jobs.finals_version_id is not null for update of jobs;
 if not found or j.completed_at is not null or j.next_attempt_at>clock_timestamp() or j.finals_lease_expires_at>clock_timestamp() then return null; end if;
 perform public.photo_finals_actor(p_org,j.finals_actor_id);
 if j.finals_lease_token is not null then perform public.photo_finals_attempt(j,'retryable'); end if;
 if j.attempts>=j.max_attempts or j.finals_deadline<=clock_timestamp() then
 update public.media_ingest_jobs set state='dead_letter',completed_at=clock_timestamp(),finals_lease_token=null,finals_lease_started_at=null,finals_lease_expires_at=null,finals_worker_id=null
 where organization_id=p_org and id=p_job;
 update public.media_versions set ingest_state='dead_letter' where organization_id=p_org and id=j.finals_version_id;
 return null;
 end if;
 update public.media_ingest_jobs set state=case when state in ('url_ready','retryable') then 'fetching' else state end,attempts=attempts+1,finals_lease_token=pg_catalog.gen_random_uuid(),
 finals_lease_started_at=clock_timestamp(),finals_lease_expires_at=clock_timestamp()+interval '120 seconds',finals_worker_id=p_worker
 where organization_id=p_org and id=p_job returning * into j;
 update public.media_versions set ingest_state=j.state where organization_id=p_org and id=j.finals_version_id;
 return j;
end $$;

create function public.photo_finals_fence(p_org uuid,p_job uuid,p_lease uuid) returns public.media_ingest_jobs
language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs;
begin
 select * into j from public.media_ingest_jobs where organization_id=p_org and id=p_job and finals_version_id is not null for update;
 if not found or j.completed_at is not null or j.finals_lease_token is distinct from p_lease or p_lease is null
 or j.finals_lease_expires_at<=clock_timestamp() or j.finals_lease_expires_at is null then raise exception 'finals_lease_lost' using errcode='55000'; end if;
 perform public.photo_finals_actor(p_org,j.finals_actor_id);
 return j;
end $$;

create function public.photo_finals_stage(p_org uuid,p_job uuid,p_lease uuid,p_stage text) returns void
language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; stages text[]:=array['fetching','quarantined','validating','scanning']; old_pos integer; new_pos integer;
begin
 j:=public.photo_finals_fence(p_org,p_job,p_lease);
 old_pos:=array_position(stages,j.state); new_pos:=array_position(stages,p_stage);
 if old_pos is null or new_pos is null or new_pos<2 or new_pos>old_pos+1 then raise exception 'finals_stage_invalid' using errcode='22023'; end if;
 -- Reclaimed workers may safely repeat completed validation work without moving state backwards.
 if new_pos<=old_pos then return; end if;
 update public.media_versions set ingest_state=p_stage where organization_id=p_org and id=j.finals_version_id;
 update public.media_ingest_jobs set state=p_stage where organization_id=p_org and id=j.id;
end $$;
revoke all on function public.photo_finals_stage(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.photo_finals_stage(uuid,uuid,uuid,text) to service_role;

create function public.photo_finals_accept(p_org uuid,p_job uuid,p_lease uuid,p_bucket text,p_width integer,p_height integer)
returns public.media_versions language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; v public.media_versions; s text;
begin
 j:=public.photo_finals_fence(p_org,p_job,p_lease);
 if p_bucket is null or p_bucket !~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'
 or p_width is null or p_height is null or p_width not between 1 and 16384 or p_height not between 1 and 16384
 or p_width::bigint*p_height>100000000 then raise exception 'finals_evidence_invalid' using errcode='22023'; end if;
 select * into v from public.media_versions where organization_id=p_org and id=j.finals_version_id for update;
 if exists(select 1 from public.media_versions where organization_id=p_org and sha256=j.finals_sha256 and accepted_at is not null and id<>v.id) then
 raise exception 'finals_hash_collision_other_intent_or_booking' using errcode='23505'; end if;
 if j.state<>'scanning' then raise exception 'finals_scan_required' using errcode='55000'; end if;
 update public.media_versions set ingest_state='accepted',accepted_at=clock_timestamp(),object_tier='master',bucket_name=p_bucket,
 object_key='masters/'||p_org||'/'||v.asset_id||'/'||v.id||'/'||encode(j.finals_sha256,'hex')||'.jpg',sha256=j.finals_sha256,
 byte_size=j.finals_byte_size,mime_type='image/jpeg',width_px=p_width,height_px=p_height
 where organization_id=p_org and id=v.id returning * into v;
 perform public.photo_finals_attempt(j,'succeeded');
 update public.media_ingest_jobs set state='accepted',completed_at=clock_timestamp(),finals_lease_token=null,finals_lease_started_at=null,finals_lease_expires_at=null,finals_worker_id=null
 where organization_id=p_org and id=j.id;
 return v;
end $$;

create function public.photo_finals_fail(p_org uuid,p_job uuid,p_lease uuid,p_reject boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; s text;
begin
 j:=public.photo_finals_fence(p_org,p_job,p_lease);
 if p_reject is null then raise exception 'finals_outcome_invalid' using errcode='22023'; end if;
 s:=case when p_reject then 'rejected' when j.attempts>=j.max_attempts then 'dead_letter' else 'retryable' end;
 perform public.photo_finals_attempt(j,s);
 -- Retain checkpoint phases whose canonical transition graph has no retryable edge.
 -- A cleared lease + due time makes these phases reclaimable without weakening
 -- shared job/version transitions (including the later package migration).
 update public.media_versions set ingest_state=case when s='retryable' and j.state in ('quarantined','validating') then j.state else s end where organization_id=p_org and id=j.finals_version_id;
 update public.media_ingest_jobs set state=case when s='retryable' and j.state in ('quarantined','validating') then j.state else s end,completed_at=case when s='retryable' then null else clock_timestamp() end,
 next_attempt_at=clock_timestamp()+interval '30 seconds',finals_lease_token=null,finals_lease_started_at=null,finals_lease_expires_at=null,finals_worker_id=null
 where organization_id=p_org and id=j.id;
end $$;

-- Server-only snapshot authorizes the exact one-object promotion, never a browser DTO.
create function public.photo_finals_target(p_org uuid,p_job uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; result jsonb;
begin
 j:=public.photo_finals_fence(p_org,p_job,p_lease);
 select jsonb_build_object('job',to_jsonb(j),'version',to_jsonb(v),'booking_id',b.booking_id) into result
 from public.media_versions v join public.media_batches b on b.organization_id=v.organization_id and b.id=v.batch_id
 where v.organization_id=p_org and v.id=j.finals_version_id;
 return result;
end $$;
revoke all on function public.photo_finals_target(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.photo_finals_target(uuid,uuid,uuid) to service_role;

-- Fixed-size advisory due list; the exact job claim remains authoritative.
create function public.photo_finals_due(p_org uuid,p_booking uuid,p_property uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(t.id),'[]'::jsonb) from (
 select j.id from public.media_ingest_jobs j join public.media_batches b on b.organization_id=j.organization_id and b.id=j.batch_id
 where j.organization_id=p_org and j.property_id=p_property and b.booking_id=p_booking
 and j.finals_version_id is not null and j.completed_at is null and j.next_attempt_at<=clock_timestamp()
 and (j.finals_lease_expires_at is null or j.finals_lease_expires_at<=clock_timestamp())
 order by j.next_attempt_at,j.id limit 2) t;
$$;
revoke all on function public.photo_finals_due(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.photo_finals_due(uuid,uuid,uuid) to service_role;

-- Explicitly service-only, invoker security; actor IDs come only from authenticated server context.
revoke all on function public.photo_finals_actor(uuid,uuid),public.photo_finals_intent_immutable(),
 public.photo_finals_create_intent(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint),public.photo_finals_attempt(public.media_ingest_jobs,text),
 public.photo_finals_claim(uuid,uuid,uuid,uuid,text),public.photo_finals_fence(uuid,uuid,uuid),
 public.photo_finals_accept(uuid,uuid,uuid,text,integer,integer),public.photo_finals_fail(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.photo_finals_actor(uuid,uuid),public.photo_finals_intent_immutable(),
 public.photo_finals_create_intent(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint),public.photo_finals_attempt(public.media_ingest_jobs,text),
 public.photo_finals_claim(uuid,uuid,uuid,uuid,text),public.photo_finals_fence(uuid,uuid,uuid),
 public.photo_finals_accept(uuid,uuid,uuid,text,integer,integer),public.photo_finals_fail(uuid,uuid,uuid,boolean) to service_role;
