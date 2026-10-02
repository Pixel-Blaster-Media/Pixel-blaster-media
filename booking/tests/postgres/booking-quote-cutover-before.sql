-- Disposable staged migration proof. Executed inside a transaction rolled back
-- before the separate required full-candidate bootstrap.
insert into auth.users(id,email,raw_app_meta_data) values
 ('91000000-0000-4000-8000-000000000001','cutover-realtor@example.invalid','{"realtor_organization_id":"00000000-0000-0000-0000-000000000001"}'),
 ('91000000-0000-4000-8000-000000000002','cutover-admin@example.invalid','{"realtor_organization_id":"00000000-0000-0000-0000-000000000001"}');
update public.profiles set role='admin' where id='91000000-0000-4000-8000-000000000002';
update public.organization_members set role='admin' where profile_id='91000000-0000-4000-8000-000000000002';
create function pg_temp.cutover_public(p_legacy boolean,p_version text,p_request uuid,p_offset integer default 0)
returns jsonb language plpgsql as $$
declare
 org uuid := '00000000-0000-0000-0000-000000000001';
 owner uuid := '91000000-0000-4000-8000-000000000001';
 item uuid := (select id from public.catalog_items where organization_id=org and slug='video_tour');
 slot timestamptz := date_trunc('second',now())+interval '180 days'+make_interval(mins=>p_offset);
begin
 if p_legacy then
  return public.create_public_booking_with_jobs(p_request,org,owner,'Cutover Fixture','Hamilton','L8P4S8','',slot,2501,'vacant',true,'',array[item],'{}'::uuid[]);
 end if;
 return public.create_public_booking_with_jobs_v2(p_version,p_request,org,owner,'Cutover Fixture','Hamilton','L8P4S8','',slot,2501,'vacant',true,'',array[item],'{}'::uuid[]);
end $$;
create temp table cutover_receipt as select pg_temp.cutover_public(true,null,'91000000-0000-4000-8000-000000000003') as result;
-- Capture real pre-policy admin create AND edit requests, with no quote key.
create temp table cutover_admin_receipts(request_id uuid, booking_id uuid, version bigint, input jsonb, result jsonb);
do $$ declare input jsonb; created jsonb; edited jsonb; booking uuid; begin
 input:=jsonb_build_object('owner_id','91000000-0000-4000-8000-000000000001',
  'street_address','Historical admin fixture','city','Hamilton','province','ON','postal_code','L8P4S8',
  'scheduled_at',date_trunc('second',now())+interval '181 days','square_footage',2501,
  'catalog_item_ids',jsonb_build_array((select id from public.catalog_items where organization_id='00000000-0000-0000-0000-000000000001' and slug='video_tour')));
 created:=public.save_admin_booking_aggregate('00000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000005',null,null,input);
 booking:=(created->>'booking_id')::uuid;
 insert into cutover_admin_receipts values('91000000-0000-4000-8000-000000000005',null,null,input,created);
 input:=input||jsonb_build_object('client_notes','Historical edited notes');
 edited:=public.save_admin_booking_aggregate('00000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000006',booking,(created->>'lifecycle_version')::bigint,input);
 insert into cutover_admin_receipts values('91000000-0000-4000-8000-000000000006',booking,(created->>'lifecycle_version')::bigint,input,edited);
end $$;
create temp table cutover_admin_fingerprints as select request_id,input,result from public.admin_booking_requests;
create function pg_temp.assert_admin_cutover_replay(p_with_versions boolean) returns void language plpgsql as $$
declare r record; v text; candidate jsonb; response jsonb; begin
 for r in select * from cutover_admin_receipts loop
  foreach v in array (case when p_with_versions then array[null,'','legacy','2026-09-30-v1'] else array[null]::text[] end) loop
   candidate:=r.input || case when v is null then '{}'::jsonb else jsonb_build_object('quote_policy_version',v) end;
   response:=public.save_admin_booking_aggregate('00000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000002',r.request_id,r.booking_id,r.version,candidate);
   if response is distinct from r.result||'{"replayed":true}'::jsonb then raise exception 'Historical admin receipt changed'; end if;
   begin
    perform public.save_admin_booking_aggregate('00000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000002',r.request_id,r.booking_id,r.version,candidate||'{"street_address":"Changed payload"}'::jsonb);
    raise exception 'Changed business payload replay accepted';
   exception when sqlstate 'PB003' then null; end;
   begin
    perform public.save_admin_booking_aggregate('00000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000007',r.request_id,r.booking_id,r.version,candidate);
    raise exception 'Different active admin replay accepted';
   exception when sqlstate 'PB003' then null; end;
   begin
    perform public.save_admin_booking_aggregate('00000000-0000-0000-0000-000000000002','91000000-0000-4000-8000-000000000002',r.request_id,r.booking_id,r.version,candidate);
    raise exception 'Cross-tenant replay accepted';
   exception when sqlstate 'PB001' or sqlstate 'PB005' then null; end;
  end loop;
 end loop;
 if exists(select 1 from cutover_admin_fingerprints f join public.admin_booking_requests stored using(request_id) where f.input is distinct from stored.input or f.result is distinct from stored.result) then raise exception 'Replay rewrote historical fingerprint or receipt'; end if;
end $$;
insert into auth.users(id,email,raw_app_meta_data) values('91000000-0000-4000-8000-000000000007','cutover-other-admin@example.invalid','{"realtor_organization_id":"00000000-0000-0000-0000-000000000001"}');
update public.profiles set role='admin' where id='91000000-0000-4000-8000-000000000007';
update public.organization_members set role='admin' where profile_id='91000000-0000-4000-8000-000000000007';
select pg_temp.assert_admin_cutover_replay(false);
-- Drain the same deferred effects a real pre-cutover COMMIT would finish.
-- The surrounding fixture transaction is retained only for test cleanup.
set constraints all immediate;
set constraints all deferred;
create temp table cutover_before as select
 (select count(*) from public.bookings) bookings,
 (select count(*) from public.properties) properties,
 (select count(*) from public.integration_jobs) jobs;
do $$ begin
 if (select extract(epoch from scheduled_ends_at-scheduled_at)/60 from public.bookings where id=(select (result->>'booking_id')::uuid from cutover_receipt))<>60
 or (select unit_price_cents from public.booking_line_items where booking_id=(select (result->>'booking_id')::uuid from cutover_receipt))<>32500 then
 raise exception 'Old 2501 sqft basement quote fixture is not $325/60 minutes'; end if;
end $$;

-- Preserve the old wrapper body to model an invocation already in flight when
-- CREATE OR REPLACE publishes the guarded entry point.
do $$ begin
 execute replace(pg_get_functiondef('public.create_public_booking_with_jobs(uuid,uuid,uuid,text,text,text,text,timestamptz,integer,text,boolean,text,uuid[],uuid[],text,text)'::regprocedure),
  'FUNCTION public.create_public_booking_with_jobs(', 'FUNCTION pg_temp.inflight_old_public_booking(');
end $$;


create function pg_temp.cutover_state() returns jsonb language sql as $$
 select jsonb_build_object(
  'bookings',(select jsonb_agg(to_jsonb(t)-'basement_duration_minutes' order by id) from public.bookings t),
  'properties',(select jsonb_agg(to_jsonb(t) order by id) from public.properties t),
  'lines',(select jsonb_agg(to_jsonb(t) order by id) from public.booking_line_items t),
  'jobs',(select jsonb_agg(to_jsonb(t) order by id) from public.integration_jobs t),
  'requests',(select jsonb_agg(to_jsonb(t) order by request_id) from public.admin_booking_requests t),
  'notices',(select jsonb_agg(to_jsonb(t) order by id) from public.booking_lifecycle_notices t),
  'profiles',(select jsonb_agg(to_jsonb(t) order by id) from public.profiles t));
$$;
create temp table cutover_state_snapshot as select pg_temp.cutover_state() as state;
create function pg_temp.assert_admin_new_writes_blocked(p_paused boolean) returns void language plpgsql as $$
declare r record; v text; candidate jsonb; expected_version bigint; begin
 for r in select * from cutover_admin_receipts loop
  foreach v in array (case when p_paused then array[null,'','legacy','2026-09-30-v1'] else array[null,'','legacy'] end) loop
   candidate:=r.input || case when v is null then '{}'::jsonb else jsonb_build_object('quote_policy_version',v) end;
   expected_version:=null;
   if r.booking_id is not null then
    select lifecycle_version into expected_version from public.bookings where id=r.booking_id;
    candidate:=candidate||jsonb_build_object('catalog_item_ids',jsonb_build_array((select id from public.catalog_items where organization_id='00000000-0000-0000-0000-000000000001' and slug='residential_photography')));
   end if;
   begin
    perform public.save_admin_booking_aggregate('00000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000002',gen_random_uuid(),r.booking_id,expected_version,candidate);
    raise exception 'New admin quote passed paused/stale gate';
   exception when sqlstate 'PB005' then null; end;
  end loop;
 end loop;
end $$;
