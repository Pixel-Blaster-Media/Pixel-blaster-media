begin;
set local role service_role;
do $$ begin
  begin
    update public.integration_jobs set effect_version=effect_version+100;
    raise exception 'effect generation identity was mutable';
  exception when check_violation then null;
  end;
end $$;
rollback;

begin;
set local role service_role;
create temporary table before_jobs as select * from public.integration_jobs;
update public.bookings set scheduled_at=scheduled_at+interval '1 day',scheduled_ends_at=scheduled_ends_at+interval '1 day';
set constraints all immediate;
select public.recovery_assert((select count(*)=3 from public.integration_jobs where status='cancelled'),'obsolete unclaimed confirmation/admin/invoice jobs must be superseded');
select public.recovery_assert((select count(*)=3 from public.integration_jobs j join public.bookings b on b.id=j.booking_id where j.status='pending' and j.job_type in ('email.booking.confirmation','email.admin.new_booking','quickbooks.invoice.create') and (j.payload->'booking'->>'scheduled_at')::timestamptz=b.scheduled_at),'replacement payloads must reflect current schedule');
select public.recovery_assert(not exists(select 1 from public.integration_jobs j join before_jobs old using(id) where j.payload<>old.payload or j.idempotency_key<>old.idempotency_key),'historical payload and provider identity must remain immutable');
select public.recovery_assert((select count(*)=1 from public.integration_jobs where job_type='google_calendar.event.create'),'calendar reproject job is not replaced');
rollback;

-- Deferred package replacement snapshots only the final aggregate.
begin;
set local role service_role;
create temporary table old_lines as select id from public.booking_line_items;
insert into public.booking_line_items(booking_id,catalog_item_id,quantity,unit_price_cents,unit_duration_minutes)
select booking_id,catalog_item_id,quantity,unit_price_cents+5000,unit_duration_minutes from public.booking_line_items;
delete from public.booking_line_items where id in (select id from old_lines);
update public.properties set street_address='2 New Fixture Street';
set constraints all immediate;
select public.recovery_assert((select count(*)=3 from public.integration_jobs where status='pending' and job_type in ('email.booking.confirmation','email.admin.new_booking','quickbooks.invoice.create') and jsonb_array_length(payload->'line_items')=1 and (payload->'line_items'->0->>'unit_price_cents')::integer=25000 and payload->'property'->>'street_address'='2 New Fixture Street'),'package/address replacement uses final lines exactly once');
rollback;

-- Terminal-only booking reads must not churn lifecycle/effect state.
begin;
update public.profiles set full_name='Updated Realtor',email='updated@example.invalid';
update public.bookings set client_notes='Contact changed with aggregate';
set constraints all immediate;
select public.recovery_assert(not exists(select 1 from public.integration_jobs where status='pending' and job_type in ('email.booking.confirmation','email.admin.new_booking','quickbooks.invoice.create') and (payload->'realtor'->>'email' is distinct from 'updated@example.invalid' or payload->'realtor'->>'full_name' is distinct from 'Updated Realtor')),'current effect must reconstruct realtor snapshot');
rollback;

-- Terminal-only booking reads must not churn lifecycle/effect state.
begin;
update public.integration_jobs set status='skipped',completed_at=now();
update public.bookings set scheduled_at=scheduled_at+interval '1 day',scheduled_ends_at=scheduled_ends_at+interval '1 day';
set constraints all immediate;
create temporary table saved_version as select effect_version from public.bookings;
select public.refresh_booking_effects('11111111-1111-4111-8111-111111111111',(select id from public.bookings));
select public.recovery_assert((select b.effect_version=v.effect_version from public.bookings b,saved_version v),'terminal-only recovery must be a read-only no-op');
rollback;

begin;
set local role service_role;
create temporary table held_claim as select public.claim_integration_job('11111111-1111-4111-8111-111111111111',(select id from public.bookings),'email.admin.new_booking','fixture','70000000-0000-4000-8000-000000000001') as value;
update public.bookings set scheduled_at=scheduled_at+interval '1 day',scheduled_ends_at=scheduled_ends_at+interval '1 day';
set constraints all immediate;
select public.recovery_assert((select count(*)=1 from public.integration_jobs where job_type='email.admin.new_booking' and status='processing'),'edit preserves in-flight lease');
select public.finish_integration_job('11111111-1111-4111-8111-111111111111',(select (value->>'id')::uuid from held_claim),'70000000-0000-4000-8000-000000000001','retryable',null,'{}','send_failed','send failed',now());
create temporary table replacement_claim as select public.claim_integration_job('11111111-1111-4111-8111-111111111111',(select id from public.bookings),'email.admin.new_booking','fixture','70000000-0000-4000-8000-000000000002') as value;
select public.recovery_assert((select value is null from replacement_claim),'obsolete attempted email must not replay or get a new key after ambiguous send');
select public.recovery_assert((select status='dead_letter' from public.integration_jobs where id=(select (value->>'id')::uuid from held_claim)),'obsolete attempted work requires reconciliation');
rollback;
