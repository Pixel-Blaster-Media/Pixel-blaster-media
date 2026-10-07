-- Security-patched encoder revision. Apply only with PHOTO_FINALS_ENABLED,
-- PHOTO_FINALS_DISPATCH_ENABLED and operator smoke disabled in production.
-- No historical release, derivative, checkpoint or package is rewritten.
-- A new revision/profile and key namespace keep old approved bytes immutable.
-- Existing ready packages remain readable by both app versions while gates stay off.
-- Refuse rollout if any previous encoder work still needs operator resolution.
set local lock_timeout='5s';
lock table public.gallery_releases, public.media_ingest_jobs, public.media_derivatives, public.media_packages in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.gallery_releases where manifest->>'kind'='finished_jpeg_release.v2')
 or exists(select 1 from public.media_ingest_jobs where finals_release_id is not null)
 or exists(select 1 from public.media_packages where release_id in (select id from public.gallery_releases where manifest->>'kind'='finished_jpeg_release.v2'))
 or exists(select 1 from public.media_derivatives where profile_id in ('web.listing.2048.v1','ontario.proptx.provisional.2026-08-11.v1'))
 then raise exception 'finals_encoder_upgrade_existing_state' using errcode='55000';end if;
end $$;

create or replace function public.photo_finals_transform_specs() returns jsonb language sql immutable set search_path='' set lock_timeout='5s' as $$
 select '{"full_res":{"id":"client.fullres.share.v1","version":1,"operation":"original_bytes","metadata":"preserve","status":"defined"},"gallery":{"id":"web.listing.2048.v1","version":2,"operation":"jpeg","encoder":"sharp-0.35.5_libvips-8.18.7_mozjpeg-0826579","progressive":false,"mozjpeg":false,"fit":"inside","maxSide":2048,"quality":82,"chroma":"4:2:0","orientation":"auto","colour":"srgb","metadata":"strip","enlarge":false,"status":"defined"},"mls":{"id":"ontario.proptx.provisional.2026-08-11.v1","version":2,"operation":"jpeg","encoder":"sharp-0.35.5_libvips-8.18.7_mozjpeg-0826579","progressive":false,"mozjpeg":false,"fit":"inside","maxSide":2048,"quality":90,"chroma":"4:2:0","orientation":"auto","colour":"srgb","metadata":"strip","enlarge":false,"status":"provisional","label":"Provisional MLS export — verify destination requirements"}}'::jsonb;
$$;

create or replace function public.photo_finals_prepare_release(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_batch uuid,p_release uuid,p_expected_revision integer,p_versions jsonb)
returns public.gallery_releases language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r public.gallery_releases; prev public.gallery_releases; m jsonb; item jsonb; d uuid; download_id uuid;
begin
 perform public.photo_finals_identifiers(p_org::text,p_actor::text,p_booking::text,p_property::text,p_batch::text,p_release::text);
 if jsonb_typeof(p_versions) is distinct from 'array' then raise exception 'finals_selection_invalid' using errcode='22023';end if;
 perform public.photo_finals_identifiers(variadic array(select value from jsonb_array_elements_text(p_versions)));
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
  values(p_org,p_property,p_batch,(item->>'media_version_id')::uuid,'web.listing.2048.v1',2,'web','defined') on conflict(organization_id,source_version_id,profile_id,profile_version) do nothing;
  select id into d from public.media_derivatives where organization_id=p_org and source_version_id=(item->>'media_version_id')::uuid and profile_id='web.listing.2048.v1' and profile_version=2;
  insert into public.media_derivatives(organization_id,property_id,batch_id,source_version_id,profile_id,profile_version,derivative_class,profile_status)
  values(p_org,p_property,p_batch,(item->>'media_version_id')::uuid,'ontario.proptx.provisional.2026-08-11.v1',2,'mls','provisional') on conflict(organization_id,source_version_id,profile_id,profile_version) do nothing;
  select id into download_id from public.media_derivatives where organization_id=p_org and source_version_id=(item->>'media_version_id')::uuid and profile_id='ontario.proptx.provisional.2026-08-11.v1' and profile_version=2;
  insert into public.gallery_release_items(organization_id,property_id,batch_id,release_id,media_version_id,display_derivative_id,download_derivative_id,position,display_filename)
  values(p_org,p_property,p_batch,r.id,(item->>'media_version_id')::uuid,d,download_id,(item->>'position')::integer,item->>'display_filename');
 end loop;
 update public.gallery_releases set state='review_pending' where organization_id=p_org and id=r.id returning * into r;return r;
end $$;

create or replace function public.photo_finals_approve_release(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_release uuid,p_revision integer,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r public.gallery_releases; m jsonb; b public.media_batches; ids jsonb; j uuid;
begin
 perform public.photo_finals_identifiers(p_org::text,p_actor::text,p_booking::text,p_property::text,p_release::text);
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
   or not exists(select 1 from public.media_derivatives d where d.organization_id=p_org and d.id=i.display_derivative_id and d.source_version_id=i.media_version_id and d.profile_id='web.listing.2048.v1' and d.profile_version=2)
   or not exists(select 1 from public.media_derivatives d where d.organization_id=p_org and d.id=i.download_derivative_id and d.source_version_id=i.media_version_id and d.profile_id='ontario.proptx.provisional.2026-08-11.v1' and d.profile_version=2))) then raise exception 'finals_stale_selection' using errcode='40001';end if;
 update public.gallery_release_items set approval_state='approved',approved_by=p_actor,approved_at=clock_timestamp() where organization_id=p_org and release_id=r.id;
 update public.gallery_releases set state='approved',approved_by=p_actor,approved_at=clock_timestamp() where organization_id=p_org and id=r.id;
 insert into public.media_packages(organization_id,property_id,batch_id,release_id,package_type,manifest_sha256)
 select p_org,r.property_id,r.batch_id,r.id,x,r.manifest_sha256 from unnest(array['full_res_zip','mls_zip']) x;
 insert into public.media_ingest_jobs(organization_id,property_id,batch_id,job_kind,idempotency_key,finals_release_id,finals_actor_id)
 values(p_org,r.property_id,r.batch_id,'package','finals_package:'||r.id,r.id,p_actor) returning id into j;
 update public.gallery_releases set state='packaging' where organization_id=p_org and id=r.id;
 return jsonb_build_object('id',r.id,'state','packaging','job_id',j);
end $$;

create or replace function public.photo_finals_checkpoint_guard() returns trigger language plpgsql set search_path='' set lock_timeout='5s' as $$
declare j public.media_ingest_jobs; e jsonb; n integer;
begin
 if tg_op='INSERT' then
  if new.finals_package_checkpoints<>'[]'::jsonb then raise exception 'finals_checkpoint_invalid' using errcode='23514';end if;return new;
 end if;
 if new.finals_package_checkpoints is not distinct from old.finals_package_checkpoints then return new;end if;
 j:=public.photo_finals_package_fence(old.organization_id,old.id,old.finals_lease_token);
 n:=jsonb_array_length(old.finals_package_checkpoints);
 if jsonb_array_length(new.finals_package_checkpoints)<>n+1 or
  (select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(new.finals_package_checkpoints) with ordinality t(value,ord) where ord<=n) is distinct from old.finals_package_checkpoints
  then raise exception 'finals_checkpoint_immutable' using errcode='23514';end if;
 e:=new.finals_package_checkpoints->n;
 if not coalesce(jsonb_typeof(e)='object' and octet_length(e::text)<=2048
  and e - array['kind','version_id','sha256','bytes','bucket','key','width','height']='{}'::jsonb
  and e ?& array['kind','version_id','sha256','bytes','bucket','key','width','height']
  and jsonb_typeof(e->'kind')='string' and e->>'kind' in ('gallery','mls')
  and jsonb_typeof(e->'version_id')='string' and e->>'version_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and jsonb_typeof(e->'sha256')='string' and e->>'sha256' ~ '^[0-9a-f]{64}$'
  and jsonb_typeof(e->'bytes')='number' and (e->>'bytes')::numeric=trunc((e->>'bytes')::numeric) and (e->>'bytes')::bigint between 1 and 33554432
  and jsonb_typeof(e->'width')='number' and (e->>'width')::numeric=trunc((e->>'width')::numeric) and (e->>'width')::integer between 1 and 2048
  and jsonb_typeof(e->'height')='number' and (e->>'height')::numeric=trunc((e->>'height')::numeric) and (e->>'height')::integer between 1 and 2048
  and jsonb_typeof(e->'bucket')='string' and e->>'bucket' ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
  and jsonb_typeof(e->'key')='string' and e->>'key'='derivatives/'||old.organization_id||'/'||(e->>'version_id')||'/'||(select gr.manifest #>> array['transforms',e->>'kind','version'] from public.gallery_releases gr where gr.organization_id=old.organization_id and gr.id=j.finals_release_id)||'/'||(e->>'sha256')||'.jpg',false)
  then raise exception 'finals_checkpoint_invalid' using errcode='23514';end if;
 if not exists(select 1 from public.gallery_release_items where organization_id=old.organization_id and release_id=j.finals_release_id and media_version_id=(e->>'version_id')::uuid)
  or exists(select 1 from jsonb_array_elements(old.finals_package_checkpoints) x where x->>'kind'=e->>'kind' and x->>'version_id'=e->>'version_id')
  then raise exception 'finals_checkpoint_invalid' using errcode='23514';end if;
 return new;
end $$;

create or replace function public.photo_finals_package_finish(p_org uuid,p_job uuid,p_lease uuid,p_evidence jsonb) returns void language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
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
   key:='derivatives/'||p_org||'/'||i.media_version_id||'/'||(r.manifest #>> array['transforms',e->>'kind','version'])||'/'||(e->>'sha256')||'.jpg';
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
