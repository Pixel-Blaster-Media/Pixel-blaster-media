begin;
do $$ declare r jsonb; b uuid; begin
r := public.test_admin_save('00000000-0000-4000-8000-000000000031'); b := (r->>'booking_id')::uuid;
assert (select count(*) = 1 from public.booking_line_items where booking_id=b), 'exactly one snapshot';
assert (select unit_price_cents=39000 from public.booking_line_items where booking_id=b), 'canonical sqft overage';
assert (select allow_schedule_overlap and suppress_realtor_notifications from public.bookings where id=b), 'admin overlap and privacy preserved';
assert (select scheduled_ends_at-scheduled_at=interval '90 minutes' from public.bookings where id=b), 'canonical duration';
end $$;
rollback;
\echo 'PASS atomic admin create and public-price parity'
begin;
do $$ declare r jsonb; b uuid; v bigint; begin
r := public.test_admin_save('00000000-0000-4000-8000-000000000031'); b := (r->>'booking_id')::uuid; v := (r->>'lifecycle_version')::bigint;
update public.catalog_items set price_cents=99999, name='Renamed', active=false where id='00000000-0000-4000-8000-000000000021';
r := public.test_admin_save('00000000-0000-4000-8000-000000000031');
assert (r->>'booking_id')::uuid=b and (r->>'replayed')::boolean, 'replay survives catalog drift';
begin perform public.test_admin_save('00000000-0000-4000-8000-000000000031',null,null,'{"square_footage":4000}'); raise exception 'changed replay accepted'; exception when sqlstate 'PB003' then null; end;
r := public.test_admin_save('00000000-0000-4000-8000-000000000032',b,v,'{"client_notes":"Edited"}');
assert (select count(*)=1 and min(unit_price_cents)=39000 and min(item_name)='Original' from public.booking_line_items where booking_id=b), 'retained historical snapshot';
assert (r->>'lifecycle_version')::bigint>v, 'edit advances version';
r := public.test_admin_save('00000000-0000-4000-8000-000000000032',b,v,'{"client_notes":"Edited"}');
assert (r->>'replayed')::boolean, 'identical edit replays with original rendered version';
begin perform public.test_admin_save('00000000-0000-4000-8000-000000000034',b,null); raise exception 'missing version accepted'; exception when sqlstate 'PB004' then null; end;
begin perform public.test_admin_save(null,b,v); raise exception 'missing request accepted'; exception when sqlstate 'PB002' then null; end;
begin perform public.test_admin_save('00000000-0000-4000-8000-000000000033',b,v); raise exception 'stale edit accepted'; exception when sqlstate 'PB004' then null; end;
assert (select client_notes='Edited' from public.bookings where id=b), 'stale edit changes nothing';
assert (select count(*)=1 and min(unit_price_cents)=39000 and min(item_name)='Original' from public.booking_line_items where booking_id=b), 'replay and rejected edits preserve snapshots';
end $$;
rollback;
\echo 'PASS request replay, drift, retained history and edit CAS'

begin;
do $$ declare b uuid; begin
b := (public.test_admin_save('00000000-0000-4000-8000-000000000041')->>'booking_id')::uuid;
update public.bookings set status='cancelled' where id=b;
begin update public.bookings set status='shot' where id=b; raise exception 'cancelled booking resurrected'; exception when sqlstate 'PB004' then null; end;
begin update public.bookings set scheduled_at=scheduled_at+interval '1 day' where id=b; raise exception 'cancelled booking moved'; exception when sqlstate 'PB004' then null; end;
end $$;
rollback;
\echo 'PASS cancelled state is fenced for every writer'

begin;
create function public.test_fail_line() returns trigger language plpgsql as $$ begin raise exception 'forced line failure' using errcode='ZX001'; end $$;
create trigger test_fail_line before insert on public.booking_line_items for each row execute function public.test_fail_line();
do $$ declare n bigint; p bigint; begin
select count(*) into n from public.bookings; select count(*) into p from public.properties;
begin perform public.test_admin_save('00000000-0000-4000-8000-000000000051'); raise exception 'failure not injected'; exception when sqlstate 'ZX001' then null; end;
assert (select count(*)=n from public.bookings), 'root rolled back';
assert (select count(*)=p from public.properties), 'property rolled back';
assert not exists(select 1 from public.admin_booking_requests where request_id='00000000-0000-4000-8000-000000000051'), 'request rolled back';
end $$;
rollback;
\echo 'PASS forced snapshot failure rolls back entire create'

begin;
do $$ declare b uuid; begin
b := (public.test_admin_save('00000000-0000-4000-8000-000000000061')->>'booking_id')::uuid;
assert (select count(*)=4 from public.integration_jobs where booking_id=b), 'creation effects atomically enqueued';
assert (select bool_and((payload->'line_items'->0->>'unit_price_cents')::int=39000) from public.integration_jobs where booking_id=b), 'effects use final price snapshots';
end $$;
rollback;
\echo 'PASS atomic admin effects use complete snapshots'

begin;
do $$ declare a uuid; b uuid; r jsonb; begin
r:=public.create_public_booking_with_jobs('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012','Public Street','Test City','T1T 1T1',null,'2030-01-02T15:00:00Z',3000,null,null,'',array['00000000-0000-4000-8000-000000000021']::uuid[],'{}'::uuid[]);
a:=(r->>'booking_id')::uuid;
b:=(public.test_admin_save('00000000-0000-4000-8000-000000000082')->>'booking_id')::uuid;
assert (select unit_price_cents from public.booking_line_items where booking_id=a)=(select unit_price_cents from public.booking_line_items where booking_id=b), 'actual public/admin RPC price parity';
end $$;
rollback;
\echo 'PASS actual public and admin RPC price parity'

begin;
do $$ declare b uuid; v bigint; begin
b:=(public.test_admin_save('00000000-0000-4000-8000-000000000091')->>'booking_id')::uuid;
select lifecycle_version into v from public.bookings where id=b;
insert into public.catalog_items(id,organization_id,slug,name,kind,duration_minutes,price_cents) values ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','extra','Extra','addon',30,5000);
update public.catalog_items set price_cents=99999,duration_minutes=240,active=false where id='00000000-0000-4000-8000-000000000021';
perform public.test_admin_save('00000000-0000-4000-8000-000000000092',b,v,'{"catalog_item_ids":["00000000-0000-4000-8000-000000000021","00000000-0000-4000-8000-000000000022"]}');
assert (select count(*)=2 and sum(unit_price_cents)=44000 from public.booking_line_items where booking_id=b), 'adding item retains historical inactive price';
assert (select scheduled_ends_at-scheduled_at=interval '120 minutes' from public.bookings where id=b), 'retained duration plus new duration';
end $$;
rollback;
\echo 'PASS partial selection retains immutable history'

begin;
do $$ declare b uuid; v bigint; r jsonb; begin
r:=public.test_admin_save('00000000-0000-4000-8000-000000000301');
b:=(r->>'booking_id')::uuid; v:=(r->>'lifecycle_version')::bigint;
insert into public.catalog_items(id,organization_id,slug,name,kind,duration_minutes,price_cents) values ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','extra','Extra','addon',30,5000);
perform public.test_admin_save('00000000-0000-4000-8000-000000000302',b,v,'{"catalog_item_ids":["00000000-0000-4000-8000-000000000021","00000000-0000-4000-8000-000000000022"]}');
r:=public.test_admin_save('00000000-0000-4000-8000-000000000302',b,v,'{"catalog_item_ids":["00000000-0000-4000-8000-000000000021","00000000-0000-4000-8000-000000000022"]}');
assert (r->>'replayed')::boolean, 'identical package edit replays';
begin perform public.test_admin_save('00000000-0000-4000-8000-000000000303',b,v); raise exception 'stale package replacement accepted'; exception when sqlstate 'PB004' then null; end;
assert (select count(*)=2 and sum(unit_price_cents)=44000 from public.booking_line_items where booking_id=b), 'stale package cannot delete winning lines';
assert (select scheduled_ends_at-scheduled_at=interval '120 minutes' from public.bookings where id=b), 'winning duration preserved';
assert (select count(*)=2 from public.admin_booking_requests where booking_id=b), 'only create and winning edit recorded';
end $$;
rollback;
\echo 'PASS stale package replacement preserves winning snapshots and identical replay'
