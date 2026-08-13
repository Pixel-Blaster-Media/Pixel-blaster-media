\set ON_ERROR_STOP on

begin;

insert into public.organizations (id, name, slug) values
  ('11111111-1111-4111-8111-111111111111', 'Quarantine Tenant A', 'quarantine-tenant-a'),
  ('22222222-2222-4222-8222-222222222222', 'Quarantine Tenant B', 'quarantine-tenant-b');
insert into public.profiles (id, organization_id, role, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'admin', 'quarantine-admin-a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'admin', 'quarantine-admin-b@example.com');
insert into public.organization_members (organization_id, profile_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'admin');
insert into public.properties (id, organization_id, owner_id, street_address) values
  ('11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '1 Quarantine Street'),
  ('22222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '2 Quarantine Street');
insert into public.bookings (id, organization_id, property_id, owner_id, status) values
  ('11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'confirmed'),
  ('22222222-2222-4222-8222-222222222203', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222202', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'confirmed');
insert into public.integration_credentials (organization_id, provider, credentials, updated_by) values
  ('11111111-1111-4111-8111-111111111111', 'autohdr', '{"api_key":"tenant-a-key","enabled":"true"}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('22222222-2222-4222-8222-222222222222', 'autohdr', '{"api_key":"tenant-b-key","enabled":"true"}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');

set local role service_role;

create temporary table prepared_sources on commit drop as
select * from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000010',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"Quarantine.jpg","byte_size":4096,"mime_type":"image/jpeg","sha256":"1111111111111111111111111111111111111111111111111111111111111111"}]'
);

do $test$
declare
  v_original jsonb;
  v_replay jsonb;
begin
  if exists (
    select 1 from prepared_sources source
    where source.quarantine_object_key !~ (
      '^quarantine/' || source.organization_id::text || '/' || source.ingest_job_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
      or source.master_object_key <> 'masters/' || source.organization_id::text || '/' ||
        source.asset_id::text || '/' || source.version_id::text || '/' ||
        encode(source.sha256, 'hex') || '.jpg'
      or source.quarantine_object_key = source.master_object_key
      or source.quarantine_expires_at <= source.prepared_at
  ) then
    raise exception 'prepared source identities do not match shared quarantine/master grammar';
  end if;

  select jsonb_agg(to_jsonb(source) order by source.position) into v_original
  from prepared_sources source;
  select jsonb_agg(to_jsonb(source) || '{"newly_created":true}' order by source.position) into v_replay
  from public.prepare_autohdr_source_batch(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '00000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '[{"filename":"Quarantine.jpg","byte_size":4096,"mime_type":"image/jpeg","sha256":"1111111111111111111111111111111111111111111111111111111111111111"}]'
  ) source;
  if v_replay is distinct from v_original then
    raise exception 'exact request UUID replay changed rows or quarantine/master keys';
  end if;

  begin
    perform public.prepare_autohdr_source_batch(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '00000000-0000-4000-8000-000000000010',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '[{"filename":"Conflict.jpg","byte_size":4096,"mime_type":"image/jpeg","sha256":"1111111111111111111111111111111111111111111111111111111111111111"}]'
    );
    raise exception 'conflicting request UUID manifest was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$test$;

do $test$
declare
  v_source prepared_sources%rowtype;
  v_first jsonb;
  v_replay jsonb;
begin
  select * into strict v_source from prepared_sources;

  begin
    perform public.accept_autohdr_source_version(
      v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
      v_source.version_id, v_source.ingest_job_id, v_source.master_bucket_name,
      v_source.master_object_key, v_source.sha256, v_source.byte_size,
      v_source.mime_type, 3000, 2000
    );
    raise exception 'legacy acceptance fabricated missing quarantine lifecycle evidence';
  exception when object_not_in_prerequisite_state then null;
  end;

  begin
    perform public.mark_autohdr_source_quarantined(
      v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
      v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
      v_source.quarantine_object_key || '-drift', '"etag-a"', v_source.sha256,
      v_source.byte_size, v_source.mime_type
    );
    raise exception 'wrong quarantine key was accepted';
  exception when invalid_parameter_value then null;
  end;

  select to_jsonb(result) into v_first
  from public.mark_autohdr_source_quarantined(
    v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
    v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
    v_source.quarantine_object_key, '"etag-a"', v_source.sha256,
    v_source.byte_size, v_source.mime_type
  ) result;
  select to_jsonb(result) into v_replay
  from public.mark_autohdr_source_quarantined(
    v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
    v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
    v_source.quarantine_object_key, '"etag-a"', v_source.sha256,
    v_source.byte_size, v_source.mime_type
  ) result;
  if v_replay is distinct from v_first then
    raise exception 'exact quarantined evidence replay changed its result';
  end if;

  begin
    perform public.begin_autohdr_source_validation(
      v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
      v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
      v_source.quarantine_object_key, '"etag-drift"'
    );
    raise exception 'quarantine ETag drift was accepted';
  exception when invalid_parameter_value then null;
  end;

  perform public.begin_autohdr_source_validation(
    v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
    v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
    v_source.quarantine_object_key, '"etag-a"'
  );

  begin
    perform public.accept_autohdr_quarantined_source_version(
      v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
      v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
      v_source.quarantine_object_key, '"etag-a"', v_source.master_bucket_name,
      v_source.master_object_key, v_source.sha256, v_source.byte_size, v_source.mime_type,
      0, 2000
    );
    raise exception 'invalid decoded dimensions were accepted';
  exception when invalid_parameter_value then null;
  end;

  perform public.accept_autohdr_quarantined_source_version(
    v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
    v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
    v_source.quarantine_object_key, '"etag-a"', v_source.master_bucket_name,
    v_source.master_object_key, v_source.sha256, v_source.byte_size, v_source.mime_type,
    3000, 2000
  );
  perform public.accept_autohdr_quarantined_source_version(
    v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
    v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
    v_source.quarantine_object_key, '"etag-a"', v_source.master_bucket_name,
    v_source.master_object_key, v_source.sha256, v_source.byte_size, v_source.mime_type,
    3000, 2000
  );

  begin
    perform public.accept_autohdr_quarantined_source_version(
      v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
      v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
      v_source.quarantine_object_key, '"etag-a"', v_source.master_bucket_name,
      v_source.master_object_key, v_source.sha256, v_source.byte_size, v_source.mime_type,
      3001, 2000
    );
    raise exception 'accepted evidence drift was accepted';
  exception when invalid_parameter_value then null;
  end;

  if exists (
    select 1
    from public.autohdr_source_ingests source
    join public.media_versions version on version.id=source.version_id
    join public.media_ingest_jobs job on job.id=source.ingest_job_id
    where source.ingest_job_id=v_source.ingest_job_id
      and (source.lifecycle_state <> 'accepted'
        or source.quarantined_at is null or source.validation_started_at is null
        or source.master_promoted_at is null or source.accepted_at is null
        or version.ingest_state <> 'accepted' or job.state <> 'accepted'
        or version.width_px <> 3000 or version.height_px <> 2000)
  ) then
    raise exception 'accepted lifecycle evidence was not durable and canonical';
  end if;

  if exists (
    select 1 from public.media_job_attempts attempt
    where attempt.job_id=v_source.ingest_job_id
  ) or exists (
    select 1 from public.media_versions version
    where version.id=v_source.version_id
      and version.ingest_state in ('fetching', 'scanning')
  ) then
    raise exception 'source flow fabricated fetching or scanning evidence';
  end if;
end;
$test$;

-- A validated but unaccepted row is committed for the two-session acceptance proof.
create temporary table concurrent_source on commit drop as
select * from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000030',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"Concurrent.jpg","byte_size":5120,"mime_type":"image/jpeg","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}]'
);
do $test$
declare v_source concurrent_source%rowtype;
begin
  select * into strict v_source from concurrent_source;
  perform public.mark_autohdr_source_quarantined(
    v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
    v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
    v_source.quarantine_object_key, '"etag-concurrent"', v_source.sha256,
    v_source.byte_size, v_source.mime_type
  );
  perform public.begin_autohdr_source_validation(
    v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
    v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
    v_source.quarantine_object_key, '"etag-concurrent"'
  );
end;
$test$;

-- Expired prepared rows are not validatable and are returned by a bounded claim.
create temporary table expired_source on commit drop as
select * from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000040',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"Expired.png","byte_size":2048,"mime_type":"image/png","sha256":"4444444444444444444444444444444444444444444444444444444444444444"}]'
);
reset role;
set local session_replication_role = replica;
update public.autohdr_source_ingests
set prepared_at=clock_timestamp() - interval '2 days',
    quarantine_expires_at=clock_timestamp() - interval '1 minute',
    cleanup_next_attempt_at=clock_timestamp() - interval '1 minute'
where request_id='00000000-0000-4000-8000-000000000040';
set local session_replication_role = origin;
set local role service_role;

do $test$
declare
  v_source expired_source%rowtype;
begin
  select * into strict v_source from expired_source;
  begin
    perform public.mark_autohdr_source_quarantined(
      v_source.organization_id, v_source.booking_id, v_source.batch_id, v_source.asset_id,
      v_source.version_id, v_source.ingest_job_id, v_source.quarantine_bucket_name,
      v_source.quarantine_object_key, '"etag-expired"', v_source.sha256,
      v_source.byte_size, v_source.mime_type
    );
    raise exception 'expired prepared source was validated';
  exception when object_not_in_prerequisite_state then null;
  end;

end;
$test$;

create temporary table cleanup_claim on commit drop as
select * from public.claim_abandoned_autohdr_source_quarantine(1, 60);

do $test$
declare v_claim cleanup_claim%rowtype;
begin
  select * into strict v_claim from cleanup_claim;
  if v_claim.cleanup_lease_token is null
     or v_claim.cleanup_lease_expires_at <= clock_timestamp() then
    raise exception 'bounded abandoned-quarantine claim did not lease a due row';
  end if;

  begin
    perform public.settle_autohdr_source_quarantine_cleanup(
      v_claim.organization_id, v_claim.booking_id, v_claim.property_id,
      v_claim.ingest_job_id, v_claim.quarantine_object_key, null,
      gen_random_uuid(), 'not_found', null
    );
    raise exception 'cleanup settlement accepted the wrong lease token';
  exception when object_not_in_prerequisite_state then null;
  end;

end;
$test$;

reset role;
update public.autohdr_source_ingests source
set cleanup_lease_expires_at=clock_timestamp() - interval '1 second'
from cleanup_claim claim
where source.organization_id=claim.organization_id
  and source.ingest_job_id=claim.ingest_job_id;
set local role service_role;

do $test$
declare v_claim cleanup_claim%rowtype;
begin
  select * into strict v_claim from cleanup_claim;
  begin
    perform public.settle_autohdr_source_quarantine_cleanup(
      v_claim.organization_id, v_claim.booking_id, v_claim.property_id,
      v_claim.ingest_job_id, v_claim.quarantine_object_key, null,
      v_claim.cleanup_lease_token, 'not_found', null
    );
    raise exception 'cleanup settlement accepted an expired lease';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$test$;

create temporary table cleanup_reclaim on commit drop as
select * from public.claim_abandoned_autohdr_source_quarantine(1, 60);

do $test$
declare v_claim cleanup_reclaim%rowtype;
begin
  select * into strict v_claim from cleanup_reclaim;
  perform public.settle_autohdr_source_quarantine_cleanup(
    v_claim.organization_id, v_claim.booking_id, v_claim.property_id,
    v_claim.ingest_job_id, v_claim.quarantine_object_key, null,
    v_claim.cleanup_lease_token, 'not_found', null
  );
  if not exists (
    select 1
    from public.autohdr_source_ingests source
    join public.media_versions version on version.id=source.version_id
    join public.media_ingest_jobs job on job.id=source.ingest_job_id
    where source.ingest_job_id=v_claim.ingest_job_id
      and source.lifecycle_state='reconciliation_required'
      and source.reconciliation_required_at is not null
      and source.cleanup_outcome='not_found'
      and version.ingest_state='reconciliation_required'
      and job.state='reconciliation_required'
  ) then
    raise exception 'cleanup settlement did not preserve truthful reconciliation evidence';
  end if;
  if exists (
    select 1 from public.claim_abandoned_autohdr_source_quarantine(10, 60)
    where ingest_job_id=v_claim.ingest_job_id
  ) then
    raise exception 'settled abandoned quarantine remained claimable';
  end if;
end;
$test$;

reset role;
do $test$
begin
  if has_table_privilege('service_role', 'public.autohdr_source_ingests', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.autohdr_source_ingests', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.autohdr_source_ingests', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'source-ingest table grants allow direct mutation or browser access';
  end if;

  if has_function_privilege('anon', 'public.prepare_autohdr_source_batch(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.prepare_autohdr_source_batch(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.prepare_autohdr_source_batch(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_abandoned_autohdr_source_quarantine(integer,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_abandoned_autohdr_source_quarantine(integer,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_autohdr_source_quarantined(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,bytea,bigint,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.begin_autohdr_source_validation(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.accept_autohdr_quarantined_source_version(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,bytea,bigint,text,integer,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.settle_autohdr_source_quarantine_cleanup(uuid,uuid,uuid,uuid,text,text,uuid,text,text)', 'EXECUTE') then
    raise exception 'source-ingest RPC grants expose browser mutation';
  end if;

  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.autohdr_source_ingests'::regclass) then
    raise exception 'source-ingest table is missing forced RLS';
  end if;

  if pg_get_functiondef(
       'public.accept_autohdr_quarantined_source_version(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,bytea,bigint,text,integer,integer)'::regprocedure
     ) ~ '''(fetching|scanning)'''
     or pg_get_functiondef(
       'public.accept_autohdr_source_version(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bytea,bigint,text,integer,integer)'::regprocedure
     ) ~ '''(fetching|scanning)''' then
    raise exception 'source acceptance function fabricates fetching or scanning state';
  end if;
  if pg_get_functiondef(
       'public.settle_autohdr_source_quarantine_cleanup(uuid,uuid,uuid,uuid,text,text,uuid,text,text)'::regprocedure
     ) ~ '\mdelete\M' then
    raise exception 'cleanup settlement deletes SQL rows';
  end if;
end;
$test$;

\if :{?commit_fixture}
commit;
\else
rollback;
\endif
