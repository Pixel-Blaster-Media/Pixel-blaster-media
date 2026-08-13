\set ON_ERROR_STOP on

begin;

insert into public.organizations (id, name, slug) values
  ('11111111-1111-4111-8111-111111111111', 'AutoHDR Tenant A', 'autohdr-tenant-a'),
  ('22222222-2222-4222-8222-222222222222', 'AutoHDR Tenant B', 'autohdr-tenant-b');
insert into public.profiles (id, organization_id, role, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'admin', 'autohdr-a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'admin', 'autohdr-b@example.com');
insert into public.organization_members (organization_id, profile_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'admin');
insert into public.properties (id, organization_id, owner_id, street_address) values
  ('11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '1 AutoHDR Street'),
  ('22222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '2 AutoHDR Street');
insert into public.bookings (id, organization_id, property_id, owner_id, status) values
  ('11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'confirmed'),
  ('22222222-2222-4222-8222-222222222203', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222202', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'confirmed');

set local role service_role;

insert into public.media_batches (
  id, organization_id, property_id, booking_id, source_provider,
  provider_connection_key, provider_job_id
) values
  ('31111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111102', 'fixture', 'autohdr-a', 'source-a'),
  ('32222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222203', 'fixture', 'autohdr-b', 'source-b');
insert into public.media_assets (
  id, organization_id, property_id, batch_id, source_provider,
  provider_connection_key, provider_job_id, provider_output_id, original_filename
) values
  ('41111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', '31111111-1111-4111-8111-111111111101', 'fixture', 'autohdr-a', 'source-a', 'input-a', 'Kitchen.jpg'),
  ('42222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222202', '32222222-2222-4222-8222-222222222202', 'fixture', 'autohdr-b', 'source-b', 'input-b', 'Exterior.jpg');
insert into public.media_versions (
  id, organization_id, property_id, batch_id, asset_id, version_number
) values
  ('51111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', '31111111-1111-4111-8111-111111111101', '41111111-1111-4111-8111-111111111101', 1),
  ('52222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222202', '32222222-2222-4222-8222-222222222202', '42222222-2222-4222-8222-222222222202', 1);

update public.media_versions set ingest_state = 'url_ready';
update public.media_versions set ingest_state = 'fetching';
update public.media_versions set ingest_state = 'quarantined';
update public.media_versions set ingest_state = 'validating';
update public.media_versions set ingest_state = 'scanning';
update public.media_versions
   set ingest_state = 'accepted', object_tier = 'master',
       bucket_name = 'autohdr-source-test',
       object_key = case id
         when '51111111-1111-4111-8111-111111111101' then 'masters/tenant-a/kitchen.jpg'
         else 'masters/tenant-b/exterior.jpg'
       end,
       sha256 = case id
         when '51111111-1111-4111-8111-111111111101' then decode(repeat('11', 32), 'hex')
         else decode(repeat('22', 32), 'hex')
       end,
       byte_size = 2048, mime_type = 'image/jpeg', width_px = 2000,
       height_px = 1333, accepted_at = now();

do $$
declare
  v_job record;
  v_duplicate record;
  v_conflicting_job record;
begin
  select * into v_job
    from public.claim_autohdr_job(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '11111111-1111-4111-8111-111111111101',
      'autohdr-fixture-a', decode(repeat('aa', 32), 'hex'),
      '[{"position":0,"source_media_version_id":"51111111-1111-4111-8111-111111111101","filename":"Kitchen.jpg"}]'::jsonb
    );
  if v_job.state <> 'claimed' or v_job.file_count <> 1
     or v_job.newly_created is distinct from true
     or v_job.provider_uid is not null or v_job.retrieval_claim_token is not null then
    raise exception 'new AutoHDR claim did not initialize safely';
  end if;

  select * into v_duplicate
    from public.claim_autohdr_job(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '11111111-1111-4111-8111-111111111101',
      'autohdr-fixture-a', decode(repeat('aa', 32), 'hex'),
      '[{"position":0,"source_media_version_id":"51111111-1111-4111-8111-111111111101","filename":"Kitchen.jpg"}]'::jsonb
    );
  if v_duplicate.id <> v_job.id
     or v_duplicate.newly_created is distinct from false then
    raise exception 'duplicate AutoHDR idempotency did not return the existing job';
  end if;

  begin
    perform public.claim_autohdr_job(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '11111111-1111-4111-8111-111111111101',
      'autohdr-fixture-a', decode(repeat('bb', 32), 'hex'),
      '[{"position":0,"source_media_version_id":"51111111-1111-4111-8111-111111111101","filename":"Kitchen.jpg"}]'::jsonb
    );
    raise exception 'conflicting idempotency manifest was accepted';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.claim_autohdr_job(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '11111111-1111-4111-8111-111111111101',
      'autohdr-cross-tenant', decode(repeat('cc', 32), 'hex'),
      '[{"position":0,"source_media_version_id":"52222222-2222-4222-8222-222222222202","filename":"Exterior.jpg"}]'::jsonb
    );
    raise exception 'cross-tenant canonical source was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    perform public.assign_autohdr_provider_uid(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
      'provider-a', 'created'
    );
    raise exception 'provider uid was assigned before preparation';
  exception when check_violation then null;
  end;

  perform public.transition_autohdr_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'claimed', 'preparing', null, null, null
  );
  perform public.assign_autohdr_provider_uid(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'provider-a', 'created'
  );
  perform public.assign_autohdr_provider_uid(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'provider-a', 'created'
  );
  begin
    perform public.assign_autohdr_provider_uid(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
      'provider-conflict', 'created'
    );
    raise exception 'conflicting provider uid assignment was accepted';
  exception when unique_violation then null;
  end;

  begin
    select * into v_conflicting_job
      from public.claim_autohdr_job(
        v_job.organization_id, v_job.booking_id, v_job.property_id,
        'autohdr-provider-conflict', decode(repeat('ab', 32), 'hex'),
        '[{"position":0,"source_media_version_id":"51111111-1111-4111-8111-111111111101","filename":"Kitchen.jpg"}]'::jsonb
      );
    perform public.transition_autohdr_job(
      v_conflicting_job.organization_id, v_conflicting_job.booking_id,
      v_conflicting_job.property_id, v_conflicting_job.id,
      'claimed', 'preparing', null, null, null
    );
    perform public.assign_autohdr_provider_uid(
      v_conflicting_job.organization_id, v_conflicting_job.booking_id,
      v_conflicting_job.property_id, v_conflicting_job.id,
      'provider-a', 'created'
    );
    raise exception 'provider uid was assigned to a second tenant job';
  exception when unique_violation then null;
  end;

  begin
    perform public.transition_autohdr_job(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
      'preparing', 'processing', null, null, null
    );
    raise exception 'invalid state jump was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.transition_autohdr_job(
      '22222222-2222-4222-8222-222222222222', v_job.booking_id,
      v_job.property_id, v_job.id, 'preparing', 'awaiting_upload', null, null, null
    );
    raise exception 'wrong-tenant transition found a job';
  exception when no_data_found then null;
  end;

  perform public.transition_autohdr_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'preparing', 'awaiting_upload', 'uploading', null, null
  );
  perform public.transition_autohdr_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'awaiting_upload', 'finalizing', 'uploading', null, null
  );
  perform public.transition_autohdr_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'finalizing', 'processing', 'processing', null, null
  );
  perform public.transition_autohdr_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'processing', 'ready', 'ready', null, null
  );

  begin
    update public.autohdr_jobs
       set state = 'review_pending'
     where organization_id = v_job.organization_id
       and booking_id = v_job.booking_id
       and property_id = v_job.property_id
       and id = v_job.id;
    raise exception 'direct table update bypassed the retrieval state';
  exception when check_violation or insufficient_privilege then null;
  end;

  begin
    perform public.transition_autohdr_job(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
      'ready', 'review_pending', 'ready', null, null
    );
    raise exception 'direct ready to review_pending was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.transition_autohdr_job(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
      'ready', 'retrieving', 'ready', null, null
    );
    raise exception 'generic transition bypassed retrieval claim';
  exception when check_violation then null;
  end;
  begin
    perform public.transition_autohdr_job(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
      'ready', 'reconciliation_required', null, 'UNSAFE ERROR', null
    );
    raise exception 'unsafe error code was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

select public.claim_autohdr_job(
  '22222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222203',
  '22222222-2222-4222-8222-222222222202',
  'autohdr-fixture-a', decode(repeat('dd', 32), 'hex'),
  '[{"position":0,"source_media_version_id":"52222222-2222-4222-8222-222222222202","filename":"Exterior.jpg"}]'::jsonb
);

reset role;

do $$
declare
  v_forbidden_columns text;
  v_unsafe_functions text;
begin
  select string_agg(column_name, ', ' order by column_name)
    into v_forbidden_columns
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('autohdr_jobs', 'autohdr_job_files')
     and (
       column_name like '%url%'
       or column_name like '%api_key%'
       or column_name like '%raw_error%'
       or column_name like '%error_message%'
     );
  if v_forbidden_columns is not null then
    raise exception 'forbidden AutoHDR persistence columns: %', v_forbidden_columns;
  end if;

  select string_agg(routine_name, ', ' order by routine_name)
    into v_unsafe_functions
    from information_schema.routines
   where routine_schema = 'public'
     and routine_name in (
       'claim_autohdr_job', 'transition_autohdr_job',
       'assign_autohdr_provider_uid', 'claim_autohdr_retrieval'
     )
     and security_type <> 'DEFINER';
  if v_unsafe_functions is not null then
    raise exception 'AutoHDR RPCs are not security definer: %', v_unsafe_functions;
  end if;

  if has_function_privilege('anon', 'public.claim_autohdr_job(uuid,uuid,uuid,text,bytea,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_autohdr_job(uuid,uuid,uuid,text,bytea,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_autohdr_job(uuid,uuid,uuid,text,bytea,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.transition_autohdr_job(uuid,uuid,uuid,uuid,text,text,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.transition_autohdr_job(uuid,uuid,uuid,uuid,text,text,text,text,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.transition_autohdr_job(uuid,uuid,uuid,uuid,text,text,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.assign_autohdr_provider_uid(uuid,uuid,uuid,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.assign_autohdr_provider_uid(uuid,uuid,uuid,uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.assign_autohdr_provider_uid(uuid,uuid,uuid,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_autohdr_retrieval(uuid,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_autohdr_retrieval(uuid,uuid,uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_autohdr_retrieval(uuid,uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'AutoHDR RPC grants are unsafe';
  end if;

  if has_function_privilege('anon', 'public.list_autohdr_jobs(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.list_autohdr_jobs(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.list_autohdr_jobs(uuid,uuid)', 'EXECUTE') then
    raise exception 'AutoHDR safe-read RPC grants are unsafe';
  end if;

  if has_table_privilege('anon', 'public.autohdr_jobs', 'SELECT')
     or has_table_privilege('authenticated', 'public.autohdr_jobs', 'SELECT')
     or has_table_privilege('authenticated', 'public.autohdr_jobs', 'INSERT')
     or has_table_privilege('authenticated', 'public.autohdr_jobs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.autohdr_jobs', 'DELETE')
     or not has_table_privilege('service_role', 'public.autohdr_jobs', 'SELECT')
     or has_table_privilege('service_role', 'public.autohdr_jobs', 'INSERT')
     or has_table_privilege('service_role', 'public.autohdr_jobs', 'UPDATE')
     or has_table_privilege('service_role', 'public.autohdr_jobs', 'DELETE')
     or has_table_privilege('anon', 'public.autohdr_job_files', 'SELECT')
     or not has_table_privilege('authenticated', 'public.autohdr_job_files', 'SELECT')
     or has_table_privilege('authenticated', 'public.autohdr_job_files', 'INSERT')
     or has_table_privilege('authenticated', 'public.autohdr_job_files', 'UPDATE')
     or has_table_privilege('authenticated', 'public.autohdr_job_files', 'DELETE')
     or not has_table_privilege('service_role', 'public.autohdr_job_files', 'SELECT')
     or has_table_privilege('service_role', 'public.autohdr_job_files', 'INSERT')
     or has_table_privilege('service_role', 'public.autohdr_job_files', 'UPDATE')
     or has_table_privilege('service_role', 'public.autohdr_job_files', 'DELETE') then
    raise exception 'AutoHDR table grants are unsafe';
  end if;

  if exists (
    select 1 from pg_class relation
     where relation.oid in ('public.autohdr_jobs'::regclass, 'public.autohdr_job_files'::regclass)
       and (not relation.relrowsecurity or not relation.relforcerowsecurity)
  ) then
    raise exception 'AutoHDR tables are missing forced RLS';
  end if;
end;
$$;

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local role authenticated;

do $$
declare
  v_jobs bigint;
  v_has_token_column boolean;
begin
  select count(*), coalesce(bool_or(to_jsonb(job) ? 'retrieval_claim_token'), false)
    into v_jobs, v_has_token_column
    from public.list_autohdr_jobs(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102'
    ) job;
  if v_jobs <> 1 or v_has_token_column then
    raise exception 'safe admin read did not isolate the tenant or exposed the retrieval token';
  end if;
  begin
    perform 1
      from public.list_autohdr_jobs(
        '22222222-2222-4222-8222-222222222222',
        '22222222-2222-4222-8222-222222222203'
      );
    raise exception 'safe admin read crossed into another tenant';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.autohdr_jobs;
    raise exception 'authenticated browser read the token-bearing AutoHDR base table';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.autohdr_jobs (
      organization_id, booking_id, property_id, idempotency_key,
      manifest_sha256, file_count
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '11111111-1111-4111-8111-111111111101',
      'browser-write', decode(repeat('ee', 32), 'hex'), 1
    );
    raise exception 'authenticated browser wrote an AutoHDR job';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

set local role service_role;

do $$
declare
  v_job_id uuid;
begin
  select id into v_job_id
    from public.autohdr_jobs
   where organization_id = '11111111-1111-4111-8111-111111111111'
     and idempotency_key = 'autohdr-fixture-a';

  begin
    update public.autohdr_jobs
       set provider_status = 'failed', last_error_code = 'forged.evidence'
     where id = v_job_id;
    raise exception 'service role rewrote provider or error evidence directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.autohdr_job_files (
      organization_id, booking_id, property_id, job_id, position,
      source_media_version_id, source_batch_id, filename, input_sha256
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '11111111-1111-4111-8111-111111111101', v_job_id, 1,
      '51111111-1111-4111-8111-111111111101',
      '31111111-1111-4111-8111-111111111101',
      'Forged.jpg', decode(repeat('11', 32), 'hex')
    );
    raise exception 'service role appended an AutoHDR manifest file directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.autohdr_job_files where job_id = v_job_id;
    raise exception 'service role deleted AutoHDR manifest evidence directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

\if :{?commit_fixture}
commit;
\else
set local role service_role;

do $$
declare
  v_job public.autohdr_jobs;
  v_claim record;
begin
  select * into v_job
    from public.autohdr_jobs
   where organization_id = '11111111-1111-4111-8111-111111111111'
     and idempotency_key = 'autohdr-fixture-a';
  select * into v_claim
    from public.claim_autohdr_retrieval(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id
    );
  if v_claim.state <> 'retrieving' or v_claim.retrieval_claimed_at is null
     or v_claim.retrieval_claim_token is null then
    raise exception 'retrieval claim did not fence the ready job';
  end if;
  begin
    perform public.claim_autohdr_retrieval(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id
    );
    raise exception 'retrieval was claimed more than once';
  exception when check_violation then null;
  end;
  begin
    perform public.transition_autohdr_job(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
      'retrieving', 'review_pending', 'ready', null,
      '00000000-0000-4000-8000-000000000000'
    );
    raise exception 'wrong retrieval token completed the job';
  exception when check_violation then null;
  end;
  perform public.transition_autohdr_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'retrieving', 'review_pending', 'ready', null, v_claim.retrieval_claim_token
  );
end;
$$;

reset role;
rollback;
\endif
