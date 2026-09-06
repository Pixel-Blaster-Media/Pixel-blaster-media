begin;
insert into bookings(id,organization_id,property_id,owner_id,status,scheduled_at,created_at,services)
select md5('order-'||g)::uuid,'11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
case when g>100 then 'requested'::booking_status else 'confirmed'::booking_status end,
case when g>100 then null else '2030-01-01'::timestamptz + (g%3)*interval '1 day' end,
'2026-01-01'::timestamptz+(g%4)*interval '1 second',array['order-probe'] from generate_series(1,160) g;
insert into profiles(id,organization_id,role,email,full_name)
select md5('order-profile-'||g)::uuid,'11111111-1111-4111-8111-111111111111','realtor', 'order-probe-'||(g%5)||'@test',case when g>100 then null else 'Name '||(g%3) end from generate_series(1,160) g;
set local role authenticated;
set local request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$ declare batch jsonb; item jsonb; cursor_value jsonb; seen uuid[]; expected uuid[]; kind text; begin
 foreach kind in array array['jobs','realtors'] loop
 cursor_value:=null; seen:='{}';
 if kind='jobs' then
 select array_agg(id order by case when status='requested' and scheduled_at is null then 0 else 1 end,scheduled_at asc nulls first,created_at desc,id) into expected from bookings where 'order-probe'=any(services);
 else
 select array_agg(id order by full_name asc nulls last,email,id) into expected from profiles where email like 'order-probe-%';
 end if;
 loop
 if kind='jobs' then
 -- First call remains compatible with the pre-fix UUID signature to prove ordering RED.
 if cursor_value is null then batch:=public.admin_booking_search('11111111-1111-4111-8111-111111111111','order-probe','active',null);
 else execute 'select public.admin_booking_search($1,$2,$3,$4)' into batch using '11111111-1111-4111-8111-111111111111'::uuid,'order-probe','active',cursor_value; end if;
 else
 if cursor_value is null then batch:=public.admin_realtor_search('11111111-1111-4111-8111-111111111111','order-probe',null);
 else execute 'select public.admin_realtor_search($1,$2,$3)' into batch using '11111111-1111-4111-8111-111111111111'::uuid,'order-probe',cursor_value; end if;
 end if;
 exit when jsonb_array_length(batch)=0;
 for item in select value from jsonb_array_elements(batch) limit 50 loop
 seen:=array_append(seen,(item->>'id')::uuid);
 if seen[cardinality(seen)]<>expected[cardinality(seen)] then raise exception '% operational ordering displaced at position %',kind,cardinality(seen); end if;
 cursor_value:=item->'_cursor';
 end loop;
 if cardinality(seen)>160 then raise exception 'cursor did not advance'; end if;
 end loop;
 if seen is distinct from expected then raise exception '% ordered traversal incomplete',kind; end if;
 end loop;
end $$;
rollback;
