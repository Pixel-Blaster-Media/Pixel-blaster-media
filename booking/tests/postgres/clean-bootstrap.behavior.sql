\set ON_ERROR_STOP on
begin;
-- Final runtime surface must exist after the entire generated setup, not a
-- focused fixture. Check every overload's API boundary, including inherited ACLs.
do $$
declare f record; required_name text;
begin
 foreach required_name in array array['create_public_booking_with_jobs', 'claim_integration_job'] loop
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=required_name) then
   raise exception 'Missing runtime RPC: %', required_name;
  end if;
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=required_name loop
   if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or not has_function_privilege('service_role',f.oid,'EXECUTE') then
    raise exception 'Incorrect runtime RPC grants: %', required_name;
   end if;
  end loop;
 end loop;
 if to_regclass('public.integration_jobs') is null or to_regclass('public.booking_internal_notes') is null then
  raise exception 'Missing required runtime tables';
 end if;
end $$;
set local role authenticated;
do $$ begin
 begin
  perform 1 from public.booking_internal_notes;
  raise exception 'Private notes are readable by authenticated API role';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
-- Exercise the real final Auth trigger, not hand-built profiles.
insert into public.organizations(id,name,slug) values
 ('11111111-1111-4111-8111-111111111111','Bootstrap A','bootstrap-a'),
 ('22222222-2222-4222-8222-222222222222','Bootstrap B','bootstrap-b');
insert into auth.users(id,email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@bootstrap.invalid'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@bootstrap.invalid');
do $$ begin
 if exists(select 1 from public.profiles where email like '%@bootstrap.invalid') then
   raise exception 'Markerless Auth identity gained a tenant profile';
 end if;
end $$;
update auth.users set raw_app_meta_data=jsonb_build_object('realtor_organization_id',
 case when email='a@bootstrap.invalid' then '11111111-1111-4111-8111-111111111111' else '22222222-2222-4222-8222-222222222222' end)
 where email like '%@bootstrap.invalid';
do $$ begin
 if (select count(*) from public.organization_members where profile_id in
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') and role='member') <> 2 then
   raise exception 'Trusted Auth provisioning did not create tenant memberships';
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
insert into public.properties(id,organization_id,owner_id,street_address) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture A');
do $$ begin
 if (select count(*) from public.profiles where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 0 then
   raise exception 'Foreign tenant profile visible';
 end if;
 begin
  insert into public.properties(organization_id,owner_id,street_address) values
   ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Forbidden');
  raise exception 'Cross tenant property write succeeded';
 exception when insufficient_privilege then null;
 end;
end $$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
do $$ begin
 if exists(select 1 from public.properties where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') then
   raise exception 'Foreign property visible';
 end if;
end $$;
reset role;
rollback;
\echo CLEAN_BOOTSTRAP_BEHAVIOR_PASSED
