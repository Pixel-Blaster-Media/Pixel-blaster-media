begin;
set role service_role;
do $$
declare
 o uuid:='11111111-1111-4111-8111-111111111111'; a uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
 b uuid:='21111111-1111-4111-8111-111111111101'; p uuid:='11111111-1111-4111-8111-111111111101';
 r uuid:='31111111-1111-4111-8111-111111111101'; i uuid:='41111111-1111-4111-8111-111111111101';
 j public.media_ingest_jobs; k public.media_ingest_jobs; v public.media_versions; old_token uuid;
 n bigint; s text;
begin
 j:=public.photo_finals_create_intent(o,a,b,p,r,i,repeat('a',64),100);
 if j.id<>i then raise exception 'bad retry identity'; end if;
 begin perform public.photo_finals_create_intent(o,a,b,p,r,i,repeat('b',64),100); raise exception 'changed payload accepted';
 exception when check_violation then if sqlerrm<>'finals_intent_payload_conflict' then raise; end if; end;
 begin perform public.photo_finals_create_intent(o,a,gen_random_uuid(),p,r,gen_random_uuid(),repeat('b',64),100); raise exception 'foreign booking accepted';
 exception when insufficient_privilege then if sqlerrm<>'finals_booking_denied' then raise; end if; end;
 begin perform public.photo_finals_create_intent(o,gen_random_uuid(),b,p,r,gen_random_uuid(),repeat('b',64),100); raise exception 'foreign actor accepted';
 exception when insufficient_privilege then if sqlerrm<>'finals_actor_denied' then raise; end if; end;
 update profiles set archived_at=now() where id=a;
 begin perform public.photo_finals_create_intent(o,a,b,p,r,i,repeat('a',64),100); raise exception 'revoked actor replay';
 exception when insufficient_privilege then null; end;
 update profiles set archived_at=null where id=a;
 j:=public.photo_finals_claim(o,b,p,i,'test_a');
 old_token:=j.finals_lease_token;
 k:=public.photo_finals_claim(o,b,p,i,'test_b');
 if k.id is not null then raise exception 'double claim'; end if;
 begin perform public.photo_finals_fence(gen_random_uuid(),i,old_token); raise exception 'cross tenant fence'; exception when object_not_in_prerequisite_state then null; end;
 -- Actual expiration without sleeping; fixture-only privileged lease clock manipulation.
 update media_ingest_jobs set finals_lease_started_at=clock_timestamp()-interval '130 seconds',finals_lease_expires_at=clock_timestamp()-interval '1 second' where id=i;
 begin perform public.photo_finals_accept(o,i,old_token,'local-private-masters',1,1); raise exception 'expired acceptance'; exception when object_not_in_prerequisite_state then null; end;
 k:=public.photo_finals_claim(o,b,p,i,'test_b');
 if k.finals_lease_token=old_token or k.attempts<>2 then raise exception 'lease not rotated'; end if;
 begin perform public.photo_finals_fence(o,i,old_token); raise exception 'stale promotion'; exception when object_not_in_prerequisite_state then null; end;
 begin perform public.photo_finals_fail(o,i,old_token,false); raise exception 'stale settlement'; exception when object_not_in_prerequisite_state then null; end;
 begin perform public.photo_finals_accept(o,i,k.finals_lease_token,'local-private-masters',null,1); raise exception 'null width'; exception when invalid_parameter_value then null; end;
 begin perform public.photo_finals_accept(o,i,k.finals_lease_token,'local-private-masters',1,null); raise exception 'null height'; exception when invalid_parameter_value then null; end;
 select count(*) into n from media_versions where accepted_at is not null;
 if n<>0 then raise exception 'failed acceptance residue'; end if;
 -- Final attempt must terminalize even when caller requests retryable.
 update media_ingest_jobs set max_attempts=2 where id=i;
 perform public.photo_finals_fail(o,i,k.finals_lease_token,false);
 select state into s from media_ingest_jobs where id=i;
 if s<>'dead_letter' then raise exception 'attempt exhaustion'; end if;
 select count(*) into n from media_job_attempts where job_id=i;
 if n<>2 then raise exception 'attempt evidence missing'; end if;
 if (public.photo_finals_claim(o,b,p,i,'test_c')).id is not null then raise exception 'dead letter reclaimed'; end if;
end $$;
rollback;

-- Atomic rollback even if failure happens after batch + asset + version insertion.
begin;
create function public.finals_test_fail() returns trigger language plpgsql as $$begin raise exception 'forced_job_failure' using errcode='P0001'; end$$;
create trigger finals_test_fail before insert on media_ingest_jobs for each row execute function public.finals_test_fail();
set role service_role;
do $$declare before_count bigint; after_count bigint; begin
 select count(*) into before_count from media_versions;
 begin perform public.photo_finals_create_intent('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','21111111-1111-4111-8111-111111111101','11111111-1111-4111-8111-111111111101',gen_random_uuid(),gen_random_uuid(),repeat('b',64),100); raise exception 'did not fail';
 exception when raise_exception then if sqlerrm<>'forced_job_failure' then raise; end if; end;
 select count(*) into after_count from media_versions;
 if before_count<>after_count or (select count(*) from media_assets)<>1 or (select count(*) from media_batches)<>1 then raise exception 'partial intent residue'; end if;
end$$;
rollback;

-- Expired upload intents terminalize durably before storage work.
begin;
alter table media_ingest_jobs disable trigger finals_intent_immutable;
update media_ingest_jobs set finals_deadline=clock_timestamp()-interval '1 second' where id='41111111-1111-4111-8111-111111111101';
alter table media_ingest_jobs enable trigger finals_intent_immutable;
set role service_role;
do $$begin
 if (public.photo_finals_claim('11111111-1111-4111-8111-111111111111','21111111-1111-4111-8111-111111111101','11111111-1111-4111-8111-111111111101','41111111-1111-4111-8111-111111111101','expiry')).id is not null then raise exception 'expired intent claimed'; end if;
 if (select state from media_ingest_jobs where id='41111111-1111-4111-8111-111111111101')<>'dead_letter' then raise exception 'expiry not terminal'; end if;
end$$;
rollback;

-- Browser execution remains denied on every new function.
do $$declare f record; begin
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname like 'photo_finals_%' loop
 if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') then raise exception 'browser execute granted'; end if;
 end loop;
end$$;
