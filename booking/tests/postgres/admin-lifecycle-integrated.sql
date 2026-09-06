begin;
do $$ declare r jsonb; b uuid; v bigint; before_row jsonb; before_lines jsonb; begin
r:=public.test_admin_save('00000000-0000-4000-8000-000000000101'); b:=(r->>'booking_id')::uuid;
set constraints all immediate;
assert (r->>'lifecycle_version')::bigint=(select lifecycle_version from public.bookings where id=b), 'returned create version current';
set constraints all deferred;
r:=public.test_admin_save('00000000-0000-4000-8000-000000000102',b,(r->>'lifecycle_version')::bigint,'{"contact_name":"Current Contact","client_notes":"Current notes"}');
set constraints all immediate;
assert (r->>'lifecycle_version')::bigint=(select lifecycle_version from public.bookings where id=b), 'returned edit version current';
assert exists(select 1 from public.integration_jobs where booking_id=b and status='pending' and job_type='email.booking.confirmation' and payload->'realtor'->>'full_name'='Current Contact' and payload->'booking'->>'client_notes'='Current notes' and (payload->'line_items'->0->>'unit_price_cents')::int=39000), 'current final aggregate effect';
assert exists(select 1 from public.integration_jobs where booking_id=b and status='cancelled' and last_error_code='booking_effect_superseded'), 'old generation superseded';
end $$;
rollback;
\echo 'PASS actual aggregate recovery generation and returned CAS version'
begin;
create function public.fail_refresh() returns trigger language plpgsql as $$ begin if new.effect_version<>old.effect_version then raise exception 'forced refresh failure' using errcode='ZX002'; end if; return new; end $$;
create trigger fail_refresh before update on public.bookings for each row execute function public.fail_refresh();
do $$ declare b uuid; v bigint; before_row jsonb; before_lines jsonb; begin
b:=(public.test_admin_save('00000000-0000-4000-8000-000000000103')->>'booking_id')::uuid;
set constraints all immediate; set constraints all deferred;
select lifecycle_version,to_jsonb(bookings) into v,before_row from public.bookings where id=b;
select jsonb_agg(to_jsonb(l) order by id) into before_lines from public.booking_line_items l where booking_id=b;
begin
perform public.test_admin_save('00000000-0000-4000-8000-000000000104',b,v,'{"client_notes":"Must rollback","street_address":"Rollback address"}');
set constraints all immediate;
raise exception 'refresh failure missing';
exception when sqlstate 'ZX002' then null; end;
assert (select to_jsonb(bookings)=before_row from public.bookings where id=b), 'refresh failure root rollback';
assert (select jsonb_agg(to_jsonb(l) order by id)=before_lines from public.booking_line_items l where booking_id=b), 'refresh failure line rollback';
assert not exists(select 1 from public.properties where street_address='Rollback address'), 'property rollback';
assert not exists(select 1 from public.admin_booking_requests where request_id='00000000-0000-4000-8000-000000000104'), 'request rollback';
end $$;
rollback;
\echo 'PASS forced refresh failure aggregate rollback'
