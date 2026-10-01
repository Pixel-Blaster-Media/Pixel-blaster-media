select pg_temp.assert_admin_cutover_replay(true);
select pg_temp.assert_admin_new_writes_blocked(true);
do $$ begin
 if pg_temp.cutover_state() is distinct from (select state from cutover_state_snapshot) then raise exception 'Admin retries/rejections changed persistent state'; end if;
end $$;
do $$ declare response jsonb; begin
 if public.current_booking_quote_policy()<>'paused' then raise exception 'Expansion window is not paused'; end if;
 begin
  perform pg_temp.cutover_public(true,null,gen_random_uuid(),180);
  raise exception 'Legacy new booking passed paused gate';
 exception when sqlstate 'PB005' then null; end;
 begin
  perform pg_temp.cutover_public(false,'2026-09-30-v1',gen_random_uuid(),180);
  raise exception 'New app wrote before policy activation';
 exception when sqlstate 'PB005' then null; end;
 begin
  perform public.save_admin_booking_aggregate('00000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000002',gen_random_uuid(),null,null,'{}');
  raise exception 'Admin write passed paused gate';
 exception when sqlstate 'PB005' then null; end;
 response:=pg_temp.cutover_public(true,null,'91000000-0000-4000-8000-000000000003');
 if not (response->>'replayed')::boolean or response->>'booking_id' is distinct from (select result->>'booking_id' from cutover_receipt) then raise exception 'Historical replay failed during pause'; end if;
 if (select bookings from cutover_before)<>(select count(*) from public.bookings)
 or (select properties from cutover_before)<>(select count(*) from public.properties)
 or (select jobs from cutover_before)<>(select count(*) from public.integration_jobs) then raise exception 'Paused attempts changed persistent state'; end if;
end $$;
