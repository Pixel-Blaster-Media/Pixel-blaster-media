\set ON_ERROR_STOP on

begin;

insert into public.organizations (id, name, slug) values
  ('11111111-1111-4111-8111-111111111111', 'Source Tenant A', 'source-tenant-a'),
  ('22222222-2222-4222-8222-222222222222', 'Source Tenant B', 'source-tenant-b');
insert into public.profiles (id, organization_id, role, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'admin', 'source-admin-a@example.com'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111', 'realtor', 'source-realtor-a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'admin', 'source-admin-b@example.com');
insert into public.organization_members (organization_id, profile_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'admin'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'member'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'admin');
insert into public.properties (id, organization_id, owner_id, street_address) values
  ('11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '1 Source Street'),
  ('22222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '2 Source Street');
insert into public.bookings (id, organization_id, property_id, owner_id, status) values
  ('11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'confirmed'),
  ('22222222-2222-4222-8222-222222222203', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222202', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'confirmed');
insert into public.integration_credentials (organization_id, provider, credentials, updated_by) values
  (
    '11111111-1111-4111-8111-111111111111', 'autohdr',
    '{"api_key":"tenant-a-key","enabled":"true"}'::jsonb,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  (
    '22222222-2222-4222-8222-222222222222', 'autohdr',
    '{"api_key":"tenant-b-key","enabled":"false"}'::jsonb,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  );

set local role service_role;

do $test$
declare
  v_files constant jsonb := $json$[
    {"filename":"Kitchen 01.JPG","byte_size":4096,"mime_type":"image/jpeg","sha256":"1111111111111111111111111111111111111111111111111111111111111111"},
    {"filename":"Exterior.png","byte_size":8192,"mime_type":"image/png","sha256":"2222222222222222222222222222222222222222222222222222222222222222"}
  ]$json$::jsonb;
  v_raw record;
begin
  begin
    perform public.create_autohdr_source_batch(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111102',
      '00000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', v_files
    );
    raise exception 'wrong tenant was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    perform public.create_autohdr_source_batch(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222203',
      '00000000-0000-4000-8000-000000000002',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', v_files
    );
    raise exception 'wrong booking was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    perform public.create_autohdr_source_batch(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '00000000-0000-4000-8000-000000000003',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', v_files
    );
    raise exception 'non-admin profile was accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.create_autohdr_source_batch(
      '22222222-2222-4222-8222-222222222222',
      '22222222-2222-4222-8222-222222222203',
      '00000000-0000-4000-8000-000000000004',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', v_files
    );
    raise exception 'disabled tenant AutoHDR credential was accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.create_autohdr_source_batch(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '00000000-0000-4000-8000-000000000005',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '[{"filename":"bad.jpg","byte_size":10,"mime_type":"image/png","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb
    );
    raise exception 'filename and MIME mismatch was accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.create_autohdr_source_batch(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '00000000-0000-4000-8000-000000000006',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '[{"filename":"bad.jpg","byte_size":10,"mime_type":"image/jpeg","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","width_px":10,"height_px":10}]'::jsonb
    );
    raise exception 'browser-supplied dimensions were accepted';
  exception when invalid_parameter_value then null;
  end;

  for v_raw in
    select * from (values
      ('bad.dng', 'image/jpeg'), ('bad.cr2', 'image/jpeg'),
      ('bad.cr3', 'image/jpeg'), ('bad.nef', 'image/jpeg'),
      ('bad.arw', 'image/jpeg'), ('bad.raf', 'image/jpeg'),
      ('bad.rw2', 'image/jpeg'), ('bad.orf', 'image/jpeg'),
      ('bad.pef', 'image/jpeg'), ('bad.raw', 'image/jpeg'),
      ('bad.jpg', 'image/x-adobe-dng'), ('bad.jpg', 'image/x-canon-cr2'),
      ('bad.jpg', 'image/x-canon-cr3'), ('bad.jpg', 'image/x-nikon-nef'),
      ('bad.jpg', 'image/x-sony-arw'), ('bad.jpg', 'image/x-fuji-raf'),
      ('bad.jpg', 'image/x-panasonic-rw2'), ('bad.jpg', 'image/x-olympus-orf'),
      ('bad.jpg', 'image/x-pentax-pef'), ('bad.jpg', 'image/x-raw')
    ) rejected(filename, mime_type)
  loop
    begin
      perform public.create_autohdr_source_batch(
        '11111111-1111-4111-8111-111111111111',
        '11111111-1111-4111-8111-111111111102',
        '00000000-0000-4000-8000-000000000008',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'filename', v_raw.filename,
          'byte_size', 10,
          'mime_type', v_raw.mime_type,
          'sha256', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        ))
      );
      raise exception 'RAW extension/MIME was accepted: % %', v_raw.filename, v_raw.mime_type;
    exception when invalid_parameter_value then null;
    end;
  end loop;

  -- Both accepted JPEG spellings and PNG are part of the narrow source contract.
  perform public.create_autohdr_source_batch(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '00000000-0000-4000-8000-000000000007',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '[{"filename":"accepted.jpeg","byte_size":10,"mime_type":"image/jpeg","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]'::jsonb
  );
end;
$test$;

create temporary table source_rows on commit drop as
select *
from public.create_autohdr_source_batch(
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111102',
  '00000000-0000-4000-8000-000000000010',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  $json$[
    {"filename":"Kitchen 01.JPG","byte_size":4096,"mime_type":"image/jpeg","sha256":"1111111111111111111111111111111111111111111111111111111111111111"},
    {"filename":"Exterior.png","byte_size":8192,"mime_type":"image/png","sha256":"2222222222222222222222222222222222222222222222222222222222222222"}
  ]$json$::jsonb
);

do $test$
declare
  v_replay jsonb;
  v_original jsonb;
begin
  if (select count(*) from source_rows) <> 2
     or (select count(distinct batch_id) from source_rows) <> 1
     or exists (select 1 from source_rows where bucket_name <> 'pixel-blaster-private-media')
     or exists (select 1 from source_rows where not newly_created) then
    raise exception 'source creation did not return one canonical row per ordered file';
  end if;

  if exists (
    select 1 from source_rows
    where object_key <> 'masters/11111111-1111-4111-8111-111111111111/' ||
      asset_id::text || '/' || version_id::text || '/' ||
      encode(sha256, 'hex') || case mime_type when 'image/jpeg' then '.jpg' else '.png' end
      or object_key like '%/sha256/%'
      or object_key like '%11111111-1111-4111-8111-111111111102%'
      or object_key like '%' || filename || '%'
  ) then
    raise exception 'source master keys do not match buildMasterKey grammar';
  end if;

  select jsonb_agg(to_jsonb(replay) order by replay.position) into v_replay
  from public.create_autohdr_source_batch(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '00000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    $json$[
      {"filename":"Kitchen 01.JPG","byte_size":4096,"mime_type":"image/jpeg","sha256":"1111111111111111111111111111111111111111111111111111111111111111"},
      {"filename":"Exterior.png","byte_size":8192,"mime_type":"image/png","sha256":"2222222222222222222222222222222222222222222222222222222222222222"}
    ]$json$::jsonb
  ) replay;
  select jsonb_agg(to_jsonb(original_row) || '{"newly_created":false}'::jsonb order by original_row.position) into v_original
  from source_rows original_row;
  if v_replay is distinct from v_original then
    raise exception 'duplicate replay did not preserve identities with a false newly_created marker';
  end if;

  begin
    perform public.create_autohdr_source_batch(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '00000000-0000-4000-8000-000000000010',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '[{"filename":"conflict.jpg","byte_size":4096,"mime_type":"image/jpeg","sha256":"1111111111111111111111111111111111111111111111111111111111111111"}]'::jsonb
    );
    raise exception 'conflicting idempotent replay was accepted';
  exception when invalid_parameter_value then null;
  end;

  if exists (
    select 1
    from source_rows result
    join public.media_versions version on version.id = result.version_id
    join public.media_ingest_jobs job on job.id = result.ingest_job_id
    where version.ingest_state <> 'discovered'
       or job.state <> 'discovered'
       or version.bucket_name <> result.bucket_name
       or version.object_key <> result.object_key
       or version.sha256 <> result.sha256
       or version.byte_size <> result.byte_size
       or version.mime_type <> result.mime_type
       or version.width_px is not null
       or version.height_px is not null
  ) then
    raise exception 'new canonical source rows were not discovered with exact upload identity';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.media_versions'::pg_catalog.regclass
      and attname = 'dimension_policy'
      and not attisdropped
  ) then
    raise exception 'source migration added forbidden dimension_policy column';
  end if;
end;
$test$;

do $test$
declare
  v_jpeg source_rows%rowtype;
  v_png source_rows%rowtype;
begin
  select * into strict v_jpeg from source_rows where position = 0;
  select * into strict v_png from source_rows where position = 1;

  begin
    perform public.accept_autohdr_source_version(
      '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
      v_jpeg.batch_id, v_png.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
      v_jpeg.bucket_name, v_jpeg.object_key, v_jpeg.sha256, v_jpeg.byte_size, v_jpeg.mime_type,
      3000, 2000
    );
    raise exception 'mismatched canonical identity was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    perform public.accept_autohdr_source_version(
      '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
      v_jpeg.batch_id, v_jpeg.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
      'wrong-bucket', v_jpeg.object_key, v_jpeg.sha256, v_jpeg.byte_size, v_jpeg.mime_type,
      3000, 2000
    );
    raise exception 'wrong HEAD bucket was accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.accept_autohdr_source_version(
      '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
      v_jpeg.batch_id, v_jpeg.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
      v_jpeg.bucket_name, v_jpeg.object_key, v_jpeg.sha256, v_jpeg.byte_size, v_jpeg.mime_type,
      null, 2000
    );
    raise exception 'missing decoded dimensions were accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.accept_autohdr_source_version(
      '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
      v_jpeg.batch_id, v_jpeg.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
      v_jpeg.bucket_name, v_jpeg.object_key || '.wrong', v_jpeg.sha256, v_jpeg.byte_size, v_jpeg.mime_type,
      3000, 2000
    );
    raise exception 'wrong HEAD key was accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.accept_autohdr_source_version(
      '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
      v_jpeg.batch_id, v_jpeg.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
      v_jpeg.bucket_name, v_jpeg.object_key, decode(repeat('ff', 32), 'hex'), v_jpeg.byte_size, v_jpeg.mime_type,
      3000, 2000
    );
    raise exception 'wrong HEAD hash was accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.accept_autohdr_source_version(
      '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
      v_jpeg.batch_id, v_jpeg.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
      v_jpeg.bucket_name, v_jpeg.object_key, v_jpeg.sha256, v_jpeg.byte_size + 1, v_jpeg.mime_type,
      3000, 2000
    );
    raise exception 'wrong HEAD byte size was accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.accept_autohdr_source_version(
      '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
      v_jpeg.batch_id, v_jpeg.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
      v_jpeg.bucket_name, v_jpeg.object_key, v_jpeg.sha256, v_jpeg.byte_size, 'image/png',
      3000, 2000
    );
    raise exception 'wrong HEAD MIME was accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    update public.media_versions set ingest_state = 'url_ready' where id = v_png.version_id;
    raise exception 'direct source version mutation bypassed the RPC';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.accept_autohdr_source_version(
      '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
      v_jpeg.batch_id, v_jpeg.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
      v_jpeg.bucket_name, v_jpeg.object_key, v_jpeg.sha256, v_jpeg.byte_size, v_jpeg.mime_type,
      0, 2000
    );
    raise exception 'non-positive decoded dimensions were accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.accept_autohdr_source_version(
      '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
      v_jpeg.batch_id, v_jpeg.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
      v_jpeg.bucket_name, v_jpeg.object_key, v_jpeg.sha256, v_jpeg.byte_size, v_jpeg.mime_type,
      100001, 2000
    );
    raise exception 'out-of-bounds decoded dimensions were accepted';
  exception when invalid_parameter_value then null;
  end;

  perform public.accept_autohdr_source_version(
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
    v_jpeg.batch_id, v_jpeg.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
    v_jpeg.bucket_name, v_jpeg.object_key, v_jpeg.sha256, v_jpeg.byte_size, v_jpeg.mime_type,
    3000, 2000
  );
  perform public.accept_autohdr_source_version(
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
    v_png.batch_id, v_png.asset_id, v_png.version_id, v_png.ingest_job_id,
    v_png.bucket_name, v_png.object_key, v_png.sha256, v_png.byte_size, v_png.mime_type,
    4000, 3000
  );

  -- Exact acceptance replay is harmless and returns the same accepted identity.
  perform public.accept_autohdr_source_version(
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
    v_jpeg.batch_id, v_jpeg.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
    v_jpeg.bucket_name, v_jpeg.object_key, v_jpeg.sha256, v_jpeg.byte_size, v_jpeg.mime_type,
    3000, 2000
  );

  begin
    perform public.accept_autohdr_source_version(
      '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111102',
      v_jpeg.batch_id, v_jpeg.asset_id, v_jpeg.version_id, v_jpeg.ingest_job_id,
      v_jpeg.bucket_name, v_jpeg.object_key, v_jpeg.sha256, v_jpeg.byte_size, v_jpeg.mime_type,
      3001, 2000
    );
    raise exception 'acceptance replay changed verified dimensions';
  exception when invalid_parameter_value then null;
  end;

  if exists (
    select 1
    from source_rows result
    join public.media_versions version on version.id = result.version_id
    join public.media_ingest_jobs job on job.id = result.ingest_job_id
    where version.ingest_state <> 'accepted'
       or version.accepted_at is null
       or version.width_px is null
       or version.height_px is null
       or job.state <> 'accepted'
       or job.completed_at is null
  ) then
    raise exception 'source acceptance did not atomically accept version and complete ingest job';
  end if;

  if (select (width_px, height_px) <> (3000, 2000) from public.media_versions where id = v_jpeg.version_id)
     or (select (width_px, height_px) <> (4000, 3000) from public.media_versions where id = v_png.version_id) then
    raise exception 'acceptance did not atomically persist server-verified dimensions';
  end if;
end;
$test$;

do $test$
declare
  v_batch_id uuid;
begin
  select batch_id into strict v_batch_id from source_rows limit 1;
  begin
    insert into public.media_batches (
      organization_id, property_id, booking_id, source_provider,
      provider_connection_key, provider_job_id, created_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111101',
      '11111111-1111-4111-8111-111111111102',
      'autohdr_source_upload', 'autohdr:11111111-1111-4111-8111-111111111111',
      '00000000-0000-4000-8000-000000000099',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    );
    raise exception 'direct source batch mutation bypassed the RPC';
  exception when insufficient_privilege then null;
  end;

  perform public.claim_autohdr_job(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101',
    'accepted-source-proof', decode(repeat('aa', 32), 'hex'),
    (
      select jsonb_agg(jsonb_build_object(
        'position', position,
        'source_media_version_id', version_id,
        'filename', filename
      ) order by position)
      from source_rows
    )
  );
  if (select count(*) from public.autohdr_job_files where filename in ('Kitchen 01.JPG', 'Exterior.png')) <> 2 then
    raise exception 'final AutoHDR claim did not consume accepted canonical source hashes';
  end if;
end;
$test$;

reset role;

do $test$
begin
  if has_function_privilege(
       'anon',
       'public.create_autohdr_source_batch(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.create_autohdr_source_batch(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.create_autohdr_source_batch(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.accept_autohdr_source_version(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bytea,bigint,text,integer,integer)', 'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.accept_autohdr_source_version(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bytea,bigint,text,integer,integer)', 'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.accept_autohdr_source_version(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bytea,bigint,text,integer,integer)', 'EXECUTE'
     ) then
    raise exception 'source upload RPC grants are unsafe for browser roles';
  end if;

  if has_table_privilege('anon', 'public.media_batches', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.media_batches', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.media_assets', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.media_assets', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.media_versions', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.media_versions', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.media_ingest_jobs', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.media_ingest_jobs', 'INSERT,UPDATE,DELETE') then
    raise exception 'browser roles can mutate canonical source tables directly';
  end if;

  begin
    execute 'set local role authenticated';
    perform public.create_autohdr_source_batch(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111102',
      '00000000-0000-4000-8000-000000000098',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '[]'::jsonb
    );
    raise exception 'authenticated browser executed source create RPC';
  exception when insufficient_privilege then
    execute 'reset role';
  end;
end;
$test$;

\if :{?commit_fixture}
commit;
\else
rollback;
\endif
