begin;

insert into public.organizations (id, name, slug, invoice_timing) values
  ('33333333-3333-4333-8333-333333333333', 'Aerial Tenant', 'aerial-tenant', 'on_delivery');
insert into public.profiles (id, organization_id, role, email) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '33333333-3333-4333-8333-333333333333', 'realtor', 'aerial@example.com');
insert into public.organization_members (organization_id, profile_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'member');

insert into public.catalog_items (
  id, organization_id, slug, name, kind, active, is_photo, is_video,
  is_iguide, is_aerial, require_has_video, require_has_media,
  exclude_has_aerial, duration_minutes, price_cents
) values
  ('30000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'photos', 'Photos', 'a_la_carte', true, true, false, false, false, false, false, false, 60, 20000),
  ('30000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'iguide', 'iGUIDE', 'a_la_carte', true, false, false, true, false, false, false, false, 60, 20000),
  ('30000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'aerial', 'Aerial', 'a_la_carte', true, false, false, false, true, false, false, false, 60, 20000),
  ('30000000-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'no_media', 'No Media', 'a_la_carte', true, false, false, false, false, false, false, false, 60, 10000),
  ('30000000-0000-4000-8000-000000000005', '33333333-3333-4333-8333-333333333333', 'aerial_add_on', 'Aerial Add-on', 'addon', true, false, false, false, true, false, true, true, 30, 10000);

set local role service_role;

do $$
declare
  result jsonb;
  replay jsonb;
  base_slot timestamptz := pg_catalog.date_trunc('second', pg_catalog.now()) + interval '180 days';
  thrown_state text;
begin
  begin
    perform public.create_public_booking_with_jobs(
      '93000000-0000-4000-8000-000000000001',
      '33333333-3333-4333-8333-333333333333',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      '1 No Media Street', 'Toronto', 'M1M 1M1', '',
      base_slot, 1000, 'vacant', false, '',
      array['30000000-0000-4000-8000-000000000004']::uuid[],
      array['30000000-0000-4000-8000-000000000005']::uuid[]
    );
    raise exception 'no-media aerial add-on unexpectedly succeeded';
  exception when sqlstate 'PB002' then null;
  end;
  if exists (select 1 from public.properties where street_address = '1 No Media Street') then
    raise exception 'ineligible no-media request left a property behind';
  end if;

  begin
    perform public.create_public_booking_with_jobs(
      '93000000-0000-4000-8000-000000000002',
      '33333333-3333-4333-8333-333333333333',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      '2 Existing Aerial Street', 'Toronto', 'M1M 1M1', '',
      base_slot + interval '2 days', 1000, 'vacant', false, '',
      array['30000000-0000-4000-8000-000000000003']::uuid[],
      array['30000000-0000-4000-8000-000000000005']::uuid[]
    );
    raise exception 'duplicate aerial coverage unexpectedly succeeded';
  exception when sqlstate 'PB002' then null;
  end;
  if exists (select 1 from public.properties where street_address = '2 Existing Aerial Street') then
    raise exception 'duplicate-aerial request left a property behind';
  end if;

  result := public.create_public_booking_with_jobs(
    '93000000-0000-4000-8000-000000000003',
    '33333333-3333-4333-8333-333333333333',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '3 Eligible Photo Street', 'Toronto', 'M1M 1M1', '',
    base_slot + interval '4 days', 1000, 'vacant', false, '',
    array['30000000-0000-4000-8000-000000000001']::uuid[],
    array['30000000-0000-4000-8000-000000000005']::uuid[]
  );
  if (result->>'replayed')::boolean then
    raise exception 'eligible photo booking unexpectedly replayed';
  end if;

  update public.catalog_items
  set active = false
  where id in (
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005'
  );
  replay := public.create_public_booking_with_jobs(
    '93000000-0000-4000-8000-000000000003',
    '33333333-3333-4333-8333-333333333333',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '3 Eligible Photo Street', 'Toronto', 'M1M 1M1', '',
    base_slot + interval '4 days', 1000, 'vacant', false, '',
    array['30000000-0000-4000-8000-000000000001']::uuid[],
    array['30000000-0000-4000-8000-000000000005']::uuid[]
  );
  if not (replay->>'replayed')::boolean then
    raise exception 'committed request did not replay after catalog deactivation';
  end if;
end;
$$;

reset role;

do $$
begin
  if pg_catalog.has_function_privilege('anon', 'public.create_public_booking_with_jobs(uuid,uuid,uuid,text,text,text,text,timestamptz,integer,text,boolean,text,uuid[],uuid[],text,text)', 'EXECUTE') then
    raise exception 'anon can execute wrapped booking function';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.create_public_booking_with_jobs_catalog_v1(uuid,uuid,uuid,text,text,text,text,timestamptz,integer,text,boolean,text,uuid[],uuid[],text,text)', 'EXECUTE') then
    raise exception 'authenticated can execute renamed booking implementation';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.create_public_booking_with_jobs(uuid,uuid,uuid,text,text,text,text,timestamptz,integer,text,boolean,text,uuid[],uuid[],text,text)', 'EXECUTE') then
    raise exception 'service_role cannot execute wrapped booking function';
  end if;
end;
$$;

rollback;
