begin;

do $$
declare
  seeded public.catalog_items%rowtype;
begin
  select * into strict seeded
  from public.catalog_items
  where organization_id = '00000000-0000-0000-0000-000000000001'
    and slug = 'site_plan';

  if seeded.name <> 'Site Plan'
     or seeded.kind <> 'addon'
     or seeded.price_cents <> 10000
     or seeded.duration_minutes <> 20
     or seeded.require_has_iguide is distinct from true
     or seeded.active is distinct from true then
    raise exception 'Site Plan seed does not match the required catalog contract';
  end if;
end;
$$;

insert into public.organizations (id, name, slug, invoice_timing) values
  ('44444444-4444-4444-8444-444444444444', 'Site Plan Tenant', 'site-plan-tenant', 'on_delivery');
insert into public.profiles (id, organization_id, role, email) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '44444444-4444-4444-8444-444444444444', 'realtor', 'site-plan@example.com');
insert into public.organization_members (organization_id, profile_id, role) values
  ('44444444-4444-4444-8444-444444444444', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'member');

insert into public.catalog_items (
  id, organization_id, slug, name, kind, active, is_photo, is_video,
  is_iguide, is_aerial, require_has_video, require_has_media,
  require_has_iguide, exclude_has_aerial, duration_minutes, price_cents
) values
  ('40000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'photos', 'Photos', 'a_la_carte', true, true, false, false, false, false, false, false, false, 60, 20000),
  ('40000000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'video', 'Video', 'a_la_carte', true, false, true, false, false, false, false, false, false, 60, 20000),
  ('40000000-0000-4000-8000-000000000003', '44444444-4444-4444-8444-444444444444', 'iguide', 'iGUIDE', 'a_la_carte', true, false, false, true, false, false, false, false, false, 60, 20000),
  ('40000000-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444', 'site_plan', 'Site Plan', 'addon', true, false, false, false, false, false, false, true, false, 20, 10000);

set local role service_role;

do $$
declare
  result jsonb;
  v_booking_id uuid;
  base_slot timestamptz := pg_catalog.date_trunc('second', pg_catalog.now()) + interval '200 days';
begin
  begin
    perform public.create_public_booking_with_jobs(
      '94000000-0000-4000-8000-000000000001',
      '44444444-4444-4444-8444-444444444444',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      '1 Photo Only Street', 'Toronto', 'M1M 1M1', '',
      base_slot, 1000, 'vacant', false, '',
      array['40000000-0000-4000-8000-000000000001']::uuid[],
      array['40000000-0000-4000-8000-000000000004']::uuid[]
    );
    raise exception 'photo-only Site Plan request unexpectedly succeeded';
  exception when sqlstate 'PB002' then null;
  end;
  if exists (select 1 from public.properties where street_address = '1 Photo Only Street') then
    raise exception 'photo-only Site Plan request left database residue';
  end if;

  begin
    perform public.create_public_booking_with_jobs(
      '94000000-0000-4000-8000-000000000002',
      '44444444-4444-4444-8444-444444444444',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      '2 Video Only Street', 'Toronto', 'M1M 1M1', '',
      base_slot + interval '2 days', 1000, 'vacant', false, '',
      array['40000000-0000-4000-8000-000000000002']::uuid[],
      array['40000000-0000-4000-8000-000000000004']::uuid[]
    );
    raise exception 'video-only Site Plan request unexpectedly succeeded';
  exception when sqlstate 'PB002' then null;
  end;
  if exists (select 1 from public.properties where street_address = '2 Video Only Street') then
    raise exception 'video-only Site Plan request left database residue';
  end if;

  result := public.create_public_booking_with_jobs(
    '94000000-0000-4000-8000-000000000003',
    '44444444-4444-4444-8444-444444444444',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '3 iGUIDE Street', 'Toronto', 'M1M 1M1', '',
    base_slot + interval '4 days', 1000, 'vacant', false, '',
    array['40000000-0000-4000-8000-000000000003']::uuid[],
    array['40000000-0000-4000-8000-000000000004']::uuid[]
  );
  v_booking_id := (result->>'booking_id')::uuid;

  if (result->>'replayed')::boolean then
    raise exception 'eligible iGUIDE Site Plan request unexpectedly replayed';
  end if;
  if (select scheduled_ends_at from public.bookings where id = v_booking_id)
      <> base_slot + interval '4 days 80 minutes' then
    raise exception 'Site Plan did not add exactly 20 minutes';
  end if;
  if not exists (
    select 1 from public.booking_line_items line
    where line.booking_id = v_booking_id
      and line.catalog_item_id = '40000000-0000-4000-8000-000000000004'
      and line.item_slug = 'site_plan'
      and line.unit_price_cents = 10000
      and line.unit_duration_minutes = 20
  ) then
    raise exception 'Site Plan immutable line snapshot is incorrect';
  end if;
end;
$$;

reset role;

rollback;
