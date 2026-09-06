\set ON_ERROR_STOP on
create function pg_temp.check_true(value boolean, message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception '%', message; end if; end $$;
select pg_temp.check_true(to_regprocedure('public.begin_public_booking_verification(uuid,uuid,text,text,text)') is not null, 'RED: inbox challenge RPC missing');
set role service_role;
select public.begin_public_booking_verification('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','controlled@example.test',repeat('a',64),repeat('b',64)) as issued \gset
reset role;
select pg_temp.check_true(:'issued'::boolean, 'issue challenge');
select pg_temp.check_true(not public.begin_public_booking_verification('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','controlled@example.test',repeat('a',64),repeat('c',64)), 'email cooldown across request IDs');
select pg_temp.check_true(not public.verify_public_booking_inbox('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','controlled@example.test',repeat('c',64),repeat('b',64)), 'changed draft rejected');
select pg_temp.check_true(public.verify_public_booking_inbox('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','controlled@example.test',repeat('a',64),repeat('b',64)), 'correct proof accepted');
select pg_temp.check_true(not public.verify_public_booking_inbox('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','controlled@example.test',repeat('a',64),repeat('b',64)), 'proof consumed once');
select pg_temp.check_true(not has_function_privilege('anon','public.verify_public_booking_inbox(uuid,uuid,text,text,text)','execute'), 'anon cannot verify');
select pg_temp.check_true(not has_table_privilege('authenticated','public.public_booking_inbox_challenges','select'), 'challenge private');
update public.public_booking_inbox_challenges set expires_at=now()-interval '1 second';
select pg_temp.check_true(public.begin_public_booking_verification('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','controlled@example.test',repeat('a',64),repeat('c',64)), 'expired challenge can resend');
do $$ begin for i in 1..5 loop perform public.verify_public_booking_inbox('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','controlled@example.test',repeat('a',64),repeat('b',64)); end loop; end $$;
select pg_temp.check_true(not public.verify_public_booking_inbox('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','controlled@example.test',repeat('a',64),repeat('c',64)), 'five guesses lock challenge');
update public.public_booking_inbox_challenges set expires_at=now()-interval '1 second', attempts=0;
select pg_temp.check_true(not public.verify_public_booking_inbox('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','controlled@example.test',repeat('a',64),repeat('c',64)), 'expired correct code rejected');
select 'inbox PostgreSQL assertions passed';
