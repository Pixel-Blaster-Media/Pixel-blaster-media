\set ON_ERROR_STOP on
-- Disposable final-schema fixtures only; no provider calls or real addresses.
begin;
insert into public.organizations(id,name,slug) values
 ('55555555-5555-4555-8555-555555555555','Notice A','notice-a'),
 ('66666666-6666-4666-8666-666666666666','Notice B','notice-b');
insert into auth.users(id,email) values
 ('55000000-0000-4000-8000-000000000001','customer@notice.invalid'),
 ('55000000-0000-4000-8000-000000000002','admin@notice.invalid'),
 ('66000000-0000-4000-8000-000000000001','other@notice.invalid');
update auth.users set raw_app_meta_data=jsonb_build_object('realtor_organization_id',
 case when email='other@notice.invalid' then '66666666-6666-4666-8666-666666666666' else '55555555-5555-4555-8555-555555555555' end)
 where email like '%@notice.invalid';
update public.profiles set role='admin' where id='55000000-0000-4000-8000-000000000002';
update public.organization_members set role='admin' where profile_id='55000000-0000-4000-8000-000000000002';
insert into public.catalog_items(id,organization_id,slug,name,kind,duration_minutes,price_cents) values
 ('55000000-0000-4000-8000-000000000011','55555555-5555-4555-8555-555555555555','photo','Photo','a_la_carte',60,10000),
 ('66000000-0000-4000-8000-000000000011','66666666-6666-4666-8666-666666666666','photo','Photo','a_la_carte',60,10000);

do $$ declare f text; begin
 if exists(select 1 from public.organizations where require_24_hour_notice) then
   raise exception 'Migration enabled a live preference';
 end if;
 foreach f in array array['customer_booking_notice_satisfied(timestamp with time zone,timestamp with time zone)',
  'assert_customer_booking_notice(uuid,timestamp with time zone)','guard_customer_booking_notice()'] loop
  if has_function_privilege('anon','public.'||f,'EXECUTE')
   or has_function_privilege('authenticated','public.'||f,'EXECUTE')
   or not has_function_privilege('service_role','public.'||f,'EXECUTE') then
   raise exception 'Notice function grants widened: %',f;
  end if;
 end loop;
end $$;
set local role service_role;
do $$
declare
 org_id uuid := '55555555-5555-4555-8555-555555555555';
 owner_id uuid := '55000000-0000-4000-8000-000000000001';
 actor_id uuid := '55000000-0000-4000-8000-000000000002';
 item_id uuid := '55000000-0000-4000-8000-000000000011';
 request_id uuid := gen_random_uuid();
 old_slot timestamptz := clock_timestamp() + interval '2 hours';
 retained_id uuid; result jsonb; old_version bigint; start_case timestamptz; zone text;
 delayed_cutoff timestamptz;
 before_bookings integer; before_properties integer; before_jobs integer; before_notices integer;
 notice_payload jsonb := '[{"recipient":"realtor","payload":{"to":"customer@notice.invalid","subject":"Fixture","html":"<p>Fixture</p>"}},{"recipient":"admin","payload":{"to":"admin@notice.invalid","subject":"Fixture","html":"<p>Fixture</p>"}}]';
begin
 -- Exact inclusive boundary in multiple session zones, both DST transitions,
 -- and explicit offset representations. SQL must use 24 hours, never 1 day.
 foreach zone in array array['UTC','America/Toronto','Pacific/Auckland'] loop
  perform set_config('TimeZone',zone,true);
  foreach start_case in array array['2026-03-07T10:00:00-05:00'::timestamptz,
   '2026-10-31T10:00:00-04:00'::timestamptz,'2026-12-31T23:30:00Z'::timestamptz] loop
   if public.customer_booking_notice_satisfied(start_case+interval '24 hours'-interval '1 microsecond',start_case)
    or not public.customer_booking_notice_satisfied(start_case+interval '24 hours',start_case)
    or not public.customer_booking_notice_satisfied(start_case+interval '24 hours'+interval '1 microsecond',start_case)
    or public.customer_booking_notice_satisfied(null,start_case)
    or public.customer_booking_notice_satisfied('infinity',start_case) then
    raise exception 'Exact elapsed-time boundary changed';
   end if;
  end loop;
 end loop;
 perform set_config('TimeZone','UTC',true);
 -- Disabled behavior and an existing committed request are preserved.
 result := public.create_public_booking_with_jobs_v2('2026-09-30-v1',request_id,org_id,owner_id,
  '1 Synthetic Notice Street','Test City','','',old_slot,1200,'vacant',false,'',array[item_id],'{}');
 retained_id := (result->>'booking_id')::uuid;
 update public.organizations set require_24_hour_notice=true where id=org_id;
 -- The admission clock advances even within a long-running transaction.
 delayed_cutoff := clock_timestamp()+interval '24 hours 10 milliseconds';
 perform pg_sleep(0.03);
 begin
  perform public.assert_customer_booking_notice(org_id,delayed_cutoff);
  raise exception 'Transaction-start clock admitted a stale cutoff';
 exception when sqlstate 'PB006' then null; end;
 before_bookings := (select count(*) from public.bookings);
 before_properties := (select count(*) from public.properties);
 before_jobs := (select count(*) from public.integration_jobs);
 result := public.create_public_booking_with_jobs_v2('2026-09-30-v1',request_id,org_id,owner_id,
  '1 Synthetic Notice Street','Test City','','',old_slot,1200,'vacant',false,'',array[item_id],'{}');
 if not (result->>'replayed')::boolean or (result->>'booking_id')::uuid <> retained_id then
  raise exception 'Existing request replay was blocked or recreated';
 end if;
 -- Fresh API creation rejects before commit, atomically undoing property/jobs.
 foreach start_case in array array[clock_timestamp()+interval '5 hours',clock_timestamp()+interval '23 hours 59 minutes'] loop
  begin
   perform public.create_public_booking_with_jobs_v2('2026-09-30-v1',gen_random_uuid(),org_id,owner_id,
    'Must Roll Back','Test City','','',start_case,1200,'vacant',false,'',array[item_id],'{}');
   raise exception 'Too-soon public booking succeeded';
  exception when sqlstate 'PB006' then null; end;
 end loop;
 if (select count(*) from public.bookings)<>before_bookings
  or (select count(*) from public.properties)<>before_properties
  or (select count(*) from public.integration_jobs)<>before_jobs then
  raise exception 'Rejected booking or replay changed aggregate/effects';
 end if;
 -- A different company's disabled preference remains independent.
 perform public.create_public_booking_with_jobs_v2('2026-09-30-v1',gen_random_uuid(),
  '66666666-6666-4666-8666-666666666666','66000000-0000-4000-8000-000000000001',
  'Other Synthetic Company','Test City','','',old_slot,1200,'vacant',false,'',array['66000000-0000-4000-8000-000000000011'::uuid],'{}');
 -- Normal public creation beyond the minimum still commits.
 perform public.create_public_booking_with_jobs_v2('2026-09-30-v1',gen_random_uuid(),org_id,owner_id,
  'Tomorrow Synthetic Street','Test City','','',clock_timestamp()+interval '25 hours',1200,'vacant',false,'',array[item_id],'{}');
 -- A customer cannot create far ahead, then move into the blocked window.
 select lifecycle_version into old_version from public.bookings where id=retained_id;
 before_notices := (select count(*) from public.booking_lifecycle_notices);
 begin
  perform public.change_booking_with_lifecycle_notices(org_id,retained_id,old_version,'rescheduled','realtor',notice_payload,
   old_slot+interval '4 hours',old_slot+interval '5 hours');
  raise exception 'Too-soon customer reschedule succeeded';
 exception when sqlstate 'PB006' then null; end;
 if (select scheduled_at from public.bookings where id=retained_id)<>old_slot
  or (select count(*) from public.booking_lifecycle_notices)<>before_notices then
  raise exception 'Rejected reschedule modified booking/notices';
 end if;
 -- Existing authenticated admin aggregate can still create and move near-term
 -- appointments, including an appointment originally created by a customer.
 result := public.save_admin_booking_aggregate(org_id,actor_id,gen_random_uuid(),null,null,
  jsonb_build_object('quote_policy_version','2026-09-30-v1','owner_id',owner_id,'street_address','Admin Synthetic Street',
   'scheduled_at',clock_timestamp()+interval '8 hours','square_footage',1200,'catalog_item_ids',jsonb_build_array(item_id)));
 if result->>'booking_id' is null then raise exception 'Admin create blocked'; end if;
 perform public.save_admin_booking_aggregate(org_id,actor_id,gen_random_uuid(),retained_id,old_version,
  jsonb_build_object('owner_id',owner_id,'street_address','1 Synthetic Notice Street','scheduled_at',old_slot+interval '5 hours',
   'square_footage',1200,'catalog_item_ids',jsonb_build_array(item_id)));
 select lifecycle_version into old_version from public.bookings where id=retained_id;
 -- Cancelling an existing imminent appointment remains allowed.
 perform public.change_booking_with_lifecycle_notices(org_id,retained_id,old_version,'cancelled','realtor',notice_payload);
 set constraints all immediate;
end $$;
reset role;
-- Direct authenticated inserts cannot evade the rule by omitting the public
-- request ID or posting an override flag; normal tenant RLS remains intact.
set local role authenticated;
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000001',true);
do $$ declare property_id uuid; n integer; begin
 update public.organizations set require_24_hour_notice=false where id='55555555-5555-4555-8555-555555555555';
 get diagnostics n = row_count;
 if n<>0 then raise exception 'Customer changed notice setting'; end if;
 select id into property_id from public.properties where owner_id=auth.uid() limit 1;
 begin
  insert into public.bookings(organization_id,owner_id,property_id,scheduled_at,scheduled_ends_at,status,services,add_ons)
   values('55555555-5555-4555-8555-555555555555',auth.uid(),property_id,clock_timestamp()+interval '12 hours',clock_timestamp()+interval '13 hours','confirmed','{}','{}');
  raise exception 'Direct customer insert bypassed notice';
 exception when sqlstate 'PB006' then null; end;
end $$;
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000002',true);
do $$ declare n integer; begin
 update public.organizations set require_24_hour_notice=true where id='66666666-6666-4666-8666-666666666666';
 get diagnostics n = row_count;
 if n<>0 then raise exception 'Admin changed another company notice setting'; end if;
 update public.organizations set require_24_hour_notice=false where id='55555555-5555-4555-8555-555555555555';
 get diagnostics n = row_count;
 if n<>1 then raise exception 'Admin could not save own notice setting'; end if;
end $$;
reset role;
rollback;
\echo CUSTOMER_BOOKING_NOTICE_PASSED
