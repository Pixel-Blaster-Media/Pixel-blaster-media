begin;

insert into public.organizations (id, name, slug) values
  ('00000000-0000-0000-0000-000000000001', 'Fixture Default', 'fixture-default')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug) values
  ('00000000-0000-0000-0000-000000000002', 'Fixture Other', 'fixture-other');

insert into public.catalog_items (
  id, organization_id, slug, name, kind, duration_minutes, price_cents, display_order
) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'video-source', 'Video Source', 'a_la_carte', 10, 1000, 0),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'video-target', 'Video Target', 'bundle', 20, 2000, 1),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'full-target', 'Full Target', 'bundle', 20, 2000, 2),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'other-target', 'Other Target', 'bundle', 20, 2000, 0);

insert into public.catalog_item_examples (
  id, organization_id, catalog_item_id, title, kind, source_type,
  stream_uid, status, active, display_order
) values (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'One physical video', 'video', 'cloudflare_stream',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ready', true, 0
);

insert into public.catalog_stream_upload_claims (
  id, organization_id, catalog_item_id, example_id, stream_uid, state
) values (
  '40000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'completed'
);

do $$
declare
  v_placement uuid;
  v_uid text;
  v_status text;
  v_rejected boolean;
  v_external uuid;
begin
  v_placement := public.attach_shared_catalog_stream_example(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    'Bundle reel', 'Same physical video, placement-specific copy'
  );
  if v_placement is null then raise exception 'shared placement was not created'; end if;

  if (select count(*) from public.catalog_item_examples where stream_uid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') <> 1 then
    raise exception 'shared placement duplicated the physical provider asset';
  end if;
  if not exists (
    select 1 from public.catalog_item_example_placements
    where id = v_placement
      and organization_id = '00000000-0000-0000-0000-000000000001'
      and catalog_item_id = '10000000-0000-0000-0000-000000000002'
      and title = 'Bundle reel'
  ) then raise exception 'shared placement metadata mismatch'; end if;
  if public.attach_shared_catalog_stream_example(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    'Retry title is ignored', null
  ) <> v_placement then raise exception 'shared placement retry was not idempotent'; end if;

  begin
    insert into public.catalog_item_examples (
      organization_id, catalog_item_id, title, kind, source_type,
      external_url, status, active, display_order
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      'Position collision', 'link', 'external_url',
      'https://example.com/collision', 'ready', true, 0
    );
    raise exception 'base/shared display position collision unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'catalog example display position is occupied' then raise; end if;
  end;

  begin
    delete from public.catalog_item_examples
    where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'direct shared-source delete unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'catalog video is still shared' then raise; end if;
  end;

  begin
    update public.catalog_item_examples
    set catalog_item_id = '10000000-0000-0000-0000-000000000002'
    where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'direct shared-source catalog move unexpectedly succeeded';
  exception when sqlstate 'P0001' then null;
  end;
  if (select catalog_item_id from public.catalog_item_examples
      where id = '30000000-0000-0000-0000-000000000001')
     <> '10000000-0000-0000-0000-000000000001' then
    raise exception 'shared-source catalog move was not blocked';
  end if;

  -- The source is still shared, so physical provider deletion must fail closed.
  v_uid := public.begin_catalog_stream_example_deletion(
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001'
  );
  if v_uid is not null then raise exception 'still shared source entered provider deletion'; end if;

  begin
    update public.catalog_item_examples set status = 'deleting'
    where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'direct shared-source mutation unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'catalog video is still shared' then raise; end if;
  end;

  -- Cross-tenant reuse must fail in the database, not only in application code.
  begin
    perform public.attach_shared_catalog_stream_example(
      '00000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      'Cross-tenant attempt', null
    );
    raise exception 'cross-tenant shared placement unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'shared catalog video source is unavailable' then raise; end if;
  end;

  if not public.remove_shared_catalog_stream_placement(
    '00000000-0000-0000-0000-000000000001', v_placement
  ) then raise exception 'shared placement unlink failed'; end if;
  if not exists (
    select 1 from public.catalog_item_examples
    where id = '30000000-0000-0000-0000-000000000001'
      and status = 'ready' and active = true
  ) then raise exception 'unlink removed or hid provider asset'; end if;

  foreach v_status in array array['uploading', 'failed', 'deleting'] loop
    update public.catalog_item_examples set status = v_status
    where id = '30000000-0000-0000-0000-000000000001';
    v_rejected := false;
    begin
      perform public.attach_shared_catalog_stream_example(
        '00000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000001',
        'Invalid status', null
      );
    exception when sqlstate 'P0001' then v_rejected := true;
    end;
    if not v_rejected then raise exception 'source status % was reusable', v_status; end if;
  end loop;
  update public.catalog_item_examples set status = 'ready', active = false
  where id = '30000000-0000-0000-0000-000000000001';
  v_rejected := false;
  begin
    perform public.attach_shared_catalog_stream_example(
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000001',
      'Inactive source', null
    );
  exception when sqlstate 'P0001' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'inactive source was reusable'; end if;

  update public.catalog_item_examples set active = true, kind = 'interactive'
  where id = '30000000-0000-0000-0000-000000000001';
  v_rejected := false;
  begin
    perform public.attach_shared_catalog_stream_example(
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000001',
      'Non-video source', null
    );
  exception when sqlstate 'P0001' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'non-video Stream source was reusable'; end if;
  update public.catalog_item_examples set kind = 'video'
  where id = '30000000-0000-0000-0000-000000000001';

  insert into public.catalog_item_examples (
    organization_id, catalog_item_id, title, kind, source_type,
    external_url, status, active, display_order
  ) values (
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'External source', 'video', 'external_url',
    'https://example.com/external', 'ready', true, 1
  ) returning id into v_external;
  v_rejected := false;
  begin
    perform public.attach_shared_catalog_stream_example(
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      v_external, 'External source', null
    );
  exception when sqlstate 'P0001' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'external source was reusable'; end if;

  v_rejected := false;
  begin
    perform public.attach_shared_catalog_stream_example(
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      'Original item duplicate', null
    );
  exception when sqlstate 'P0001' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'source was reusable on its original item'; end if;

  -- After the last placement is gone, normal provider deletion may begin.
  v_uid := public.begin_catalog_stream_example_deletion(
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001'
  );
  if v_uid <> 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' then
    raise exception 'final placement removal did not release provider deletion';
  end if;
end;
$$;

-- Rollback the deletion transition so later slot-limit behavior can reuse the fixture.
update public.catalog_stream_upload_claims set state = 'completed'
where id = '40000000-0000-0000-0000-000000000001';
update public.catalog_item_examples set status = 'ready', active = true
where id = '30000000-0000-0000-0000-000000000001';

insert into public.catalog_item_examples (
  organization_id, catalog_item_id, title, kind, source_type,
  external_url, status, active, display_order
)
select
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003',
  'Existing ' || position,
  'link', 'external_url',
  'https://example.com/' || position,
  'ready', true, position
from generate_series(0, 6) as position;

do $$
declare
  v_placement uuid;
  v_result uuid;
  v_claim text;
begin
  v_placement := public.attach_shared_catalog_stream_example(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000001',
    'Eighth example', null
  );
  if v_placement is null then raise exception 'eighth combined example was rejected'; end if;

  v_result := public.attach_external_catalog_example(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000003',
    'Ninth example', null, 'link', 'https://example.com/ninth'
  );
  if v_result is not null then raise exception 'ninth combined example was accepted'; end if;

  v_claim := public.claim_catalog_stream_upload(
    '40000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000003'
  );
  if v_claim <> 'max_examples' then raise exception 'upload claim ignored shared placement slot'; end if;
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.attach_shared_catalog_stream_example(uuid,uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'anon can attach shared catalog videos';
  end if;
  if has_function_privilege('authenticated', 'public.remove_shared_catalog_stream_placement(uuid,uuid)', 'EXECUTE') then
    raise exception 'authenticated can unlink shared catalog videos directly';
  end if;
  if not (
    select relrowsecurity and relforcerowsecurity
    from pg_class where oid = 'public.catalog_item_example_placements'::regclass
  ) then raise exception 'placement RLS is not forced'; end if;
end;
$$;

rollback;
