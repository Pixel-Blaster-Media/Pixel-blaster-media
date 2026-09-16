-- Code-dark application reads. Service-only, current authorization on every call.
-- No public listing placements or browser grants; downloads require a fresh session.
create function public.photo_finals_access(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_operator boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_operator is null or not exists(select 1 from public.profiles where organization_id=p_org and id=p_actor and archived_at is null)
 or not exists(select 1 from public.bookings b join public.properties p on p.organization_id=b.organization_id and p.id=b.property_id
  where b.organization_id=p_org and b.id=p_booking and b.property_id=p_property and b.status<>'cancelled'
  and (p_operator or (b.owner_id=p_actor and p.owner_id=p_actor))) then
  raise exception 'finals_access_denied' using errcode='42501';end if;
 if p_operator then perform public.photo_finals_actor(p_org,p_actor);end if;
end $$;

create function public.photo_finals_upload_target(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_job uuid)
returns public.media_ingest_jobs language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs;
begin
 perform public.photo_finals_access(p_org,p_actor,p_booking,p_property,true);
 select jobs.* into j from public.media_ingest_jobs jobs join public.media_batches b on b.organization_id=jobs.organization_id and b.id=jobs.batch_id
 where jobs.organization_id=p_org and jobs.property_id=p_property and b.booking_id=p_booking and jobs.id=p_job
 and jobs.finals_actor_id=p_actor and jobs.finals_version_id is not null and jobs.completed_at is null and jobs.finals_deadline>clock_timestamp();
 if not found then raise exception 'finals_upload_denied' using errcode='42501';end if;
 return j;
end $$;

-- PRIVATE service envelope: never serialize directly to the browser. Latest release
-- wins, including withdrawal/pending: no resurrection of an older release.
create function public.photo_finals_current(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_operator boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.media_batches; r public.gallery_releases; complete boolean:=false; versions jsonb:='[]'; items jsonb:='[]'; packages jsonb:='[]';
begin
 perform public.photo_finals_access(p_org,p_actor,p_booking,p_property,p_operator);
 select * into b from public.media_batches where organization_id=p_org and property_id=p_property and booking_id=p_booking and source_provider='manual_finals' order by created_at desc,id desc limit 1;
 if b.id is null then return jsonb_build_object('batch',null,'release',null,'complete',false,'versions',versions,'items',items,'packages',packages);end if;
 select * into r from public.gallery_releases where organization_id=p_org and batch_id=b.id and property_id=p_property order by revision_number desc limit 1;
 if p_operator then
 select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at,v.id),'[]') into versions from (select * from public.media_versions where organization_id=p_org and batch_id=b.id and property_id=p_property order by created_at,id limit 100) v;
 end if;
 complete:=coalesce(r.state in ('ready','published') and r.withdrawn_at is null and r.approved_at is not null and r.manifest->>'kind'='finished_jpeg_release.v2'
 and (select count(*) from public.media_packages where organization_id=p_org and release_id=r.id and status='ready' and manifest_sha256=r.manifest_sha256)=2
 and exists(select 1 from public.media_ingest_jobs where organization_id=p_org and finals_release_id=r.id and state='review_pending' and completed_at is not null)
 and (select count(*) from public.gallery_release_items where organization_id=p_org and release_id=r.id) between 1 and 100
 and (select count(*) from public.gallery_release_items where organization_id=p_org and release_id=r.id)=jsonb_array_length(r.manifest->'items')
 and not exists(select 1 from public.gallery_release_items i
 left join public.media_versions v on v.organization_id=i.organization_id and v.id=i.media_version_id
 left join public.media_derivatives d on d.organization_id=i.organization_id and d.id=i.display_derivative_id
 left join public.media_derivatives dl on dl.organization_id=i.organization_id and dl.id=i.download_derivative_id
 where i.organization_id=p_org and i.release_id=r.id and (i.approval_state<>'approved' or v.ingest_state is distinct from 'accepted' or d.status is distinct from 'ready' or dl.status is distinct from 'ready'
 or v.rights_effective_at>clock_timestamp() or v.rights_expires_at<=clock_timestamp())),false);
 if complete then
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'position',i.position,'derivative',to_jsonb(d)) order by i.position),'[]') into items
 from public.gallery_release_items i join public.media_derivatives d on d.organization_id=i.organization_id and d.id=i.display_derivative_id where i.organization_id=p_org and i.release_id=r.id;
 select jsonb_agg(to_jsonb(p) order by p.package_type) into packages from public.media_packages p where p.organization_id=p_org and p.release_id=r.id and p.status='ready';
 end if;
 return jsonb_build_object('batch',case when p_operator then to_jsonb(b) else null end,'release',case when r.id is not null and (p_operator or complete) then to_jsonb(r) else null end,'complete',complete,'versions',versions,'items',items,'packages',packages);
end $$;
revoke all on function public.photo_finals_access(uuid,uuid,uuid,uuid,boolean),public.photo_finals_upload_target(uuid,uuid,uuid,uuid,uuid),public.photo_finals_current(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.photo_finals_access(uuid,uuid,uuid,uuid,boolean),public.photo_finals_upload_target(uuid,uuid,uuid,uuid,uuid),public.photo_finals_current(uuid,uuid,uuid,uuid,boolean) to service_role;
