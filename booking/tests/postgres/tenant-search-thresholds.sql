begin;
insert into profiles(id,organization_id,role,email,full_name)
select md5('profile-'||g)::uuid,'11111111-1111-4111-8111-111111111111','realtor',g||'@example.test',case when g=350 then 'ZZ Beyond Realtor' else 'Agent '||g end from generate_series(1,350) g;
insert into bookings(id,organization_id,property_id,owner_id,status,created_at,services)
select md5('booking-'||g)::uuid,'11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',case when g<=600 then 'delivered'::booking_status else 'confirmed'::booking_status end,now()-g*interval '1 day',case when g=1200 then array['beyond-cap'] else array['real_estate_photos'] end from generate_series(1,1200) g;
-- Establish the old capped predicates miss the actual fixtures.
do $$ begin
 if exists(select 1 from (select * from bookings where organization_id='11111111-1111-4111-8111-111111111111' order by created_at desc limit 500) b where 'beyond-cap'=any(services)) then raise exception 'bad beyond-cap fixture'; end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$ declare result jsonb; cursor_id uuid; seen uuid[]:='{}'; batch jsonb; item jsonb; begin
 result:=public.admin_booking_search('11111111-1111-4111-8111-111111111111','beyond-cap','all',null);
 if jsonb_array_length(result)<>1 then raise exception 'search beyond 500 failed: %',result; end if;
 result:=public.admin_booking_search('11111111-1111-4111-8111-111111111111','Real Estate Photography','all',null);
 if jsonb_array_length(result)<>51 then raise exception 'display-label search failed'; end if;
 result:=public.admin_realtor_search('11111111-1111-4111-8111-111111111111','ZZ Beyond Realtor',null);
 if jsonb_array_length(result)<>1 then raise exception 'search beyond 300 failed'; end if;
 result:=public.admin_realtor_search('11111111-1111-4111-8111-111111111111','a@example.test',null);
 if (result->0->>'bookingCount')::int<>1200 or (result->0->>'deliveredBookingCount')::int<>600 or (result->0->>'activeBookingCount')::int<>600 then raise exception 'full history counts failed: %',result; end if;
 loop
 batch:=public.admin_booking_search('11111111-1111-4111-8111-111111111111','','all',cursor_id);
 exit when jsonb_array_length(batch)=0;
 for item in select value from jsonb_array_elements(batch) limit 50 loop
 cursor_id:=(item->>'id')::uuid;
 if cursor_id=any(seen) then raise exception 'pagination duplicate'; end if;
 seen:=array_append(seen,cursor_id);
 end loop;
 end loop;
 if cardinality(seen)<>1200 then raise exception 'pagination lost rows: %',cardinality(seen); end if;
 cursor_id:=null; seen:='{}';
 loop
 batch:=public.admin_realtor_search('11111111-1111-4111-8111-111111111111','',cursor_id);
 exit when jsonb_array_length(batch)=0;
 for item in select value from jsonb_array_elements(batch) limit 50 loop
 cursor_id:=(item->>'id')::uuid;
 if cursor_id=any(seen) then raise exception 'realtor pagination duplicate'; end if;
 seen:=array_append(seen,cursor_id);
 end loop;
 end loop;
 if cardinality(seen)<>352 then raise exception 'realtor pagination lost rows: %',cardinality(seen); end if;
 result:=public.admin_booking_search('11111111-1111-4111-8111-111111111111','FOREIGN PRIVATE ADDRESS','all',null);
 if jsonb_array_length(result)<>0 then raise exception 'foreign address leaked'; end if;
 result:=public.admin_realtor_search('11111111-1111-4111-8111-111111111111','b@example.test',null);
 if jsonb_array_length(result)<>0 then raise exception 'foreign profile leaked'; end if;
 result:=public.admin_realtor_search('11111111-1111-4111-8111-111111111111','%',null);
 if jsonb_array_length(result)<>0 then raise exception 'wildcard was not literal'; end if;
 begin perform public.admin_booking_search('22222222-2222-4222-8222-222222222222','','all',null); raise exception 'foreign tenant allowed'; exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
 begin perform public.admin_realtor_search('11111111-1111-4111-8111-111111111111','',null); raise exception 'realtor allowed admin search'; exception when insufficient_privilege then null; end;
 if has_function_privilege('anon','public.admin_booking_search(uuid,text,text,uuid)','execute') then raise exception 'anon execute granted'; end if;
end $$;
reset role;
update profiles set archived_at=now() where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
set local request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$ begin
 begin perform public.admin_realtor_search('11111111-1111-4111-8111-111111111111','',null); raise exception 'archived admin allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
