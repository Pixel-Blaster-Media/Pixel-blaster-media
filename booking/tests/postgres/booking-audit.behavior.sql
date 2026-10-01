\set ON_ERROR_STOP on
-- Run only through the disposable PostgreSQL 17 clean-bootstrap harness.
-- This exercises the final catalog wrapper, Auth triggers, overlap constraint,
-- lifecycle triggers and service-role grants together. It sends no provider I/O.
begin;
insert into public.organizations(id,name,slug) values
 ('11111111-1111-4111-8111-111111111111','Audit A','audit-a'),
 ('22222222-2222-4222-8222-222222222222','Audit B','audit-b');
insert into auth.users(id,email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@audit.invalid'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@audit.invalid'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','c@audit.invalid');
update auth.users set raw_app_meta_data=jsonb_build_object('realtor_organization_id',
 case when email='b@audit.invalid' then '22222222-2222-4222-8222-222222222222'
 else '11111111-1111-4111-8111-111111111111' end) where email like '%@audit.invalid';
insert into public.catalog_items(id,organization_id,slug,name,kind,duration_minutes,price_cents,is_photo) values
 ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','audit_photo','Audit Photo','a_la_carte',90,20000,true),
 ('20000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','audit_photo','Audit Photo','a_la_carte',90,20000,true);

do $$ declare f record; role_name text; begin
 if not (select relrowsecurity from pg_class where oid='public.booking_lifecycle_notices'::regclass) then
  raise exception 'Lifecycle notice RLS is disabled';
 end if;
 foreach role_name in array array['anon','authenticated'] loop
  if has_table_privilege(role_name,'public.booking_lifecycle_notices','SELECT,INSERT,UPDATE,DELETE') then
   raise exception 'Browser role can access private lifecycle payloads: %',role_name;
  end if;
 end loop;
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('change_booking_with_lifecycle_notices','claim_booking_lifecycle_notices','finish_booking_lifecycle_notice') loop
  if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
   or not has_function_privilege('service_role',f.oid,'EXECUTE') then
   raise exception 'Incorrect lifecycle API grant: %',f.proname;
  end if;
 end loop;
end $$;

set local role service_role;
do $$
declare
 org_a uuid := '11111111-1111-4111-8111-111111111111';
 org_b uuid := '22222222-2222-4222-8222-222222222222';
 owner_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 catalog_a uuid := '10000000-0000-4000-8000-000000000001';
 request_id uuid := gen_random_uuid();
 base_slot timestamptz := date_trunc('second',now()) + interval '120 days';
 first_result jsonb; result jsonb; previous_result jsonb;
 target_property_id uuid; target_booking_id uuid; second_booking uuid;
 version_before bigint; job_count integer;
 variant record; job public.booking_lifecycle_notices%rowtype; first_job uuid;
 notices jsonb := '[{"recipient":"realtor","payload":{"to":"realtor@audit.invalid","from":"studio@audit.invalid","replyTo":null,"subject":"Changed","html":"<p>Fixture</p>"}},{"recipient":"admin","payload":{"to":"admin@audit.invalid","from":"studio@audit.invalid","replyTo":null,"subject":"Changed","html":"<p>Fixture</p>"}}]';
begin
 first_result := public.create_public_booking_with_jobs(request_id,org_a,owner_a,
  '10 Shared Street','Toronto','M1M 1M1','1',base_slot,1800,'vacant',false,'Fixture',array[catalog_a],'{}'::uuid[]);
 target_property_id := (first_result->>'property_id')::uuid;
 target_booking_id := (first_result->>'booking_id')::uuid;
 select count(*) into job_count from public.integration_jobs j where j.booking_id=target_booking_id;
 -- The complete final wrapper must preserve exact request replay and snapshots.
 result := public.create_public_booking_with_jobs(request_id,org_a,owner_a,
  '10 Shared Street','Toronto','M1M 1M1','1',base_slot,1800,'vacant',false,'Fixture',array[catalog_a],'{}'::uuid[]);
 if result->>'booking_id' <> target_booking_id::text or not (result->>'replayed')::boolean then
  raise exception 'Exact public request replay changed';
 end if;
 if (select count(*) from public.integration_jobs j where j.booking_id=(first_result->>'booking_id')::uuid) <> job_count then
  raise exception 'Replay duplicated creation jobs';
 end if;
 if (select unit_price_cents from public.booking_line_items l where l.booking_id=(first_result->>'booking_id')::uuid) <> 20000
  or (first_result->>'scheduled_ends_at')::timestamptz <> base_slot + interval '90 minutes' then
  raise exception 'Unchanged price/duration behavior regressed';
 end if;
 for variant in select * from (values
  (1,' toronto ','m1m1m1',true), (2,'Ottawa','M1M 1M1',false),
  (3,'Toronto','M2M 2M2',false), (4,'Toronto',null::text,false)) v(day_offset,city,postal,reuse) loop
  result := public.create_public_booking_with_jobs(gen_random_uuid(),org_a,owner_a,
   ' 10 shared street ',variant.city,variant.postal,'2',base_slot+make_interval(days=>variant.day_offset),1800,'vacant',false,'',array[catalog_a],'{}'::uuid[]);
  if ((result->>'property_id')::uuid=target_property_id) is distinct from variant.reuse then
   raise exception 'Incorrect property identity for city/postal variant %',variant.day_offset;
  end if;
  if variant.day_offset=1 then second_booking := (result->>'booking_id')::uuid; end if;
 end loop;
 result := public.create_public_booking_with_jobs(gen_random_uuid(),org_a,'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '10 Shared Street','Toronto','M1M 1M1','',base_slot+interval '5 days',1800,'vacant',false,'',array[catalog_a],'{}'::uuid[]);
 if (result->>'property_id')::uuid=target_property_id then raise exception 'Different owner reused property'; end if;
 result := public.create_public_booking_with_jobs(gen_random_uuid(),org_b,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '10 Shared Street','Toronto','M1M 1M1','',base_slot,1800,'vacant',false,'',array['20000000-0000-4000-8000-000000000001']::uuid[],'{}'::uuid[]);
 if (result->>'property_id')::uuid=target_property_id then raise exception 'Different tenant reused property'; end if;
 if (select city from public.properties p where p.id=target_property_id) <> 'Toronto'
  or (select b.property_id from public.bookings b where b.id=(first_result->>'booking_id')::uuid) <> target_property_id then
  raise exception 'Historical property or booking changed';
 end if;

 select lifecycle_version into version_before from public.bookings b where b.id=target_booking_id;
 begin
  perform public.change_booking_with_lifecycle_notices(org_a,target_booking_id,version_before,'rescheduled','realtor','[]',base_slot+interval '40 days',base_slot+interval '40 days 90 minutes');
  raise exception 'Missing notice did not reject';
 exception when sqlstate 'PB003' then null; end;
 if (select scheduled_at from public.bookings b where b.id=target_booking_id) <> base_slot
  or (select lifecycle_version from public.bookings b where b.id=target_booking_id) <> version_before
  or exists(select 1 from public.booking_lifecycle_notices n where n.booking_id=target_booking_id) then
  raise exception 'Failed enqueue did not roll back booking and notices';
 end if;
 begin
  perform public.change_booking_with_lifecycle_notices(org_b,target_booking_id,version_before,'cancelled','admin',jsonb_build_array(notices->0));
  raise exception 'Wrong tenant changed booking';
 exception when sqlstate 'PB004' then null; end;
 -- A conflicting slot is rejected by the existing database overlap constraint.
 begin
  perform public.change_booking_with_lifecycle_notices(org_a,target_booking_id,version_before,'rescheduled','realtor',notices,base_slot+interval '1 day',base_slot+interval '1 day 90 minutes');
  raise exception 'Overlapping reschedule succeeded';
 exception when exclusion_violation then null; end;
 result := public.change_booking_with_lifecycle_notices(org_a,target_booking_id,version_before,'rescheduled','realtor',notices,base_slot+interval '40 days',base_slot+interval '40 days 90 minutes');
 set constraints all immediate;
 if (result->>'lifecycle_version')::bigint <> (select lifecycle_version from public.bookings where id=target_booking_id)
  or exists(select 1 from public.booking_lifecycle_notices n where n.booking_id=target_booking_id
    and n.lifecycle_version <> (result->>'lifecycle_version')::bigint) then
  raise exception 'Deferred effect refresh changed the returned or notice lifecycle version';
 end if;
 set constraints all deferred;
 if jsonb_array_length(result->'notice_ids')<>2 then raise exception 'Expected two atomic notices'; end if;
 begin
  perform public.change_booking_with_lifecycle_notices(org_a,target_booking_id,version_before,'rescheduled','realtor',notices,base_slot+interval '40 days',base_slot+interval '40 days 90 minutes');
  raise exception 'Stale mutation replay succeeded';
 exception when sqlstate 'PB004' then null; end;
 if (select count(*) from public.booking_lifecycle_notices n where n.booking_id=target_booking_id)<>2 then raise exception 'Stale retry duplicated notices'; end if;
 if exists(select 1 from public.claim_booking_lifecycle_notices(now()-interval '1 day',org_b,target_booking_id,2)) then raise exception 'Wrong tenant claimed notices'; end if;
 select * into job from public.claim_booking_lifecycle_notices(now()-interval '1 day',org_a,target_booking_id,1);
 if job.id is null or job.attempt_count<>1 or job.lease_token is null then raise exception 'Notice lease missing'; end if;
 first_job := job.id;
 begin
  update public.booking_lifecycle_notices set payload=jsonb_set(payload,'{html}','"tampered"') where id=job.id;
  raise exception 'Notice body was mutable';
 exception when check_violation then null; end;
 if public.finish_booking_lifecycle_notice(org_b,job.id,job.lease_token,'receipt',null)
  or public.finish_booking_lifecycle_notice(org_a,job.id,gen_random_uuid(),'receipt',null) then raise exception 'Wrong tenant/lease accepted receipt'; end if;
 if not public.finish_booking_lifecycle_notice(org_a,job.id,job.lease_token,null,'delivery_unconfirmed') then raise exception 'Retry outcome not saved'; end if;
 update public.booking_lifecycle_notices set next_attempt_at=now()-interval '1 second' where id=first_job;
 select * into job from public.claim_booking_lifecycle_notices(now()-interval '1 day',org_a,target_booking_id,1);
 if job.id<>first_job or job.attempt_count<>2 then raise exception 'Retry changed stable notice identity'; end if;
 if not public.finish_booking_lifecycle_notice(org_a,job.id,job.lease_token,'receipt-1',null) then raise exception 'Receipt not saved'; end if;
 if public.finish_booking_lifecycle_notice(org_a,job.id,job.lease_token,'receipt-2',null) then raise exception 'Completed lease accepted duplicate completion'; end if;
 select * into job from public.claim_booking_lifecycle_notices(now()-interval '1 day',org_a,target_booking_id,1);
 if job.id is null or job.id=first_job then raise exception 'Second notice unavailable'; end if;
 update public.booking_lifecycle_notices set first_attempt_at=now()-interval '24 hours',lease_expires_at=now()-interval '1 second' where id=job.id;
 if exists(select 1 from public.claim_booking_lifecycle_notices(now()-interval '1 day',org_a,target_booking_id,2)) then raise exception 'Expired provider deduplication window retried'; end if;
 if (select status from public.booking_lifecycle_notices where id=job.id)<>'dead_letter' then raise exception 'Expired ambiguity not dead-lettered'; end if;

 -- Move away and back: matching timestamps alone cannot revive an older email.
 result := public.change_booking_with_lifecycle_notices(org_a,target_booking_id,(result->>'lifecycle_version')::bigint,'rescheduled','realtor',notices,base_slot+interval '41 days',base_slot+interval '41 days 90 minutes');
 previous_result := result;
 result := public.change_booking_with_lifecycle_notices(org_a,target_booking_id,(result->>'lifecycle_version')::bigint,'rescheduled','realtor',notices,base_slot+interval '43 days',base_slot+interval '43 days 90 minutes');
 result := public.change_booking_with_lifecycle_notices(org_a,target_booking_id,(result->>'lifecycle_version')::bigint,'rescheduled','realtor',notices,base_slot+interval '41 days',base_slot+interval '41 days 90 minutes');
 update public.booking_lifecycle_notices set next_attempt_at=now()-interval '1 second'
  where id in (select value::uuid from jsonb_array_elements_text(previous_result->'notice_ids'));
 perform 1 from public.claim_booking_lifecycle_notices(now()-interval '1 day',org_a,target_booking_id,2);
 if exists(select 1 from public.booking_lifecycle_notices n where n.id in (select value::uuid from jsonb_array_elements_text(previous_result->'notice_ids')) and n.status<>'superseded') then
  raise exception 'Obsolete reschedule notice revived';
 end if;
 -- Quiet mode suppresses customer notices while preserving admin notices.
 update public.bookings set suppress_realtor_notifications=true where id=second_booking;
 select lifecycle_version into version_before from public.bookings where id=second_booking;
 result := public.change_booking_with_lifecycle_notices(org_a,second_booking,version_before,'rescheduled','realtor',notices,base_slot+interval '42 days',base_slot+interval '42 days 90 minutes');
 if jsonb_array_length(result->'notice_ids')<>1 or exists(select 1 from public.booking_lifecycle_notices n where n.booking_id=second_booking and n.recipient='realtor') then raise exception 'Quiet mode queued customer mail'; end if;
 update public.booking_lifecycle_notices set attempt_count=8 where booking_id=second_booking;
 if exists(select 1 from public.claim_booking_lifecycle_notices(now()-interval '1 day',org_a,second_booking,2)) then raise exception 'Attempt cap did not stop automatic retries'; end if;
 if exists(select 1 from public.booking_lifecycle_notices where booking_id=second_booking and status<>'dead_letter') then raise exception 'Exhausted attempts not visible for recovery'; end if;
 update public.bookings set google_calendar_event_id='retained-until-provider-confirms' where id=second_booking;
 select lifecycle_version into version_before from public.bookings where id=second_booking;
 result := public.change_booking_with_lifecycle_notices(org_a,second_booking,version_before,'cancelled','admin','[]');
 if jsonb_array_length(result->'notice_ids')<>0 or (select google_calendar_event_id from public.bookings where id=second_booking)<>'retained-until-provider-confirms' then raise exception 'Quiet cancellation erased linkage or queued mail'; end if;
 select lifecycle_version into version_before from public.bookings where id=target_booking_id;
 result := public.change_booking_with_lifecycle_notices(org_a,target_booking_id,version_before,'cancelled','realtor',jsonb_set(notices,'{0,payload,to}','null'));
 if not exists(select 1 from public.booking_lifecycle_notices n where n.id in
  (select value::uuid from jsonb_array_elements_text(result->'notice_ids')) and n.recipient='realtor' and n.status='dead_letter' and n.error_code='missing_recipient') then
  raise exception 'Missing email recipient was silently discarded';
 end if;
end $$;
set constraints all immediate;
reset role;
rollback;
\echo BOOKING_AUDIT_BEHAVIOR_PASSED
