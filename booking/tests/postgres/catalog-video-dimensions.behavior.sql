begin;

insert into public.organizations (id, name, slug) values
  ('00000000-0000-0000-0000-000000000001', 'Portrait Fixture', 'portrait-fixture'),
  ('00000000-0000-0000-0000-000000000002', 'Other Fixture', 'portrait-other')
on conflict (id) do nothing;
insert into public.catalog_items (
  id, organization_id, slug, name, kind, duration_minutes, price_cents, display_order
) values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'portrait-video', 'Portrait Video', 'a_la_carte', 10, 1000, 0
);
insert into public.catalog_item_examples (
  id, organization_id, catalog_item_id, title, kind, source_type,
  stream_uid, status, active, display_order
) values (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Portrait source', 'video', 'cloudflare_stream',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ready', true, 0
);
insert into public.catalog_item_examples (
  id, organization_id, catalog_item_id, title, kind, source_type,
  stream_uid, status, active, display_order
) values (
  '30000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Atomic portrait upload', 'video', 'cloudflare_stream',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'uploading', true, 1
);
insert into public.catalog_stream_upload_claims (
  id, organization_id, catalog_item_id, example_id, stream_uid, state
) values (
  '40000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'attached'
);

do $$
begin
  if not public.finalize_catalog_stream_upload_with_dimensions(
    '30000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1080, 1920
  ) then raise exception 'atomic ready finalization was rejected'; end if;
  if not exists (
    select 1
    from public.catalog_item_examples e
    join public.catalog_stream_upload_claims c on c.example_id = e.id
    where e.id = '30000000-0000-0000-0000-000000000002'
      and e.status = 'ready' and e.active
      and e.video_width = 1080 and e.video_height = 1920
      and c.state = 'completed'
  ) then raise exception 'status, claim, and dimensions were not finalized atomically'; end if;
  if not public.finalize_catalog_stream_upload_with_dimensions(
    '30000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1080, 1920
  ) then raise exception 'atomic finalization retry was not idempotent'; end if;
  if public.finalize_catalog_stream_upload_with_dimensions(
    '30000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', null, 1920
  ) then raise exception 'null atomic dimensions were accepted'; end if;

  if not public.record_catalog_stream_example_dimensions(
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1080, 1920
  ) then raise exception 'valid dimensions were rejected'; end if;

  if not public.record_catalog_stream_example_dimensions(
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1080, 1920
  ) then raise exception 'dimension retry was not idempotent'; end if;

  if public.record_catalog_stream_example_dimensions(
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1920, 1080
  ) then raise exception 'conflicting dimensions replaced provider truth'; end if;

  if public.record_catalog_stream_example_dimensions(
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1080, 1920
  ) then raise exception 'cross-tenant dimensions were accepted'; end if;

  if (select row(video_width, video_height) from public.catalog_item_examples
      where id = '30000000-0000-0000-0000-000000000001')
     <> row(1080, 1920) then
    raise exception 'stored dimensions mismatch';
  end if;

  begin
    update public.catalog_item_examples
    set video_width = null, video_height = 1920
    where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'partial null dimensions passed the database constraint';
  exception when check_violation then null;
  end;

  if has_function_privilege(
    'anon',
    'public.record_catalog_stream_example_dimensions(uuid,uuid,text,integer,integer)',
    'EXECUTE'
  ) then raise exception 'anon can record dimensions'; end if;
  if has_function_privilege(
    'anon',
    'public.finalize_catalog_stream_upload_with_dimensions(uuid,uuid,text,integer,integer)',
    'EXECUTE'
  ) then raise exception 'anon can atomically finalize dimensions'; end if;
  if has_function_privilege(
    'authenticated',
    'public.record_catalog_stream_example_dimensions(uuid,uuid,text,integer,integer)',
    'EXECUTE'
  ) then raise exception 'authenticated can record dimensions'; end if;
  if not has_function_privilege(
    'service_role',
    'public.record_catalog_stream_example_dimensions(uuid,uuid,text,integer,integer)',
    'EXECUTE'
  ) then raise exception 'service role cannot record dimensions'; end if;
end;
$$;

rollback;
