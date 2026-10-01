do $$ declare response jsonb; new_booking_id uuid; v text; begin
 if public.current_booking_quote_policy()<>'2026-09-30-v1' then raise exception 'Final policy not activated'; end if;
 begin
  perform pg_temp.cutover_public(true,null,gen_random_uuid(),180);
  raise exception 'Old application silently committed new pricing';
 exception when sqlstate 'PB005' then null; end;
 foreach v in array array[null,'','legacy','2026-09-30-v0'] loop
  begin
   perform pg_temp.cutover_public(false,v,gen_random_uuid(),180);
   raise exception 'Stale/absent quote policy accepted';
  exception when sqlstate 'PB005' then null; end;
 end loop;
 begin
  perform public.save_admin_booking_aggregate('00000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000002',gen_random_uuid(),null,null,
   jsonb_build_object('owner_id','91000000-0000-4000-8000-000000000001','street_address','Admin cutover','scheduled_at',now()+interval '181 days','square_footage',2501,'include_basement',true,
    'catalog_item_ids',jsonb_build_array((select id from public.catalog_items where organization_id='00000000-0000-0000-0000-000000000001' and slug='video_tour'))));
  raise exception 'Old admin silently committed new pricing';
 exception when sqlstate 'PB005' then null; end;
 begin
  perform pg_temp.inflight_old_public_booking(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000001',
   'In-flight old quote','Hamilton','L8P4S8','',now()+interval '180 days 180 minutes',2501,'vacant',true,'',
   array[(select id from public.catalog_items where organization_id='00000000-0000-0000-0000-000000000001' and slug='video_tour')],'{}'::uuid[]);
  raise exception 'Already-running old wrapper entered new pricing core';
 exception when sqlstate 'PB005' then null; end;
 if (select bookings from cutover_before)<>(select count(*) from public.bookings)
 or (select properties from cutover_before)<>(select count(*) from public.properties)
 or (select jobs from cutover_before)<>(select count(*) from public.integration_jobs) then raise exception 'Rejected stale attempts mutated records'; end if;
 response:=pg_temp.cutover_public(false,'2026-09-30-v1','91000000-0000-4000-8000-000000000004',180);
 new_booking_id:=(response->>'booking_id')::uuid;
 if nullif(current_setting('pixel_booking.quote_policy',true),'') is not null then raise exception 'Versioned call leaked compatibility context'; end if;
 if (select unit_price_cents from public.booking_line_items where booking_id=new_booking_id)<>37500
 or (select extract(epoch from scheduled_ends_at-scheduled_at)/60 from public.bookings where bookings.id=new_booking_id)<>75 then raise exception 'Versioned quote did not match $375/75 minutes'; end if;
 response:=pg_temp.cutover_public(true,null,'91000000-0000-4000-8000-000000000003');
 if not (response->>'replayed')::boolean
 or (select extract(epoch from scheduled_ends_at-scheduled_at)/60 from public.bookings where bookings.id=(response->>'booking_id')::uuid)<>60
 or (select unit_price_cents from public.booking_line_items where booking_id=(response->>'booking_id')::uuid)<>32500 then raise exception 'Activation changed historical terms'; end if;
end $$;
\echo BOOKING_QUOTE_CUTOVER_PASSED
