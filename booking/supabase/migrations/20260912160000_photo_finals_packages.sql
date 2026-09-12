-- Local code-dark approval + package worker; requires canonical + finals ingest.
-- Reuses releases/items/derivatives/packages/jobs. No credentials or routes.
alter table public.media_ingest_jobs add column finals_release_id uuid,
 add constraint finals_release_job_fkey foreign key(organization_id,finals_release_id,property_id,batch_id)
 references public.gallery_releases(organization_id,id,property_id,batch_id) on delete restrict,
 add constraint finals_release_job_shape check(finals_release_id is null or
 (job_kind='package' and finals_version_id is null and finals_actor_id is not null));
create unique index finals_release_one_job on public.media_ingest_jobs(organization_id,finals_release_id) where finals_release_id is not null;

create function public.photo_finals_release_job_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.finals_release_id is distinct from old.finals_release_id then raise exception 'finals_release_job_immutable' using errcode='23514'; end if;
 return new;
end $$;
create trigger finals_release_job_guard before update on public.media_ingest_jobs for each row execute function public.photo_finals_release_job_guard();
-- Preserve all existing ingest rules, allow only the package-specific bounded lifecycle.
create or replace function public.enforce_media_ingest_job_transition() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.id,new.organization_id,new.property_id,new.batch_id,new.provider_event_id,new.job_kind,new.idempotency_key,new.created_at)
 is distinct from (old.id,old.organization_id,old.property_id,old.batch_id,old.provider_event_id,old.job_kind,old.idempotency_key,old.created_at)
 then raise exception 'Media ingest job identity is immutable' using errcode='23514'; end if;
 if new.state is distinct from old.state then
  if old.finals_release_id is not null then
   if not ((old.state='discovered' and new.state in ('deriving','dead_letter')) or
    (old.state='deriving' and new.state in ('review_pending','retryable','dead_letter')) or
    (old.state='retryable' and new.state in ('deriving','dead_letter'))) then
     raise exception 'Invalid package job transition' using errcode='23514'; end if;
  elsif not public.is_valid_media_ingest_transition(old.state,new.state) then
   raise exception 'Invalid media ingest job transition' using errcode='23514';
  end if;
 end if;
 new.updated_at:=now();return new;
end $$;

create function public.photo_finals_release_actor(p_org uuid,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Membership/archive mutation participates through ordinary row locking.
 perform 1 from public.profiles p join public.organization_members m on m.organization_id=p.organization_id and m.profile_id=p.id
 where p.organization_id=p_org and p.id=p_actor for share of p,m;
 perform public.photo_finals_actor(p_org,p_actor);
end $$;

create function public.photo_finals_transform_specs() returns jsonb language sql immutable set search_path='' as $$
 select '{"full_res":{"id":"client.fullres.share.v1","version":1,"operation":"original_bytes","metadata":"preserve","status":"defined"},"gallery":{"id":"web.listing.2048.v1","version":1,"operation":"jpeg","encoder":"sharp-0.35.4_libvips-8.18.6_mozjpeg-0826579","progressive":false,"mozjpeg":false,"fit":"inside","maxSide":2048,"quality":82,"chroma":"4:2:0","orientation":"auto","colour":"srgb","metadata":"strip","enlarge":false,"status":"defined"},"mls":{"id":"ontario.proptx.provisional.2026-08-11.v1","version":1,"operation":"jpeg","encoder":"sharp-0.35.4_libvips-8.18.6_mozjpeg-0826579","progressive":false,"mozjpeg":false,"fit":"inside","maxSide":2048,"quality":90,"chroma":"4:2:0","orientation":"auto","colour":"srgb","metadata":"strip","enlarge":false,"status":"provisional","label":"Provisional MLS export — verify destination requirements"}}'::jsonb;
$$;

-- Version 2 hash is exclusively SHA256(UTF8(PostgreSQL jsonb::text)); clients echo
-- the opaque server digest. It deliberately does not alias selection.v1 JSON.stringify.
create function public.photo_finals_release_manifest(p_org uuid,p_booking uuid,p_property uuid,p_batch uuid,p_release uuid,p_revision integer,p_versions jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.media_versions; item jsonb; items jsonb:='[]'; n integer:=0; total bigint:=0; assets uuid[]:='{}';
begin
 if jsonb_typeof(p_versions) is distinct from 'array' or jsonb_array_length(p_versions) not between 1 and 100 then raise exception 'finals_selection_invalid' using errcode='22023';end if;
 if not exists(select 1 from public.media_batches where organization_id=p_org and id=p_batch and property_id=p_property and booking_id=p_booking)
 or not exists(select 1 from public.bookings where organization_id=p_org and id=p_booking and property_id=p_property) then raise exception 'finals_booking_denied' using errcode='42501';end if;
 -- Sorted locks avoid reversed-selection deadlocks; output uses submitted ordinality.
 perform 1 from public.media_versions where organization_id=p_org and id in(select value::uuid from jsonb_array_elements_text(p_versions)) order by id for share;
 for item in select value from jsonb_array_elements(p_versions) loop
  if jsonb_typeof(item) is distinct from 'string' then raise exception 'finals_selection_invalid' using errcode='22023';end if;
  select * into v from public.media_versions where organization_id=p_org and id=(item#>>'{}')::uuid and property_id=p_property and batch_id=p_batch;
  if not found or not coalesce(v.ingest_state in ('accepted','deriving','review_pending') and v.object_tier='master'
   and v.mime_type='image/jpeg' and v.accepted_at<=clock_timestamp() and v.byte_size between 1 and 33554432
   and v.width_px between 1 and 16384 and v.height_px between 1 and 16384 and v.width_px::bigint*v.height_px<=100000000
   and v.bucket_name is not null and octet_length(v.sha256)=32
   and v.object_key='masters/'||p_org||'/'||v.asset_id||'/'||v.id||'/'||encode(v.sha256,'hex')||'.jpg'
   and (v.rights_effective_at is null or v.rights_effective_at<=clock_timestamp())
   and (v.rights_expires_at is null or v.rights_expires_at>clock_timestamp()),false)
   or v.asset_id=any(assets) then raise exception 'finals_selection_invalid' using errcode='23514';end if;
  assets:=array_append(assets,v.asset_id);total:=total+v.byte_size;
  if total>1073741824 then raise exception 'finals_selection_bound' using errcode='54000';end if;
  items:=items||jsonb_build_array(jsonb_build_object('position',n,'media_version_id',v.id,'asset_id',v.asset_id,'version_number',v.version_number,
   'display_filename',lpad((n+1)::text,3,'0')||'.jpg','bucket_name',v.bucket_name,'object_key',v.object_key,'sha256',encode(v.sha256,'hex'),
   'byte_size',v.byte_size,'mime_type',v.mime_type,'width_px',v.width_px,'height_px',v.height_px,'edit_class',v.edit_class,'disclosure_class',v.disclosure_class,
   'rights_effective_at',v.rights_effective_at,'rights_expires_at',v.rights_expires_at));n:=n+1;
 end loop;
 return jsonb_build_object('kind','finished_jpeg_release.v2','manifest_version',2,'organization_id',p_org,'booking_id',p_booking,'property_id',p_property,
  'batch_id',p_batch,'release_id',p_release,'revision_number',p_revision,'transforms',public.photo_finals_transform_specs(),'items',items);
end $$;

create function public.photo_finals_prepare_release(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_batch uuid,p_release uuid,p_expected_revision integer,p_versions jsonb)
returns public.gallery_releases language plpgsql security invoker set search_path='' as $$
declare r public.gallery_releases; prev public.gallery_releases; m jsonb; item jsonb; d uuid; download_id uuid;
begin
 perform public.photo_finals_release_actor(p_org,p_actor);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finals-release:'||p_org||':'||p_batch,0));
 perform 1 from public.media_batches where organization_id=p_org and id=p_batch and booking_id=p_booking and property_id=p_property;
 if not found then raise exception 'finals_booking_denied' using errcode='42501';end if;
 select * into r from public.gallery_releases where organization_id=p_org and id=p_release;
 if found then
  if r.batch_id is distinct from p_batch or r.property_id is distinct from p_property or r.revision_number is distinct from p_expected_revision+1
   or (select jsonb_agg(x->'media_version_id' order by ord) from jsonb_array_elements(r.manifest->'items') with ordinality as t(x,ord)) is distinct from p_versions
   then raise exception 'finals_release_replay_conflict' using errcode='23514';end if;return r;
 end if;
 select * into prev from public.gallery_releases where organization_id=p_org and property_id=p_property and batch_id=p_batch order by revision_number desc limit 1;
 if p_expected_revision is null or coalesce(prev.revision_number,0)<>p_expected_revision then raise exception 'finals_stale_revision' using errcode='40001';end if;
 m:=public.photo_finals_release_manifest(p_org,p_booking,p_property,p_batch,p_release,p_expected_revision+1,p_versions);
 insert into public.gallery_releases(id,organization_id,property_id,batch_id,revision_number,supersedes_release_id,manifest_version,manifest,manifest_sha256,created_by)
 values(p_release,p_org,p_property,p_batch,p_expected_revision+1,prev.id,2,m,pg_catalog.sha256(convert_to(m::text,'UTF8')),p_actor) returning * into r;
 for item in select value from jsonb_array_elements(m->'items') loop
  insert into public.media_derivatives(organization_id,property_id,batch_id,source_version_id,profile_id,profile_version,derivative_class,profile_status)
  values(p_org,p_property,p_batch,(item->>'media_version_id')::uuid,'web.listing.2048.v1',1,'web','defined') on conflict(organization_id,source_version_id,profile_id,profile_version) do nothing;
  select id into d from public.media_derivatives where organization_id=p_org and source_version_id=(item->>'media_version_id')::uuid and profile_id='web.listing.2048.v1' and profile_version=1;
  insert into public.media_derivatives(organization_id,property_id,batch_id,source_version_id,profile_id,profile_version,derivative_class,profile_status)
  values(p_org,p_property,p_batch,(item->>'media_version_id')::uuid,'ontario.proptx.provisional.2026-08-11.v1',1,'mls','provisional') on conflict(organization_id,source_version_id,profile_id,profile_version) do nothing;
  select id into download_id from public.media_derivatives where organization_id=p_org and source_version_id=(item->>'media_version_id')::uuid and profile_id='ontario.proptx.provisional.2026-08-11.v1' and profile_version=1;
  insert into public.gallery_release_items(organization_id,property_id,batch_id,release_id,media_version_id,display_derivative_id,download_derivative_id,position,display_filename)
  values(p_org,p_property,p_batch,r.id,(item->>'media_version_id')::uuid,d,download_id,(item->>'position')::integer,item->>'display_filename');
 end loop;
 update public.gallery_releases set state='review_pending' where organization_id=p_org and id=r.id returning * into r;return r;
end $$;

create function public.photo_finals_approve_release(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_release uuid,p_revision integer,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.gallery_releases; m jsonb; b public.media_batches; ids jsonb; j uuid;
begin
 perform public.photo_finals_release_actor(p_org,p_actor);
 select * into r from public.gallery_releases where organization_id=p_org and id=p_release;
 if not found or r.property_id is distinct from p_property or not exists(select 1 from public.media_batches where organization_id=p_org and id=r.batch_id and booking_id=p_booking and property_id=p_property) then raise exception 'finals_release_denied' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finals-release:'||p_org||':'||r.batch_id,0));
 select * into b from public.media_batches where organization_id=p_org and id=r.batch_id;
 select * into r from public.gallery_releases where organization_id=p_org and id=p_release for update;
 if p_revision is distinct from r.revision_number or p_hash is distinct from encode(r.manifest_sha256,'hex') then raise exception 'finals_stale_selection' using errcode='40001';end if;
 if r.approved_at is not null then
  select id into j from public.media_ingest_jobs where organization_id=p_org and finals_release_id=r.id;
  if j is null then raise exception 'finals_job_missing' using errcode='23514';end if;
  return jsonb_build_object('id',r.id,'state',r.state,'job_id',j);
 end if;
 if r.state<>'review_pending' or exists(select 1 from public.gallery_releases where organization_id=p_org and batch_id=r.batch_id and revision_number>r.revision_number) then raise exception 'finals_stale_revision' using errcode='40001';end if;
 select jsonb_agg(to_jsonb(media_version_id) order by position) into ids from public.gallery_release_items where organization_id=p_org and release_id=r.id;
 m:=public.photo_finals_release_manifest(p_org,b.booking_id,r.property_id,r.batch_id,r.id,r.revision_number,ids);
 if m is distinct from r.manifest or pg_catalog.sha256(convert_to(m::text,'UTF8')) is distinct from r.manifest_sha256 or exists(select 1 from public.gallery_release_items i where i.organization_id=p_org and i.release_id=r.id and
  (i.position not between 0 and jsonb_array_length(ids)-1 or i.display_filename<>lpad((i.position+1)::text,3,'0')||'.jpg'
   or not exists(select 1 from public.media_derivatives d where d.organization_id=p_org and d.id=i.display_derivative_id and d.source_version_id=i.media_version_id and d.profile_id='web.listing.2048.v1' and d.profile_version=1)
   or not exists(select 1 from public.media_derivatives d where d.organization_id=p_org and d.id=i.download_derivative_id and d.source_version_id=i.media_version_id and d.profile_id='ontario.proptx.provisional.2026-08-11.v1' and d.profile_version=1))) then raise exception 'finals_stale_selection' using errcode='40001';end if;
 update public.gallery_release_items set approval_state='approved',approved_by=p_actor,approved_at=clock_timestamp() where organization_id=p_org and release_id=r.id;
 update public.gallery_releases set state='approved',approved_by=p_actor,approved_at=clock_timestamp() where organization_id=p_org and id=r.id;
 insert into public.media_packages(organization_id,property_id,batch_id,release_id,package_type,manifest_sha256)
 select p_org,r.property_id,r.batch_id,r.id,x,r.manifest_sha256 from unnest(array['full_res_zip','mls_zip']) x;
 insert into public.media_ingest_jobs(organization_id,property_id,batch_id,job_kind,idempotency_key,finals_release_id,finals_actor_id)
 values(p_org,r.property_id,r.batch_id,'package','finals_package:'||r.id,r.id,p_actor) returning id into j;
 update public.gallery_releases set state='packaging' where organization_id=p_org and id=r.id;
 return jsonb_build_object('id',r.id,'state','packaging','job_id',j);
end $$;

create function public.photo_finals_package_claim(p_org uuid,p_booking uuid,p_property uuid,p_job uuid,p_worker text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; r public.gallery_releases; b public.media_batches;
begin
 if p_worker is null or p_worker !~ '^[a-zA-Z0-9_-]{1,96}$' then raise exception 'finals_worker_invalid' using errcode='22023';end if;
 select * into j from public.media_ingest_jobs where organization_id=p_org and id=p_job and property_id=p_property and finals_release_id is not null
 and batch_id in(select id from public.media_batches where organization_id=p_org and booking_id=p_booking and property_id=p_property) for update;
 if not found or j.completed_at is not null or j.next_attempt_at>clock_timestamp() or j.finals_lease_expires_at>clock_timestamp() then return null;end if;
 select * into r from public.gallery_releases where organization_id=p_org and id=j.finals_release_id for update;
 if j.finals_lease_token is not null then perform public.photo_finals_attempt(j,'retryable');end if;
 if j.attempts>=j.max_attempts or r.state<>'packaging' then
  update public.media_ingest_jobs set state='dead_letter',completed_at=clock_timestamp(),finals_lease_token=null,finals_lease_started_at=null,finals_lease_expires_at=null,finals_worker_id=null where organization_id=p_org and id=p_job;return null;
 end if;
 perform public.photo_finals_release_actor(p_org,j.finals_actor_id);
 update public.media_ingest_jobs set state='deriving',attempts=attempts+1,finals_lease_token=gen_random_uuid(),finals_lease_started_at=clock_timestamp(),finals_lease_expires_at=clock_timestamp()+interval '120 seconds',finals_worker_id=p_worker where organization_id=p_org and id=p_job returning * into j;
 select * into b from public.media_batches where organization_id=p_org and id=j.batch_id;
 return jsonb_build_object('job',to_jsonb(j),'release',to_jsonb(r),'booking_id',b.booking_id);
end $$;

create function public.photo_finals_package_fence(p_org uuid,p_job uuid,p_lease uuid) returns public.media_ingest_jobs language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs;
begin
 select * into j from public.media_ingest_jobs where organization_id=p_org and id=p_job and finals_release_id is not null for update;
 if not found or j.state<>'deriving' or j.completed_at is not null or j.finals_lease_token is distinct from p_lease or j.finals_lease_expires_at<=clock_timestamp() or p_lease is null then raise exception 'finals_lease_lost' using errcode='40001';end if;
 perform 1 from public.gallery_releases where organization_id=p_org and id=j.finals_release_id and state='packaging' for update;
 if not found then raise exception 'finals_release_unavailable' using errcode='23514';end if;
 perform public.photo_finals_release_actor(p_org,j.finals_actor_id);return j;
end $$;

create function public.photo_finals_package_heartbeat(p_org uuid,p_job uuid,p_lease uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.photo_finals_package_fence(p_org,p_job,p_lease);
 update public.media_ingest_jobs set finals_lease_expires_at=clock_timestamp()+interval '120 seconds' where organization_id=p_org and id=p_job;
end $$;

-- Every evidence element is required; NULL never satisfies readiness. Worker drains
-- actual stored bytes first. One transaction publishes both packages AND all derivatives.
create function public.photo_finals_package_finish(p_org uuid,p_job uuid,p_lease uuid,p_evidence jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; r public.gallery_releases; e jsonb; i public.gallery_release_items; d public.media_derivatives; p public.media_packages; n integer:=0; key text; h bytea;
begin
 j:=public.photo_finals_package_fence(p_org,p_job,p_lease);
 select * into r from public.gallery_releases where organization_id=p_org and id=j.finals_release_id;
 if jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence)<>2+2*jsonb_array_length(r.manifest->'items') then raise exception 'finals_evidence_incomplete' using errcode='23514';end if;
 for e in select value from jsonb_array_elements(p_evidence) loop
  if not coalesce(jsonb_typeof(e)='object' and e ?& array['kind','sha256','bytes','bucket','key'] and jsonb_typeof(e->'kind')='string'
   and jsonb_typeof(e->'sha256')='string' and e->>'sha256' ~ '^[0-9a-f]{64}$'
   and jsonb_typeof(e->'bytes')='number' and (e->>'bytes')::bigint between 1 and 1100000000
   and jsonb_typeof(e->'bucket')='string' and e->>'bucket' ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
   and jsonb_typeof(e->'key')='string',false) then raise exception 'finals_evidence_invalid' using errcode='23514';end if;
  h:=decode(e->>'sha256','hex');
  if e->>'kind' in ('full_res_zip','mls_zip') then
   key:='packages/'||p_org||'/'||r.id||'/'||(e->>'kind')||'/'||(e->>'sha256')||'.zip';
   if e->>'key' is distinct from key or not coalesce(jsonb_typeof(e->'entries')='number' and (e->>'entries')::integer=jsonb_array_length(r.manifest->'items'),false) then raise exception 'finals_package_evidence_invalid' using errcode='23514';end if;
   select * into p from public.media_packages where organization_id=p_org and release_id=r.id and package_type=e->>'kind' for update;
   if not found or p.status='ready' then raise exception 'finals_duplicate_evidence' using errcode='23514';end if;
   update public.media_packages set status='building' where organization_id=p_org and id=p.id;
   update public.media_packages set status='ready',bucket_name=e->>'bucket',object_key=key,package_sha256=h,byte_size=(e->>'bytes')::bigint,entry_count=(e->>'entries')::integer,ready_at=clock_timestamp() where organization_id=p_org and id=p.id;
  elsif e->>'kind' in ('gallery','mls') then
   if not coalesce(e ?& array['version_id','width','height'] and jsonb_typeof(e->'version_id')='string' and jsonb_typeof(e->'width')='number' and jsonb_typeof(e->'height')='number'
    and (e->>'width')::integer between 1 and 2048 and (e->>'height')::integer between 1 and 2048 and (e->>'bytes')::bigint<=33554432,false) then raise exception 'finals_derivative_evidence_invalid' using errcode='23514';end if;
   select * into i from public.gallery_release_items where organization_id=p_org and release_id=r.id and media_version_id=(e->>'version_id')::uuid;
   if not found then raise exception 'finals_derivative_evidence_invalid' using errcode='23514';end if;
   key:='derivatives/'||p_org||'/'||i.media_version_id||'/1/'||(e->>'sha256')||'.jpg';
   if e->>'key' is distinct from key then raise exception 'finals_derivative_evidence_invalid' using errcode='23514';end if;
   -- Duplicate evidence is rejected even when a canonical derivative was reused.
   if (select count(*) from jsonb_array_elements(p_evidence) x where x->>'kind'=e->>'kind' and x->>'version_id'=e->>'version_id')<>1 then raise exception 'finals_duplicate_evidence' using errcode='23514';end if;
   select * into d from public.media_derivatives where organization_id=p_org and id=case when e->>'kind'='gallery' then i.display_derivative_id else i.download_derivative_id end for update;
   if d.status='ready' then
    if (d.object_key,d.bucket_name,d.sha256,d.byte_size,d.width_px,d.height_px) is distinct from (key,e->>'bucket',h,(e->>'bytes')::bigint,(e->>'width')::integer,(e->>'height')::integer) then raise exception 'finals_derivative_conflict' using errcode='23514';end if;
   else
    update public.media_derivatives set status='processing' where organization_id=p_org and id=d.id;
    update public.media_derivatives set status='ready',bucket_name=e->>'bucket',object_key=key,sha256=h,byte_size=(e->>'bytes')::bigint,mime_type='image/jpeg',width_px=(e->>'width')::integer,height_px=(e->>'height')::integer,ready_at=clock_timestamp() where organization_id=p_org and id=d.id;
   end if;
  else raise exception 'finals_evidence_invalid' using errcode='23514';end if;n:=n+1;
 end loop;
 if (select count(*) from public.media_packages where organization_id=p_org and release_id=r.id and status='ready')<>2
 or exists(select 1 from public.gallery_release_items ri join public.media_derivatives md on md.organization_id=ri.organization_id and md.id in(ri.display_derivative_id,ri.download_derivative_id) where ri.organization_id=p_org and ri.release_id=r.id and md.status<>'ready') then raise exception 'finals_evidence_incomplete' using errcode='23514';end if;
 -- Rights may expire while encoding. Verify current selected versions once more.
 perform public.photo_finals_release_manifest(p_org,(r.manifest->>'booking_id')::uuid,r.property_id,r.batch_id,r.id,r.revision_number,
  (select jsonb_agg(x->'media_version_id' order by ord) from jsonb_array_elements(r.manifest->'items') with ordinality t(x,ord)));
 perform public.photo_finals_package_fence(p_org,p_job,p_lease);
 perform public.photo_finals_attempt(j,'succeeded');
 update public.media_ingest_jobs set state='review_pending',completed_at=clock_timestamp(),finals_lease_token=null,finals_lease_started_at=null,finals_lease_expires_at=null,finals_worker_id=null where organization_id=p_org and id=p_job;
 update public.gallery_releases set state='ready' where organization_id=p_org and id=r.id;
end $$;

create function public.photo_finals_package_fail(p_org uuid,p_job uuid,p_lease uuid) returns void language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; terminal boolean;
begin
 j:=public.photo_finals_package_fence(p_org,p_job,p_lease);terminal:=j.attempts>=j.max_attempts;
 perform public.photo_finals_attempt(j,case when terminal then 'dead_letter' else 'retryable' end);
 update public.media_ingest_jobs set state=case when terminal then 'dead_letter' else 'retryable' end,completed_at=case when terminal then clock_timestamp() else null end,
 next_attempt_at=clock_timestamp()+interval '10 seconds',last_error_code='finals_package_failed',last_error_at=clock_timestamp(),
 finals_lease_token=null,finals_lease_started_at=null,finals_lease_expires_at=null,finals_worker_id=null where organization_id=p_org and id=p_job;
end $$;
create function public.photo_finals_package_due(p_org uuid,p_booking uuid,p_property uuid) returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(id),'[]') from(select j.id from public.media_ingest_jobs j join public.media_batches b on b.organization_id=j.organization_id and b.id=j.batch_id
 where j.organization_id=p_org and j.property_id=p_property and b.booking_id=p_booking and j.finals_release_id is not null and j.completed_at is null
 and j.next_attempt_at<=clock_timestamp() and (j.finals_lease_expires_at is null or j.finals_lease_expires_at<=clock_timestamp()) order by j.next_attempt_at,j.id limit 1) due;
$$;

create function public.photo_finals_ready_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.manifest->>'kind'='finished_jpeg_release.v2' and new.state in ('ready','published') then
  if (select count(*) from public.media_packages where organization_id=new.organization_id and release_id=new.id and status='ready')<>2
   or not exists(select 1 from public.media_ingest_jobs where organization_id=new.organization_id and finals_release_id=new.id and state='review_pending' and completed_at is not null)
   or (select count(*) from public.gallery_release_items where organization_id=new.organization_id and release_id=new.id)<>jsonb_array_length(new.manifest->'items')
   or exists(select 1 from public.gallery_release_items ri left join public.media_derivatives md on md.organization_id=ri.organization_id and md.id=ri.display_derivative_id
    left join public.media_derivatives dl on dl.organization_id=ri.organization_id and dl.id=ri.download_derivative_id
    where ri.organization_id=new.organization_id and ri.release_id=new.id and (md.status is distinct from 'ready' or dl.status is distinct from 'ready'))
   then raise exception 'finals_release_not_complete' using errcode='23514';end if;
 end if;return new;
end $$;
create trigger finals_ready_guard before update on public.gallery_releases for each row execute function public.photo_finals_ready_guard();
revoke all on function public.photo_finals_ready_guard() from public,anon,authenticated;
grant execute on function public.photo_finals_ready_guard() to service_role;

-- All new RPCs are service-only, including helper functions. Forced RLS unchanged.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('photo_finals_release_job_guard','photo_finals_release_actor','photo_finals_transform_specs','photo_finals_release_manifest','photo_finals_prepare_release','photo_finals_approve_release','photo_finals_package_claim','photo_finals_package_fence','photo_finals_package_heartbeat','photo_finals_package_finish','photo_finals_package_fail','photo_finals_package_due') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
