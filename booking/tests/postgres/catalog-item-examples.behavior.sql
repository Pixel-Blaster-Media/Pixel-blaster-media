begin;

insert into public.organizations (id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Tenant One'),
  ('22222222-2222-4222-8222-222222222222', 'Tenant Two');
insert into public.catalog_items (id, organization_id, name) values
  ('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Reel'),
  ('20000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'iGUIDE');

set local role service_role;
insert into public.catalog_item_examples (
  id, organization_id, catalog_item_id, title, kind, source_type, external_url
) values (
  '30000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '10000000-0000-4000-8000-000000000001',
  'Reel example', 'video', 'external_url', 'https://example.com/reel'
);
insert into public.catalog_item_examples (
  id, organization_id, catalog_item_id, title, kind, source_type, stream_uid, status, display_order
) values (
  '30000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '10000000-0000-4000-8000-000000000001',
  'Uploaded reel', 'video', 'cloudflare_stream',
  '0123456789abcdef0123456789abcdef', 'uploading', 1
);

do $$ begin
  begin
    insert into public.catalog_item_examples (
      organization_id, catalog_item_id, title, kind, source_type, stream_uid, status
    ) values (
      '22222222-2222-4222-8222-222222222222',
      '20000000-0000-4000-8000-000000000001',
      'Duplicate UID', 'video', 'cloudflare_stream',
      '0123456789abcdef0123456789abcdef', 'uploading'
    );
    raise exception 'duplicate Stream UID unexpectedly accepted';
  exception when unique_violation then null;
  end;
end $$;

do $$ begin
  begin
    insert into public.catalog_stream_upload_claims (
      id, organization_id, catalog_item_id
    ) values (
      '41000000-0000-4000-8000-000000000001',
      '22222222-2222-4222-8222-222222222222',
      '10000000-0000-4000-8000-000000000001'
    );
    raise exception 'cross-tenant claim catalog reference unexpectedly accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.catalog_stream_upload_claims (
      id, organization_id, catalog_item_id, example_id
    ) values (
      '41000000-0000-4000-8000-000000000002',
      '22222222-2222-4222-8222-222222222222',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001'
    );
    raise exception 'cross-tenant claim example reference unexpectedly accepted';
  exception when foreign_key_violation then null;
  end;
end $$;

do $$ begin
  if public.claim_catalog_stream_upload(
    '40000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001'
  ) <> 'claimed' then
    raise exception 'first upload claim failed';
  end if;
  if public.claim_catalog_stream_upload(
    '40000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001'
  ) <> 'duplicate' then
    raise exception 'duplicate upload claim was not rejected';
  end if;
  if public.claim_catalog_stream_upload(
    '40000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001'
  ) <> 'claimed' then
    raise exception 'second outstanding upload claim failed';
  end if;
  if public.claim_catalog_stream_upload(
    '40000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001'
  ) <> 'too_many_pending' then
    raise exception 'outstanding upload quota was bypassed';
  end if;
  if public.claim_catalog_stream_upload(
    '40000000-0000-4000-8000-000000000004',
    '22222222-2222-4222-8222-222222222222',
    '10000000-0000-4000-8000-000000000001'
  ) <> 'catalog_not_found' then
    raise exception 'cross-tenant upload claim was not rejected';
  end if;
end $$;

savepoint invalid_url;
do $$ begin
  begin
    insert into public.catalog_item_examples (
      organization_id, catalog_item_id, title, kind, source_type, external_url, display_order
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '10000000-0000-4000-8000-000000000001',
      'Unsafe', 'link', 'external_url', 'http://example.com', 2
    );
    raise exception 'HTTP example unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
rollback to invalid_url;

savepoint tenant_mismatch;
do $$ begin
  begin
    insert into public.catalog_item_examples (
      organization_id, catalog_item_id, title, kind, source_type, external_url
    ) values (
      '22222222-2222-4222-8222-222222222222',
      '10000000-0000-4000-8000-000000000001',
      'Cross tenant', 'link', 'external_url', 'https://example.com'
    );
    raise exception 'cross-tenant example unexpectedly accepted';
  exception when foreign_key_violation then null;
  end;
end $$;
rollback to tenant_mismatch;

update public.catalog_stream_upload_claims
set stream_uid = 'fedcba9876543210fedcba9876543210',
    state = 'provisioned'
where id = '40000000-0000-4000-8000-000000000001';

do $$
declare
  v_example_id uuid;
begin
  v_example_id := public.attach_catalog_stream_upload(
    '40000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001',
    'fedcba9876543210fedcba9876543210',
    'Atomic attached upload',
    null
  );
  if v_example_id is null then
    raise exception 'atomic Stream attachment failed';
  end if;
  if not exists (
    select 1 from public.catalog_stream_upload_claims
    where id = '40000000-0000-4000-8000-000000000001'
      and example_id = v_example_id
      and state = 'attached'
  ) then
    raise exception 'atomic Stream attachment did not bind claim and example';
  end if;
  if public.attach_catalog_stream_upload(
    '40000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001',
    'fedcba9876543210fedcba9876543210',
    'Duplicate attachment',
    null
  ) is not null then
    raise exception 'atomic Stream attachment was not monotonic';
  end if;
  if not public.finalize_catalog_stream_upload(
    v_example_id,
    '11111111-1111-4111-8111-111111111111',
    'fedcba9876543210fedcba9876543210',
    'ready'
  ) then
    raise exception 'atomic Stream finalization failed';
  end if;
  if not exists (
    select 1
    from public.catalog_stream_upload_claims c
    join public.catalog_item_examples e on e.id = c.example_id
    where c.id = '40000000-0000-4000-8000-000000000001'
      and c.state = 'completed'
      and e.status = 'ready'
      and e.active
  ) then
    raise exception 'claim and example were not atomically finalized';
  end if;
  if public.begin_catalog_stream_example_deletion(
    v_example_id,
    '11111111-1111-4111-8111-111111111111'
  ) <> 'fedcba9876543210fedcba9876543210' then
    raise exception 'durable Stream deletion transition failed';
  end if;
  if not exists (
    select 1
    from public.catalog_stream_upload_claims c
    join public.catalog_item_examples e on e.id = c.example_id
    where c.id = '40000000-0000-4000-8000-000000000001'
      and c.state = 'cleanup_required'
      and e.status = 'deleting'
      and not e.active
  ) then
    raise exception 'deletion intent was not committed atomically';
  end if;
end $$;

reset role;

do $$ begin
  if has_table_privilege('anon', 'public.catalog_item_examples', 'select') then
    raise exception 'anon can read examples directly';
  end if;
  if has_table_privilege('authenticated', 'public.catalog_item_examples', 'insert') then
    raise exception 'authenticated can insert examples directly';
  end if;
  if not has_table_privilege('service_role', 'public.catalog_item_examples', 'select,insert,update,delete') then
    raise exception 'service role lacks example management privileges';
  end if;
  if has_table_privilege('authenticated', 'public.catalog_stream_upload_claims', 'select') then
    raise exception 'authenticated can read Stream upload claims';
  end if;
  if not has_function_privilege('service_role', 'public.claim_catalog_stream_upload(uuid,uuid,uuid)', 'execute') then
    raise exception 'service role cannot claim Stream uploads';
  end if;
  if not has_function_privilege('service_role', 'public.attach_catalog_stream_upload(uuid,uuid,uuid,text,text,text)', 'execute') then
    raise exception 'service role cannot atomically attach Stream uploads';
  end if;
  if has_function_privilege('authenticated', 'public.attach_catalog_stream_upload(uuid,uuid,uuid,text,text,text)', 'execute') then
    raise exception 'authenticated can attach Stream uploads';
  end if;
  if not has_function_privilege('service_role', 'public.finalize_catalog_stream_upload(uuid,uuid,text,text)', 'execute') then
    raise exception 'service role cannot atomically finalize Stream uploads';
  end if;
  if has_function_privilege('authenticated', 'public.finalize_catalog_stream_upload(uuid,uuid,text,text)', 'execute') then
    raise exception 'authenticated can finalize Stream uploads';
  end if;
  if not has_function_privilege('service_role', 'public.begin_catalog_stream_example_deletion(uuid,uuid)', 'execute') then
    raise exception 'service role cannot begin durable Stream deletion';
  end if;
  if has_function_privilege('authenticated', 'public.begin_catalog_stream_example_deletion(uuid,uuid)', 'execute') then
    raise exception 'authenticated can begin Stream deletion';
  end if;
end $$;

do $$ begin
  begin
    delete from public.catalog_items
    where id = '10000000-0000-4000-8000-000000000001';
    raise exception 'catalog item with examples unexpectedly deleted';
  exception when foreign_key_violation then null;
  end;
end $$;

set local role service_role;
delete from public.catalog_item_examples
where catalog_item_id = '10000000-0000-4000-8000-000000000001';
reset role;
delete from public.catalog_items
where id = '10000000-0000-4000-8000-000000000001';

rollback;
