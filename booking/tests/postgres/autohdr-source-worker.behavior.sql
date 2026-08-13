\set ON_ERROR_STOP on

begin;

insert into public.organizations (id, name, slug) values
  ('11111111-1111-4111-8111-111111111111', 'Source Worker Tenant A', 'source-worker-tenant-a'),
  ('22222222-2222-4222-8222-222222222222', 'Source Worker Tenant B', 'source-worker-tenant-b');
insert into public.profiles (id, organization_id, role, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'admin', 'source-worker-a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'admin', 'source-worker-b@example.com');
insert into public.organization_members (organization_id, profile_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'admin');
insert into public.properties (id, organization_id, owner_id, street_address) values
  ('11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '1 Worker Street'),
  ('22222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '2 Worker Street');
insert into public.bookings (id, organization_id, property_id, owner_id, status) values
  ('11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'confirmed'),
  ('22222222-2222-4222-8222-222222222203', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222202', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'confirmed');
insert into public.integration_credentials (organization_id, provider, credentials, updated_by) values
  ('11111111-1111-4111-8111-111111111111', 'autohdr', '{"api_key":"tenant-a-key","enabled":"true"}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('22222222-2222-4222-8222-222222222222', 'autohdr', '{"api_key":"tenant-b-key","enabled":"true"}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');

set local role service_role;

do $test$
declare
  v_manifest jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'filename', 'limit-' || item || '.jpg',
    'byte_size', 13107200,
    'mime_type', 'image/jpeg',
    'sha256', md5('limit-' || item) || md5('limit-' || item)
  ) order by item) into v_manifest
  from generate_series(1, 20) item;

  if (select count(*) from public.prepare_autohdr_source_batch(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '00000000-0000-4000-8000-000000000101',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    v_manifest
  )) <> 20 then
    raise exception 'exact 20-file/250MiB v2 boundary was not accepted';
  end if;

  select jsonb_agg(jsonb_build_object(
    'filename', 'too-many-' || item || '.jpg',
    'byte_size', 1,
    'mime_type', 'image/jpeg',
    'sha256', md5('too-many-' || item) || md5('too-many-' || item)
  ) order by item) into v_manifest
  from generate_series(1, 21) item;
  begin
    perform public.prepare_autohdr_source_batch(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '00000000-0000-4000-8000-000000000102',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', v_manifest
    );
    raise exception 'v2 accepted more than 20 files';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.prepare_autohdr_source_batch(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '00000000-0000-4000-8000-000000000103',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '[{"filename":"oversize.jpg","byte_size":26214401,"mime_type":"image/jpeg","sha256":"abababababababababababababababababababababababababababababababab"}]'
    );
    raise exception 'v2 accepted a file larger than 25MiB';
  exception when invalid_parameter_value then null;
  end;

  select jsonb_agg(jsonb_build_object(
    'filename', 'over-total-' || item || '.jpg',
    'byte_size', 13107200 + case when item = 1 then 1 else 0 end,
    'mime_type', 'image/jpeg',
    'sha256', md5('over-total-' || item) || md5('over-total-' || item)
  ) order by item) into v_manifest
  from generate_series(1, 20) item;
  begin
    perform public.prepare_autohdr_source_batch(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '00000000-0000-4000-8000-000000000104',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', v_manifest
    );
    raise exception 'v2 accepted a request larger than 250MiB';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.prepare_autohdr_source_batch(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '00000000-0000-4000-8000-000000000105',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '[{"filename":"duplicate-a.jpg","byte_size":1,"mime_type":"image/jpeg","sha256":"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"},
        {"filename":"duplicate-b.jpg","byte_size":1,"mime_type":"image/jpeg","sha256":"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"}]'
    );
    raise exception 'v2 accepted duplicate hashes within one request';
  exception when invalid_parameter_value then null;
  end;
end;
$test$;

do $test$
begin
  if to_regclass('public.autohdr_source_hash_reservations') is null
     or to_regclass('public.autohdr_source_position_refs') is null
     or to_regprocedure('public.claim_autohdr_source_file(uuid,text,integer)') is null
     or to_regprocedure('public.reserve_or_reuse_autohdr_source_master(uuid,uuid,uuid,text,text,bytea,bigint,text)') is null
     or to_regprocedure('public.complete_autohdr_source_file(uuid,uuid,uuid,integer,integer)') is null then
    raise exception 'source worker lease/reservation/reuse contract is missing';
  end if;

  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.autohdr_source_hash_reservations'::regclass)
     or not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.autohdr_source_position_refs'::regclass)
     or has_table_privilege('anon', 'public.autohdr_source_hash_reservations', 'select')
     or has_table_privilege('authenticated', 'public.autohdr_source_position_refs', 'select')
     or has_function_privilege('authenticated', 'public.claim_autohdr_source_file(uuid,text,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.claim_autohdr_source_file(uuid,text,integer)', 'execute') then
    raise exception 'source worker contract is not forced-RLS and service-only';
  end if;
  if exists (
    select 1 from public.autohdr_source_ingests
    where request_id in ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000025')
      and (position not between 0 and 19 or expected_byte_size > 26214400)
      and lifecycle_state <> 'reconciliation_required'
  ) then
    raise exception 'legacy out-of-worker-bounds fixtures were not contained';
  end if;
end;
$test$;

-- Prepare and quarantine one source so the database worker can lease it.
create temporary table worker_source on commit drop as
select * from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000201',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"worker.jpg","byte_size":12,"mime_type":"image/jpeg","sha256":"1212121212121212121212121212121212121212121212121212121212121212"}]'
);
select public.mark_autohdr_source_quarantined(
  organization_id, booking_id, batch_id, asset_id, version_id, ingest_job_id,
  quarantine_bucket_name, quarantine_object_key, 'worker-etag', sha256, byte_size, mime_type
) from worker_source;

create temporary table worker_claim on commit drop as
select * from public.claim_autohdr_source_file(
  '11111111-1111-4111-8111-111111111111', 'worker-a', 60
);

do $test$
declare
  v_source worker_source%rowtype;
  v_claim worker_claim%rowtype;
  v_reserved record;
begin
  select * into v_source from worker_source;
  select * into v_claim from worker_claim;
  if v_claim.ingest_job_id is distinct from v_source.ingest_job_id
     or v_claim.lease_token is null
     or v_claim.worker_id <> 'worker-a' then
    raise exception 'one-file claim did not return the quarantined source and lease';
  end if;
  if exists (select 1 from public.claim_autohdr_source_file(
    '11111111-1111-4111-8111-111111111111', 'worker-b', 60
  )) then
    raise exception 'an active source lease was claimed twice';
  end if;

  select * into v_reserved from public.reserve_or_reuse_autohdr_source_master(
    v_source.organization_id, v_source.ingest_job_id, v_claim.lease_token,
    v_source.master_bucket_name, v_source.master_object_key,
    v_source.sha256, v_source.byte_size, v_source.mime_type
  );
  if v_reserved.version_id is distinct from v_source.version_id
     or not v_reserved.newly_reserved or v_reserved.reused_accepted then
    raise exception 'first exact source hash was not reserved for its canonical master';
  end if;

  -- Exact replay is stable for the same live lease.
  select * into v_reserved from public.reserve_or_reuse_autohdr_source_master(
    v_source.organization_id, v_source.ingest_job_id, v_claim.lease_token,
    v_source.master_bucket_name, v_source.master_object_key,
    v_source.sha256, v_source.byte_size, v_source.mime_type
  );
  if v_reserved.version_id is distinct from v_source.version_id
     or v_reserved.newly_reserved or v_reserved.reused_accepted then
    raise exception 'reservation replay changed the canonical identity';
  end if;

  begin
    perform public.reserve_or_reuse_autohdr_source_master(
      v_source.organization_id, v_source.ingest_job_id,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      v_source.master_bucket_name, v_source.master_object_key,
      v_source.sha256, v_source.byte_size, v_source.mime_type
    );
    raise exception 'stale source lease was not fenced';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$test$;

-- Complete the reserved master through the lease-fenced atomic completion RPC,
-- then prove a later same-tenant source reuses it.
select public.complete_autohdr_source_file(
  source.organization_id, source.ingest_job_id, claim.lease_token, 100, 100
) from worker_source source cross join worker_claim claim;

-- The application runtime overload must cross the same trigger-fenced
-- lifecycle boundary and clear its lease, not merely exist in generated types.
do $test$
declare
  v_source public.autohdr_source_ingests;
begin
  select * into v_source from public.autohdr_source_ingests
   where request_id = '00000000-0000-4000-8000-000000000201';
  if v_source.lifecycle_state <> 'accepted' or v_source.worker_lease_token is not null then
    raise exception 'lease-fenced source completion did not accept and clear its lease';
  end if;
end;
$test$;

create temporary table reused_source on commit drop as
select * from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000203',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"worker-copy.jpg","byte_size":12,"mime_type":"image/jpeg","sha256":"1212121212121212121212121212121212121212121212121212121212121212"}]'
);
select public.mark_autohdr_source_quarantined(
  organization_id, booking_id, batch_id, asset_id, version_id, ingest_job_id,
  quarantine_bucket_name, quarantine_object_key, 'worker-copy-etag', sha256, byte_size, mime_type
) from reused_source;
create temporary table reused_claim on commit drop as
select * from public.claim_autohdr_source_file(
  '11111111-1111-4111-8111-111111111111', 'worker-reuse', 60
);

do $test$
declare
  v_original worker_source%rowtype;
  v_source reused_source%rowtype;
  v_claim reused_claim%rowtype;
  v_reserved record;
begin
  select * into v_original from worker_source;
  select * into v_source from reused_source;
  select * into v_claim from reused_claim;
  select * into v_reserved from public.reserve_or_reuse_autohdr_source_master(
    v_source.organization_id, v_source.ingest_job_id, v_claim.lease_token,
    v_source.master_bucket_name, v_source.master_object_key,
    v_source.sha256, v_source.byte_size, v_source.mime_type
  );
  if v_reserved.version_id is distinct from v_original.version_id
     or v_reserved.newly_reserved or not v_reserved.reused_accepted then
    raise exception 'accepted source hash was not reused as the sole permanent master identity';
  end if;

  begin
    update public.autohdr_source_hash_reservations
       set master_object_key = master_object_key || '-mutated'
     where organization_id = v_source.organization_id and sha256 = v_source.sha256;
    raise exception 'source reservation identity was mutable';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    delete from public.autohdr_source_hash_reservations
     where organization_id = v_source.organization_id and sha256 = v_source.sha256;
    raise exception 'source reservation identity was deletable';
  exception when insufficient_privilege or check_violation then null;
  end;
end;
$test$;

-- The same bytes in another tenant have an independent reservation identity.
create temporary table tenant_b_source on commit drop as
select * from public.prepare_autohdr_source_batch(
  '22222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222203',
  '00000000-0000-4000-8000-000000000202',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  '[{"filename":"worker.jpg","byte_size":12,"mime_type":"image/jpeg","sha256":"1212121212121212121212121212121212121212121212121212121212121212"}]'
);
select public.mark_autohdr_source_quarantined(
  organization_id, booking_id, batch_id, asset_id, version_id, ingest_job_id,
  quarantine_bucket_name, quarantine_object_key, 'tenant-b-etag', sha256, byte_size, mime_type
) from tenant_b_source;
create temporary table tenant_b_claim on commit drop as
select * from public.claim_autohdr_source_file(
  '22222222-2222-4222-8222-222222222222', 'worker-b', 60
);

do $test$
declare
  v_source tenant_b_source%rowtype;
  v_claim tenant_b_claim%rowtype;
  v_reserved record;
begin
  select * into v_source from tenant_b_source;
  select * into v_claim from tenant_b_claim;
  select * into v_reserved from public.reserve_or_reuse_autohdr_source_master(
    v_source.organization_id, v_source.ingest_job_id, v_claim.lease_token,
    v_source.master_bucket_name, v_source.master_object_key,
    v_source.sha256, v_source.byte_size, v_source.mime_type
  );
  if v_reserved.version_id is distinct from v_source.version_id or not v_reserved.newly_reserved then
    raise exception 'source hash reservation was not tenant scoped';
  end if;
end;
$test$;

-- Exercise the exact application-runtime completion overload.
create temporary table runtime_source on commit drop as
select * from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000208','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"runtime.jpg","byte_size":16,"mime_type":"image/jpeg","sha256":"6767676767676767676767676767676767676767676767676767676767676767"}]'
);
select public.mark_autohdr_source_quarantined(
  organization_id,booking_id,batch_id,asset_id,version_id,ingest_job_id,
  quarantine_bucket_name,quarantine_object_key,'runtime-etag',sha256,byte_size,mime_type
) from runtime_source;
create temporary table runtime_claim on commit drop as
select * from public.claim_autohdr_source_file(
  '11111111-1111-4111-8111-111111111111','runtime-worker',60
);
create temporary table runtime_reservation on commit drop as
select reserved.* from runtime_source source cross join runtime_claim claim
cross join lateral public.reserve_or_reuse_autohdr_source_master(
  source.organization_id,source.ingest_job_id,claim.lease_token,
  source.master_bucket_name,source.master_object_key,source.sha256,source.byte_size,source.mime_type
) reserved;
select public.complete_autohdr_source_file(
  source.organization_id,source.ingest_job_id,claim.lease_token,'runtime-etag','accepted',
  reservation.version_id,reservation.asset_id,reservation.batch_id,reservation.bucket_name,
  reservation.object_key,101,102
) from runtime_source source cross join runtime_claim claim cross join runtime_reservation reservation;

do $test$
begin
  if not exists (select 1 from public.autohdr_source_ingests
    where request_id='00000000-0000-4000-8000-000000000208'
      and lifecycle_state='accepted' and worker_lease_token is null) then
    raise exception 'runtime completion overload did not accept and clear its lease';
  end if;
end $test$;

-- Exact runtime reconciliation settlement must cross the same trigger fence.
create temporary table runtime_settle_source on commit drop as
select * from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000209','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"runtime-settle.jpg","byte_size":17,"mime_type":"image/jpeg","sha256":"7878787878787878787878787878787878787878787878787878787878787878"}]'
);
select public.mark_autohdr_source_quarantined(
  organization_id,booking_id,batch_id,asset_id,version_id,ingest_job_id,
  quarantine_bucket_name,quarantine_object_key,'runtime-settle-etag',sha256,byte_size,mime_type
) from runtime_settle_source;
create temporary table runtime_settle_claim on commit drop as
select * from public.claim_autohdr_source_file(
  '11111111-1111-4111-8111-111111111111','runtime-settle-worker',60
);
select public.settle_autohdr_source_file(
  source.organization_id,source.ingest_job_id,claim.lease_token,
  'runtime-settle-etag','reconciliation_required','runtime_test_reconciliation'
) from runtime_settle_source source cross join runtime_settle_claim claim;

do $test$
begin
  if not exists (select 1 from public.autohdr_source_ingests
    where request_id='00000000-0000-4000-8000-000000000209'
      and lifecycle_state='reconciliation_required' and worker_lease_token is null) then
    raise exception 'runtime reconciliation settlement did not transition and clear its lease';
  end if;
end $test$;

-- Durable fixture consumed by the runner's real two-session SKIP LOCKED proof.
select * from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000204',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"concurrent-worker.jpg","byte_size":13,"mime_type":"image/jpeg","sha256":"3434343434343434343434343434343434343434343434343434343434343434"}]'
);
select public.mark_autohdr_source_quarantined(
  organization_id, booking_id, batch_id, asset_id, version_id, ingest_job_id,
  quarantine_bucket_name, quarantine_object_key, 'concurrent-worker-etag', sha256, byte_size, mime_type
) from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000204',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"concurrent-worker.jpg","byte_size":13,"mime_type":"image/jpeg","sha256":"3434343434343434343434343434343434343434343434343434343434343434"}]'
);

-- Durable crash-after-reservation fixture consumed by the runner.
select public.mark_autohdr_source_quarantined(
  organization_id, booking_id, batch_id, asset_id, version_id, ingest_job_id,
  quarantine_bucket_name, quarantine_object_key, 'crash-worker-etag', sha256, byte_size, mime_type
) from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000205',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"crash-worker.jpg","byte_size":14,"mime_type":"image/jpeg","sha256":"4545454545454545454545454545454545454545454545454545454545454545"}]'
);

-- Two distinct sources with identical bytes for the real reservation race.
select public.mark_autohdr_source_quarantined(
  organization_id, booking_id, batch_id, asset_id, version_id, ingest_job_id,
  quarantine_bucket_name, quarantine_object_key, 'race-a-etag', sha256, byte_size, mime_type
) from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000206','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"race-a.jpg","byte_size":15,"mime_type":"image/jpeg","sha256":"5656565656565656565656565656565656565656565656565656565656565656"}]'
);
select public.mark_autohdr_source_quarantined(
  organization_id, booking_id, batch_id, asset_id, version_id, ingest_job_id,
  quarantine_bucket_name, quarantine_object_key, 'race-b-etag', sha256, byte_size, mime_type
) from public.prepare_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000207','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '[{"filename":"race-b.jpg","byte_size":15,"mime_type":"image/jpeg","sha256":"5656565656565656565656565656565656565656565656565656565656565656"}]'
);

\if :{?commit_fixture}
commit;
\else
rollback;
\endif
