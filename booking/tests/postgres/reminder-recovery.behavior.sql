begin;
set local role service_role;
update public.bookings set scheduled_at=now()+interval '12 hours', scheduled_ends_at=now()+interval '14 hours';
create temporary table reminder_claim as select public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),1,'70000000-0000-4000-8000-000000000001') value;
-- schedule was changed by fixture, use actual version for first claim.
update reminder_claim set value=public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000001');
select public.recovery_assert((select value is not null from reminder_claim),'due reminder is claimed');
select public.recovery_assert(public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000002') is null,'overlapping invocation does not send');
select public.recovery_assert(not public.finish_booking_reminder('11111111-1111-4111-8111-111111111111',(select (value->>'id')::uuid from reminder_claim),'70000000-0000-4000-8000-000000000002','completed','provider-1'),'wrong token fenced');
select public.recovery_assert(public.finish_booking_reminder('11111111-1111-4111-8111-111111111111',(select (value->>'id')::uuid from reminder_claim),'70000000-0000-4000-8000-000000000001','completed','provider-1'),'accepted reminder settles');
select public.recovery_assert((select reminder_sent_at is not null from public.bookings),'accepted reminder stamps booking');
select public.recovery_assert(public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000002') is null,'completed generation does not resend');
update public.bookings set scheduled_at=scheduled_at+interval '1 hour',scheduled_ends_at=scheduled_ends_at+interval '1 hour';
select public.recovery_assert((select reminder_sent_at is null from public.bookings),'new schedule resets legacy stamp');
select public.recovery_assert(public.claim_booking_reminder('11111111-1111-4111-8111-111111111111',(select id from public.bookings),(select schedule_version from public.bookings),'70000000-0000-4000-8000-000000000003') is not null,'rescheduled appointment gets its own reminder');
rollback;
