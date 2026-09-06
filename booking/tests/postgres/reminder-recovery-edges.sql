-- Missing current profile evidence terminalizes a recoverable row, not a hot-loop.
begin;
update public.bookings set scheduled_at=now()+interval '12 hours',scheduled_ends_at=now()+interval '14 hours';
select public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000001');
update public.booking_reminder_jobs set lease_expires_at=now()-interval '1 second';
update public.profiles set archived_at=now();
select public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000002');
select public.recovery_assert((select status='dead_letter' from public.booking_reminder_jobs),'missing snapshot evidence terminalizes expired work');
rollback;

-- Retry/crash tests intentionally use database owner to move clocks; no provider IO.
begin;
update public.bookings set scheduled_at=now()+interval '12 hours',scheduled_ends_at=now()+interval '14 hours';
create temporary table r as select public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000001') value;
select public.recovery_assert(public.authorize_booking_reminder('11111111-1111-4111-8111-111111111111',(select (value->>'id')::uuid from r),'70000000-0000-4000-8000-000000000001',repeat('a',64)),'first request hash binds');
update public.booking_reminder_jobs set lease_expires_at=now()-interval '1 second';
select public.recovery_assert(not public.finish_booking_reminder('11111111-1111-4111-8111-111111111111',(select (value->>'id')::uuid from r),'70000000-0000-4000-8000-000000000001','completed','remote'),'expired completion rejected');
create temporary table r2 as select public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000002') value;
select public.recovery_assert((select a.value->>'idempotency_key'=b.value->>'idempotency_key' and a.value->'payload'=b.value->'payload' and a.value->>'lease_token'<>b.value->>'lease_token' from r a,r2 b),'reclaim preserves request identity and rotates lease');
select public.recovery_assert(not public.authorize_booking_reminder('11111111-1111-4111-8111-111111111111',(select (value->>'id')::uuid from r),'70000000-0000-4000-8000-000000000002',repeat('b',64)),'changed rendered bytes cannot use same key');
select public.recovery_assert((select status='dead_letter' from public.booking_reminder_jobs),'hash drift terminalized');
rollback;

begin;
update public.bookings set scheduled_at=now()+interval '12 hours',scheduled_ends_at=now()+interval '14 hours';
create temporary table r as select public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000001') value;
select public.finish_booking_reminder('11111111-1111-4111-8111-111111111111',(select (value->>'id')::uuid from r),'70000000-0000-4000-8000-000000000001','retryable',null);
select public.recovery_assert((select count(*)=0 from public.list_due_booking_reminders()),'backoff excludes immediate retry');
update public.booking_reminder_jobs set next_attempt_at=now()-interval '1 minute';
select public.recovery_assert((select count(*)=1 from public.list_due_booking_reminders()),'same-day failed reminder remains eligible');
update public.booking_reminder_jobs set first_attempt_at=now()-interval '24 hours';
select public.recovery_assert(public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000002') is null,'retry beyond provider window rejected');
select public.recovery_assert((select status='dead_letter' from public.booking_reminder_jobs),'old retry is visible reconciliation state');
rollback;

begin;
update public.bookings set scheduled_at=now()+interval '12 hours',scheduled_ends_at=now()+interval '14 hours';
create temporary table r as select public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000001') value;
update public.bookings set status='cancelled';
select public.recovery_assert(not public.authorize_booking_reminder('11111111-1111-4111-8111-111111111111',(select (value->>'id')::uuid from r),'70000000-0000-4000-8000-000000000001',repeat('a',64)),'cancellation before provider authorization fences send');
select public.recovery_assert(public.claim_booking_reminder('22222222-2222-4222-8222-222222222222',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000002') is null,'foreign tenant cannot claim');
select public.recovery_assert(not has_function_privilege('authenticated','public.claim_booking_reminder(uuid,uuid,bigint,uuid)','EXECUTE'),'browser cannot claim');
select public.recovery_assert(not has_table_privilege('authenticated','public.booking_reminder_jobs','SELECT'),'browser cannot read snapshots');
select public.recovery_assert(not has_table_privilege('service_role','public.booking_reminder_jobs','UPDATE'),'provider snapshot cannot be rewritten through service table API');
rollback;
