insert into public.organizations(id,name,invoice_timing) values ('11111111-1111-4111-8111-111111111111','Recovery','at_booking');
insert into public.profiles(id,organization_id,role,email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','realtor','realtor@example.com');
insert into public.organization_members values ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','member');
insert into public.catalog_items(id,organization_id,slug,name,kind,duration_minutes,price_cents) values ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','photos','Photos','a_la_carte',90,20000);
select public.create_public_booking_with_jobs('90000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','1 Fixture Street','Toronto','M2M 2M2','',now()+interval '1 day',1800,'vacant',true,'',array['10000000-0000-4000-8000-000000000001']::uuid[],array[]::uuid[]);
create function public.recovery_assert(p_ok boolean,p_message text) returns void language plpgsql as $$ begin if p_ok is distinct from true then raise exception '%',p_message; end if; end; $$;
grant execute on function public.recovery_assert(boolean,text) to service_role;
