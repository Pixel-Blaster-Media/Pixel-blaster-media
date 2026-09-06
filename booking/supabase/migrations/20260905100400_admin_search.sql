-- Bounded keyset windows; predicates and full-history aggregates precede the limit.
-- SECURITY DEFINER is restricted to current, non-archived organization admins.
create function public.admin_booking_search(p_organization_id uuid, p_query text default '', p_filter text default 'active', p_after jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_organization_id is distinct from public.current_organization_id() or not public.is_organization_admin(p_organization_id)
 or not exists(select 1 from public.profiles caller where caller.id=auth.uid() and caller.organization_id=p_organization_id and caller.archived_at is null) then
 raise exception 'Admin scope required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(r) order by r.priority,r.scheduled_at asc nulls first,r.created_at desc,r.id),'[]'::jsonb) from (
 select b.id,b.status,b.scheduled_at,b.services,b.created_at,
 k.priority, jsonb_build_object('priority',k.priority,'scheduled_at',b.scheduled_at,'created_at',b.created_at,'id',b.id) as _cursor,
 jsonb_build_object('street_address',p.street_address,'city',p.city) as properties,
 jsonb_build_object('full_name',u.full_name,'email',u.email) as profiles
 from public.bookings b
 join public.properties p on p.id=b.property_id and p.organization_id=b.organization_id and p.owner_id=b.owner_id
 join public.profiles u on u.id=b.owner_id and u.organization_id=b.organization_id
 cross join lateral (select case when p_filter='active' and b.status='requested' and b.scheduled_at is null then 0 else 1 end as priority) k
 where b.organization_id=p_organization_id and (p_after is null or
 (k.priority,coalesce(b.scheduled_at,'-infinity'::timestamptz),-extract(epoch from b.created_at),b.id) >
 ((p_after->>'priority')::int,coalesce((p_after->>'scheduled_at')::timestamptz,'-infinity'::timestamptz),-extract(epoch from (p_after->>'created_at')::timestamptz),(p_after->>'id')::uuid))
 and (p_filter='all' or (p_filter='active' and b.status::text in ('requested','confirmed','shot','editing')) or b.status::text=p_filter)
 and strpos(lower(concat_ws(' ',p.street_address,p.city,u.full_name,u.email,b.status::text,array_to_string(b.services,' '), (select string_agg(case s
 when 'real_estate_photos' then 'Real Estate Photography' when 'iguide_tour' then 'iGuide Virtual Tour'
 when 'floor_plan' then 'Floor Plan Only' when 'drone' then 'Drone / Aerial' when 'walkthrough_video' then 'Walkthrough Video'
 when 'twilight' then 'Twilight exterior' when 'virtual_staging' then 'Virtual staging' when 'rush_24h' then 'Rush — 24h delivery'
 -- Checked exhaustively against labelForService by tenant-search-labels.test.mjs.
 when 'blue_print' then 'The Blue Print' when 'social_media_special' then 'Social Media Special'
 when 'social_media_plus' then 'Social Media PLUS' when 'ultimate' then 'The Ultimate'
 when 'residential_photography' then 'Residential Photography' when 'aerial_photography' then 'Aerial Photography'
 when 'iguide_measurements' then 'iGuide + Measurements' when 'social_media_reel' then 'Social Media Reel'
 when 'video_tour' then 'Video Tour' when 'interior_retakes' then 'Interior Retakes'
 when 'exterior_retakes' then 'Exterior Retakes' when 'on_camera' then 'Put me on camera'
 else s end,' ') from unnest(b.services) s))),lower(coalesce(p_query,'')))>0
 order by k.priority,b.scheduled_at asc nulls first,b.created_at desc,b.id limit 51
 ) r);
end $$;
create function public.admin_realtor_search(p_organization_id uuid, p_query text default '', p_after jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_organization_id is distinct from public.current_organization_id() or not public.is_organization_admin(p_organization_id)
 or not exists(select 1 from public.profiles caller where caller.id=auth.uid() and caller.organization_id=p_organization_id and caller.archived_at is null) then
 raise exception 'Admin scope required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(r.payload order by r.full_name asc nulls last,r.email,r.id),'[]'::jsonb) from (
 select p.id,p.full_name,p.email, (jsonb_build_object(
 '_cursor',jsonb_build_object('full_name',p.full_name,'email',p.email,'id',p.id),
 'id',p.id,'email',p.email,'full_name',p.full_name,'phone',p.phone,'alternate_phones',p.alternate_phones,
 'brokerage',p.brokerage,'profile_photo_url',p.profile_photo_url,'brokerage_logo_url',p.brokerage_logo_url,
 'website_url',p.website_url,'instagram_url',p.instagram_url,'delivery_cc_emails',p.delivery_cc_emails,
 'internal_notes',p.internal_notes,'ai_memory',p.ai_memory,'created_at',p.created_at,
 'bookingCount',stats.total,'activeBookingCount',stats.active,'deliveredBookingCount',stats.delivered,
 'latestBooking',latest.payload)) as payload
 from public.profiles p
 cross join lateral (select count(*) total,count(*) filter(where b.status::text in ('requested','confirmed','shot','editing')) active,
 count(*) filter(where b.status::text='delivered') delivered from public.bookings b
 where b.organization_id=p_organization_id and b.owner_id=p.id) stats
 left join lateral (select jsonb_build_object('id',b.id,'status',b.status,'scheduled_at',b.scheduled_at,
 'address',concat_ws(', ',prop.street_address,prop.city)) payload
 from public.bookings b left join public.properties prop on prop.id=b.property_id and prop.organization_id=b.organization_id and prop.owner_id=b.owner_id
 where b.organization_id=p_organization_id and b.owner_id=p.id
 order by coalesce(b.scheduled_at,b.created_at) desc,b.id desc limit 1) latest on true
 where p.organization_id=p_organization_id and p.role='realtor' and p.archived_at is null
 and (p_after is null or
 (p.full_name is null,coalesce(p.full_name,''),p.email,p.id) >
 (p_after->>'full_name' is null,coalesce(p_after->>'full_name',''),p_after->>'email',(p_after->>'id')::uuid))
 and strpos(lower(concat_ws(' ',p.full_name,p.email,p.phone,array_to_string(p.alternate_phones,' '),p.brokerage)),lower(coalesce(p_query,'')))>0
 order by p.full_name asc nulls last,p.email,p.id limit 51
 ) r);
end $$;
revoke all on function public.admin_booking_search(uuid,text,text,jsonb) from public,anon,service_role;
revoke all on function public.admin_realtor_search(uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.admin_booking_search(uuid,text,text,jsonb) to authenticated;
grant execute on function public.admin_realtor_search(uuid,text,jsonb) to authenticated;
create index admin_booking_owner_history_idx on public.bookings(organization_id,owner_id);
