-- Private, login-authorized proxy accounting. No bearer resolution endpoint.
-- A grant is scoped to one authorized HTTP stream, not continuing access rights.
create function public.photo_finals_download_begin(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_operator boolean,p_package uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb; p public.media_packages; g public.download_grants;
begin
 perform public.photo_finals_access(p_org,p_actor,p_booking,p_property,p_operator);
 -- Serialize against new batches and newer review revisions as well as withdrawal.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finals:'||p_org,0));
 -- Same release lock as withdrawal and canonical grant insertion.
 select * into p from public.media_packages where organization_id=p_org and id=p_package and property_id=p_property;
 if p.id is null or p_request is null then raise exception 'finals_download_denied' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finals-release:'||p_org||':'||p.batch_id,0));
 perform 1 from public.gallery_releases where organization_id=p_org and id=p.release_id for update;
 s:=public.photo_finals_current(p_org,p_actor,p_booking,p_property,p_operator);
 if s->>'complete' is distinct from 'true' or not exists(select 1 from jsonb_array_elements(s->'packages') x where x->>'id'=p_package::text) then
 raise exception 'finals_download_denied' using errcode='42501';end if;
 -- Duplicate begin must never authorize a second stream, even after response loss.
 if exists(select 1 from public.download_events where organization_id=p_org and request_id=p_request) then
 raise exception 'finals_download_already_started' using errcode='42501';end if;
 insert into public.download_grants(organization_id,property_id,batch_id,release_id,package_id,grantee_profile_id,token_key_id,token_hash,expires_at,max_resolutions,resolution_count,created_by)
 values(p_org,p.property_id,p.batch_id,p.release_id,p.id,p_actor,'private-session-v1',pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text,'UTF8')),clock_timestamp()+interval '60 seconds',1,1,p_actor) returning * into g;
 insert into public.download_events(organization_id,property_id,batch_id,release_id,package_id,grant_id,event_type,actor_profile_id,request_id)
 values(p_org,p.property_id,p.batch_id,p.release_id,p.id,g.id,'grant_resolved',p_actor,p_request);
 return jsonb_build_object('grantId',g.id,'package',to_jsonb(p));
end $$;

-- Settlement records what the server actually observed, not client receipt.
-- Revocation/expiry/access changes deny successful settlement after bytes drain.
-- Failed settlement remains an unresolved grant_resolved event, never false success.
create function public.photo_finals_download_finish(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_operator boolean,p_grant uuid,p_request uuid,p_completed boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare g public.download_grants; s jsonb; completed boolean:=false;
begin
 select * into g from public.download_grants where organization_id=p_org and id=p_grant and property_id=p_property and grantee_profile_id=p_actor for update;
 if g.id is null or p_completed is null or not exists(select 1 from public.download_events where organization_id=p_org and grant_id=g.id and request_id=p_request and event_type='grant_resolved' and actor_profile_id=p_actor)
 then raise exception 'finals_download_denied' using errcode='42501';end if;
 if exists(select 1 from public.download_events where organization_id=p_org and grant_id=g.id and request_id=p_request and event_type in ('controlled_proxy_completed','denied')) then return exists(select 1 from public.download_events where organization_id=p_org and grant_id=g.id and request_id=p_request and event_type='controlled_proxy_completed');end if;
 if p_completed and g.revoked_at is null and g.expires_at>clock_timestamp() then
  begin
   s:=public.photo_finals_current(p_org,p_actor,p_booking,p_property,p_operator);
   completed:=s->>'complete'='true' and s->'release'->>'id'=g.release_id::text;
  exception when insufficient_privilege then completed:=false;end;
 end if;
 insert into public.download_events(organization_id,property_id,batch_id,release_id,package_id,grant_id,event_type,actor_profile_id,request_id)
 values(p_org,g.property_id,g.batch_id,g.release_id,g.package_id,g.id,case when completed then 'controlled_proxy_completed' else 'denied' end,p_actor,p_request);
 update public.download_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where organization_id=p_org and id=g.id;
 return completed;
end $$;

create function public.photo_finals_download_revoke(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_grant uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.photo_finals_access(p_org,p_actor,p_booking,p_property,true);
 update public.download_grants g set revoked_at=coalesce(g.revoked_at,clock_timestamp())
 where g.organization_id=p_org and g.property_id=p_property and g.id=p_grant
 and exists(select 1 from public.media_batches b where b.organization_id=p_org and b.id=g.batch_id and b.booking_id=p_booking);
 if not found then raise exception 'finals_download_denied' using errcode='42501';end if;
end $$;
revoke all on function public.photo_finals_download_begin(uuid,uuid,uuid,uuid,boolean,uuid,uuid),public.photo_finals_download_finish(uuid,uuid,uuid,uuid,boolean,uuid,uuid,boolean),public.photo_finals_download_revoke(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.photo_finals_download_begin(uuid,uuid,uuid,uuid,boolean,uuid,uuid),public.photo_finals_download_finish(uuid,uuid,uuid,uuid,boolean,uuid,uuid,boolean),public.photo_finals_download_revoke(uuid,uuid,uuid,uuid,uuid) to service_role;
