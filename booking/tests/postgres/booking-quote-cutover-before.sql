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
