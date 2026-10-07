\set ON_ERROR_STOP on
insert into public.organizations(id,name,slug) values
 ('99000000-0000-4000-8000-000000000001','Upload fixture A','upload-fixture-a'),
 ('99000000-0000-4000-8000-000000000002','Upload fixture B','upload-fixture-b');
insert into public.catalog_items(id,organization_id,slug,name) values
 ('99000000-0000-4000-8000-000000000011','99000000-0000-4000-8000-000000000001','upload-a','Upload A'),
 ('99000000-0000-4000-8000-000000000012','99000000-0000-4000-8000-000000000002','upload-b','Upload B');

do $$ begin
 if has_function_privilege('anon','public.claim_catalog_resumable_upload(uuid,uuid,uuid,bigint,text)','execute')
 or has_function_privilege('authenticated','public.claim_catalog_resumable_upload(uuid,uuid,uuid,bigint,text)','execute')
 then raise exception 'resumable reservation exposed publicly'; end if;
 if exists(select 1 from public.catalog_stream_upload_claims where upload_protocol='basic'
   and (upload_size is not null or upload_fingerprint is not null or upload_expires_at is not null or upload_url is not null))
 then raise exception 'historical upload metadata changed'; end if;
end $$;
set role service_role;
do $$
declare
 a uuid := '99000000-0000-4000-8000-000000000001';
 b uuid := '99000000-0000-4000-8000-000000000002';
 ca uuid := '99000000-0000-4000-8000-000000000011';
 cb uuid := '99000000-0000-4000-8000-000000000012';
 one uuid := '99000000-0000-4000-8000-000000000021';
 result jsonb; example uuid;
begin
 result := public.claim_catalog_resumable_upload(one,a,ca,0,repeat('a',64));
 if result->>'status'<>'invalid' then raise exception 'empty size accepted'; end if;
 result := public.claim_catalog_resumable_upload(one,a,ca,1000000001,repeat('a',64));
 if result->>'status'<>'invalid' then raise exception 'oversize accepted'; end if;
 result := public.claim_catalog_resumable_upload(one,a,ca,500000000,'invalid');
 if result->>'status'<>'invalid' then raise exception 'invalid fingerprint accepted'; end if;
 result := public.claim_catalog_resumable_upload(one,b,ca,500000000,repeat('a',64));
 if result->>'status'<>'catalog_not_found' then raise exception 'cross-tenant reservation accepted'; end if;
 result := public.claim_catalog_resumable_upload(one,a,ca,1000000000,repeat('a',64));
 if result->>'status'<>'claimed' or result->>'claim_id'<>one::text then raise exception '1GB boundary failed'; end if;
 if not exists(select 1 from public.catalog_stream_upload_claims where id=one and upload_size=1000000000
   and upload_protocol='tus' and upload_expires_at between now()+interval '5 hours 59 minutes' and now()+interval '6 hours 1 minute')
 then raise exception 'metadata/expiry not recorded'; end if;
 result := public.claim_catalog_resumable_upload('99000000-0000-4000-8000-000000000022',a,ca,1000000000,repeat('a',64));
 if result->>'status'<>'resume' or result->>'claim_id'<>one::text then raise exception 'retry made another claim'; end if;
 if (select count(*) from public.catalog_stream_upload_claims where organization_id=a)<>1 then raise exception 'retry consumed quota'; end if;
 result := public.claim_catalog_resumable_upload(one,a,ca,500000000,repeat('b',64));
 if result->>'status'<>'duplicate' then raise exception 'operation identity was reused for another file'; end if;
 result := public.claim_catalog_resumable_upload('99000000-0000-4000-8000-000000000023',b,cb,1000000000,repeat('a',64));
 if result->>'status'<>'claimed' then raise exception 'other tenant fingerprint incorrectly matched'; end if;
 update public.catalog_stream_upload_claims set stream_uid=repeat('a',32),state='provisioned',upload_url='https://upload.videodelivery.net/mock-capability' where id=one;
 example:=public.attach_catalog_stream_upload(one,a,ca,repeat('a',32),'Upload fixture',null);
 if example is null then raise exception 'resumable upload did not use existing attachment protection'; end if;
 result := public.claim_catalog_resumable_upload('99000000-0000-4000-8000-000000000024',a,ca,1000000000,repeat('a',64));
 if result->>'status'<>'resume' or result->>'claim_id'<>one::text then raise exception 'attached resume failed'; end if;
 result := public.claim_catalog_resumable_upload('99000000-0000-4000-8000-000000000025',a,ca,300000000,repeat('b',64));
 if result->>'status'<>'claimed' then raise exception 'second pending upload failed'; end if;
 result := public.claim_catalog_resumable_upload('99000000-0000-4000-8000-000000000026',a,ca,500000000,repeat('c',64));
 if result->>'status'<>'too_many_pending' then raise exception 'pending quota bypassed'; end if;
 result := public.claim_catalog_resumable_upload('99000000-0000-4000-8000-000000000027',a,ca,1000000000,repeat('a',64));
 if result->>'status'<>'resume' then raise exception 'quota blocked safe resume'; end if;
end $$;
reset role;
