\set ON_ERROR_STOP on
-- Disposable final-schema fixture only. No real provider/network calls.
begin;
insert into public.organizations(id,name,slug) values
 ('33333333-3333-4333-8333-333333333333','Quote policy','quote-policy');
insert into auth.users(id,email) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','realtor@quote.invalid'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','admin@quote.invalid');
update auth.users set raw_app_meta_data='{"realtor_organization_id":"33333333-3333-4333-8333-333333333333"}'::jsonb
 where email like '%@quote.invalid';
update public.profiles set role='admin' where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
update public.organization_members set role='admin' where profile_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
insert into public.catalog_items(id,organization_id,slug,name,kind,duration_minutes,price_cents,is_video,
 sqft_pricing_enabled,included_sqft,overage_increment_sqft,overage_price_cents,video_overage_threshold_sqft,video_overage_price_cents) values
 ('30000000-0000-4000-8000-000000000011','33333333-3333-4333-8333-333333333333','social_media_special','Special','bundle',120,60000,true,true,2500,500,4000,2500,5000),
 ('30000000-0000-4000-8000-000000000012','33333333-3333-4333-8333-333333333333','video_tour','Video','a_la_carte',60,32500,true,false,null,null,null,2500,5000),
 ('30000000-0000-4000-8000-000000000013','33333333-3333-4333-8333-333333333333','ultimate','Ultimate','bundle',240,95000,true,true,2500,500,4000,2500,5000),
 ('30000000-0000-4000-8000-000000000014','33333333-3333-4333-8333-333333333333','photo','Photo','a_la_carte',30,10000,false,false,null,null,null,null,0),
 ('30000000-0000-4000-8000-000000000015','33333333-3333-4333-8333-333333333333','aerial','Aerial','addon',20,10000,false,false,null,null,null,null,0);

do $$ begin
 if (select count(*) from public.catalog_items where organization_id='00000000-0000-0000-0000-000000000001'
  and video_overage_threshold_sqft=2500 and video_overage_price_cents=5000) <> 4 then
  raise exception 'Advertised fee seed changed';
 end if;
 if has_function_privilege('anon','public.catalog_booking_price_cents(public.catalog_items,integer)','EXECUTE')
  or has_function_privilege('authenticated','public.catalog_booking_price_cents(public.catalog_items,integer)','EXECUTE') then
  raise exception 'Browser can execute pricing RPC';
 end if;
end $$;
set local role service_role;
do $$
declare
 org_id uuid := '33333333-3333-4333-8333-333333333333';
 owner_id uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 actor_id uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 special_id uuid := '30000000-0000-4000-8000-000000000011';
 video_id uuid := '30000000-0000-4000-8000-000000000012';
 ultimate_id uuid := '30000000-0000-4000-8000-000000000013';
 photo_id uuid := '30000000-0000-4000-8000-000000000014';
 aerial_id uuid := '30000000-0000-4000-8000-000000000015';
 base_slot timestamptz := date_trunc('second',now()) + interval '180 days';
 row_case record; result jsonb; replay jsonb; request_id uuid;
 quote_booking_id uuid; retained_id uuid; historical_id uuid; retained_request uuid;
 saved_end timestamptz; saved_price integer; saved_count integer; old_version bigint;
begin
 for row_case in select * from (values
  (0,2500,false,array[special_id],'{}'::uuid[],60000,120),
  (1,2501,true,array[special_id],'{}'::uuid[],69000,135),
  (2,2501,true,array[ultimate_id],'{}'::uuid[],104000,255),
  (3,2501,true,array[special_id,video_id],array[aerial_id],116500,215),
  (4,2501,true,array[photo_id],'{}'::uuid[],10000,75),
  (5,3001,false,array[special_id],'{}'::uuid[],73000,120),
  (6,2500,false,array[video_id],'{}'::uuid[],32500,60),
  (7,2501,false,array[video_id],'{}'::uuid[],37500,60)
 ) v(day_offset,sqft,basement,services,addons,price,minutes) loop
  request_id := gen_random_uuid();
  result := public.create_public_booking_with_jobs_v2('2026-09-30-v1',request_id,org_id,owner_id,'10 Quote Street','Toronto','M1M1M1','',
   base_slot+make_interval(days=>row_case.day_offset),row_case.sqft,'vacant',row_case.basement,'',row_case.services,row_case.addons);
  quote_booking_id := (result->>'booking_id')::uuid;
  if (select sum(l.unit_price_cents*l.quantity) from public.booking_line_items l where l.booking_id=quote_booking_id) <> row_case.price
   or (result->>'scheduled_ends_at')::timestamptz <> base_slot+make_interval(days=>row_case.day_offset,mins=>row_case.minutes)
   or (select b.basement_duration_minutes from public.bookings b where b.id=quote_booking_id) <> (case when row_case.basement then 15 else 0 end) then
   raise exception 'Quote boundary failed for case %', row_case.day_offset;
  end if;
  if exists(select 1 from public.integration_jobs j where j.booking_id=quote_booking_id and
   ((j.payload->'booking'->>'scheduled_ends_at')::timestamptz <> (result->>'scheduled_ends_at')::timestamptz
    or (select sum((x->>'unit_price_cents')::integer * (x->>'quantity')::integer) from jsonb_array_elements(j.payload->'line_items') x) <> row_case.price)) then
   raise exception 'Calendar/email/invoice creation payload diverged from quote';
  end if;
  if row_case.day_offset=1 then retained_id := quote_booking_id; retained_request := request_id; end if;
  if row_case.day_offset=4 then historical_id := quote_booking_id; end if;
 end loop;
 -- Simulate original pre-policy snapshots. This is fixture data, never a migration.
 update public.bookings set basement_duration_minutes=0,scheduled_ends_at=scheduled_at+interval '60 minutes' where id=historical_id;
 update public.booking_line_items set unit_price_cents=12345 where booking_id=historical_id;
 if (select unit_price_cents from public.booking_line_items where booking_id=historical_id) <> 10000 then raise exception 'Existing snapshot price was mutable'; end if;
 select scheduled_ends_at into saved_end from public.bookings where id=retained_id;
 select count(*) into saved_count from public.integration_jobs where booking_id=retained_id;
 update public.catalog_items set price_cents=price_cents+10000,duration_minutes=duration_minutes+30 where id in (special_id,photo_id);
 replay := public.create_public_booking_with_jobs(retained_request,org_id,owner_id,'10 Quote Street','Toronto','M1M1M1','',
  base_slot+interval '1 day',2501,'vacant',true,'',array[special_id],'{}'::uuid[]);
 if not (replay->>'replayed')::boolean or (replay->>'scheduled_ends_at')::timestamptz <> saved_end
  or (select count(*) from public.integration_jobs where booking_id=retained_id) <> saved_count
  or (select unit_price_cents from public.booking_line_items where booking_id=retained_id) <> 69000 then
  raise exception 'Replay repriced, resized or reenqueued a historical request';
 end if;
 -- Admin edit/move with retained items must keep both new and historical terms.
 for row_case in select * from (values (retained_id,special_id,69000,135),(historical_id,photo_id,10000,60)) v(id,catalog_id,price,minutes) loop
  select lifecycle_version into old_version from public.bookings where id=row_case.id;
  result := public.save_admin_booking_aggregate(org_id,actor_id,gen_random_uuid(),row_case.id,old_version,
   jsonb_build_object('owner_id',owner_id,'street_address','10 Quote Street','city','Toronto','postal_code','M1M1M1',
    'scheduled_at',base_slot+interval '30 days'+make_interval(mins=>row_case.minutes),'square_footage',4000,'catalog_item_ids',jsonb_build_array(row_case.catalog_id)));
  if (select extract(epoch from scheduled_ends_at-scheduled_at)/60 from public.bookings where id=row_case.id) <> row_case.minutes
   or (select unit_price_cents from public.booking_line_items where booking_id=row_case.id) <> row_case.price then
   raise exception 'Admin edit changed retained historical terms: id %, actual duration %, expected %, actual price %, expected %',row_case.id,(select extract(epoch from scheduled_ends_at-scheduled_at)/60 from public.bookings where id=row_case.id),row_case.minutes,(select unit_price_cents from public.booking_line_items where booking_id=row_case.id),row_case.price;
  end if;
 end loop;
 -- A new admin booking snapshots the same fee and once-only basement duration.
 result := public.save_admin_booking_aggregate(org_id,actor_id,gen_random_uuid(),null,null,
  jsonb_build_object('quote_policy_version','2026-09-30-v1','owner_id',owner_id,'street_address','20 Quote Street','city','Toronto','postal_code','M1M1M1',
   'scheduled_at',base_slot+interval '40 days','square_footage',2501,'include_basement',true,'catalog_item_ids',jsonb_build_array(ultimate_id,video_id)));
 quote_booking_id := (result->>'booking_id')::uuid;
 if (select sum(unit_price_cents*quantity) from public.booking_line_items l where l.booking_id=quote_booking_id) <> 141500
  or (select extract(epoch from scheduled_ends_at-scheduled_at)/60 from public.bookings where id=quote_booking_id) <> 315 then
  raise exception 'Admin new quote differs from public policy';
 end if;
 set constraints all immediate;
end $$;
reset role;
rollback;
\echo BOOKING_QUOTE_POLICY_PASSED
