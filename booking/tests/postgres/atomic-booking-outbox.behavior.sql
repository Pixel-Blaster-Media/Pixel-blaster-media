begin;

insert into public.organizations (id, name, invoice_timing) values
  ('11111111-1111-4111-8111-111111111111', 'Tenant One', 'at_booking'),
  ('22222222-2222-4222-8222-222222222222', 'Tenant Two', 'on_delivery');
insert into public.profiles (id, organization_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'realtor'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'realtor'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', 'admin');
insert into public.organization_members (organization_id, profile_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'member'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'member'),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin');
insert into public.catalog_items (
  id, organization_id, slug, name, kind, active, is_video,
  require_has_video, duration_minutes, price_cents,
  sqft_pricing_enabled, included_sqft, overage_increment_sqft, overage_price_cents
) values
  ('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'photos', 'Photos', 'a_la_carte', true, false, false, 90, 20000, true, 2000, 500, 5000),
  ('10000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'video', 'Video', 'a_la_carte', true, true, false, 120, 30000, false, null, null, null),
  ('10000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'reel', 'Reel', 'addon', true, false, true, 30, 5000, false, null, null, null),
  ('20000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'other', 'Other', 'a_la_carte', true, false, false, 60, 10000, false, null, null, null);

update public.catalog_items
set is_photo = true
where id = '10000000-0000-4000-8000-000000000001';

insert into public.catalog_items (
  id, organization_id, slug, name, kind, active, is_aerial,
  require_has_media, exclude_has_aerial, duration_minutes, price_cents
) values
  ('10000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'aerial_package', 'Aerial Package', 'a_la_carte', true, true, false, false, 60, 20000),
  ('10000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'aerial_add_on', 'Aerial Add-on', 'addon', true, true, true, true, 30, 10000),
  ('10000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'measure_only', 'Measure Only', 'a_la_carte', true, false, false, false, 30, 5000);

set local role service_role;

do $$
declare
  eligible_result jsonb;
begin
  eligible_result := public.create_public_booking_with_jobs(
    '90000000-0000-4000-8000-000000000021',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '21 Aerial Street', 'Toronto', 'M2M 2M2', '',
    pg_catalog.now() + interval '121 days', 1800, 'vacant', true, '',
    array['10000000-0000-4000-8000-000000000001']::uuid[],
    array['10000000-0000-4000-8000-000000000005']::uuid[]
  );
  if eligible_result->>'booking_id' is null then
    raise exception 'eligible aerial add-on booking was not created';
  end if;

  begin
    perform public.create_public_booking_with_jobs(
      '90000000-0000-4000-8000-000000000022',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '22 Aerial Street', 'Toronto', 'M2M 2M2', '',
      pg_catalog.now() + interval '122 days', 1800, 'vacant', true, '',
      array['10000000-0000-4000-8000-000000000006']::uuid[],
      array['10000000-0000-4000-8000-000000000005']::uuid[]
    );
    raise exception 'aerial add-on without media was accepted';
  exception when sqlstate 'PB002' then null;
  end;

  begin
    perform public.create_public_booking_with_jobs(
      '90000000-0000-4000-8000-000000000023',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '23 Aerial Street', 'Toronto', 'M2M 2M2', '',
      pg_catalog.now() + interval '123 days', 1800, 'vacant', true, '',
      array['10000000-0000-4000-8000-000000000004']::uuid[],
      array['10000000-0000-4000-8000-000000000005']::uuid[]
    );
    raise exception 'duplicate aerial coverage was accepted';
  exception when sqlstate 'PB002' then null;
  end;
end;
$$;

do $$
declare
  first_result jsonb;
  replay_result jsonb;
  claim_result jsonb;
  invoice_dependency_claim jsonb;
  stale_claim jsonb;
  unsafe_claim jsonb;
  final_claim jsonb;
  compat_line_id uuid;
  invalid_property_id uuid;
  invalid_booking_id uuid;
  valid_manual_payload jsonb;
  invalid_semantic_payload jsonb;
  invalid_semantic_index integer := 0;
  v_booking_id uuid;
  base_slot timestamptz := pg_catalog.date_trunc('second', pg_catalog.now()) + interval '90 days';
  thrown_state text;
begin
  first_result := public.create_public_booking_with_jobs(
    '90000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10 Atomic Street', 'Toronto', 'M1M 1M1', '',
    base_slot, 2500, 'vacant', true, 'Fixture',
    array['10000000-0000-4000-8000-000000000002']::uuid[],
    array['10000000-0000-4000-8000-000000000003']::uuid[]
  );
  v_booking_id := (first_result->>'booking_id')::uuid;

  if (first_result->>'replayed')::boolean then
    raise exception 'happy path unexpectedly replayed';
  end if;
  if (select count(*) from public.properties where street_address = '10 Atomic Street') <> 1 then
    raise exception 'happy path property count mismatch';
  end if;
  if (select count(*) from public.bookings where id = v_booking_id) <> 1 then
    raise exception 'happy path booking missing';
  end if;
  if (select count(*) from public.booking_line_items line where line.booking_id = v_booking_id) <> 2 then
    raise exception 'line snapshot count mismatch';
  end if;
  if exists (
    select 1 from public.booking_line_items line
    where line.booking_id = v_booking_id
      and (line.item_name is null or line.item_slug is null or line.item_kind is null)
  ) then raise exception 'immutable line identity snapshot missing'; end if;

  insert into public.booking_line_items (
    booking_id, catalog_item_id, quantity, unit_price_cents, unit_duration_minutes
  ) values (
    v_booking_id, '10000000-0000-4000-8000-000000000001', 1, 20000, 90
  ) returning id into compat_line_id;
  if (select item_name from public.booking_line_items where id = compat_line_id) <> 'Photos' then
    raise exception 'legacy insert compatibility trigger did not snapshot identity';
  end if;
  update public.booking_line_items
    set item_name = 'Tampered', unit_price_cents = 1, unit_duration_minutes = 1
    where id = compat_line_id;
  if (select item_name from public.booking_line_items where id = compat_line_id) <> 'Photos'
     or (select unit_price_cents from public.booking_line_items where id = compat_line_id) <> 20000
     or (select unit_duration_minutes from public.booking_line_items where id = compat_line_id) <> 90 then
    raise exception 'line snapshot was mutable';
  end if;
  begin
    update public.booking_line_items
      set catalog_item_id = '10000000-0000-4000-8000-000000000003'
      where id = compat_line_id;
    raise exception 'catalog identity update should fail';
  exception when sqlstate '23514' then null;
  end;
  delete from public.booking_line_items where id = compat_line_id;

  if (select scheduled_ends_at from public.bookings b where b.id = v_booking_id)
      <> base_slot + interval '150 minutes' then
    raise exception 'database-derived schedule mismatch';
  end if;
  if (select unit_price_cents from public.booking_line_items line where line.booking_id = v_booking_id and line.catalog_item_id = '10000000-0000-4000-8000-000000000003') <> 5000 then
    raise exception 'add-on snapshot price mismatch';
  end if;
  if (select count(*) from public.integration_jobs job where job.booking_id = v_booking_id) <> 5 then
    raise exception 'outbox count mismatch';
  end if;
  if exists (
    select 1 from public.integration_jobs job
    where job.booking_id = v_booking_id
      and (
        job.payload->>'booking_id' <> v_booking_id::text
        or jsonb_array_length(job.payload->'line_items') <> 2
        or job.payload#>>'{realtor,email}' is null
        or job.payload#>>'{property,street_address}' <> '10 Atomic Street'
      )
  ) then raise exception 'durable provider payload is incomplete'; end if;
  begin
    update public.integration_jobs
      set payload = payload || '{"tampered":true}'::jsonb
      where booking_id = v_booking_id;
    raise exception 'integration payload update should fail';
  exception when sqlstate '23514' then null;
  end;

  insert into public.properties (
    organization_id, owner_id, street_address, city, postal_code
  ) values (
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Invalid Payload Street', 'Toronto', 'M9M 9M9'
  ) returning id into invalid_property_id;
  insert into public.bookings (
    organization_id, property_id, owner_id, status, scheduled_at,
    scheduled_ends_at, allow_schedule_overlap
  ) values (
    '11111111-1111-4111-8111-111111111111', invalid_property_id,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'confirmed',
    base_slot + interval '10 days', base_slot + interval '10 days 1 hour', true
  ) returning id into invalid_booking_id;
  select jsonb_set(job.payload, '{booking_id}', to_jsonb(invalid_booking_id::text))
    into valid_manual_payload
  from public.integration_jobs job
  where job.booking_id = v_booking_id
  order by job.id
  limit 1;

  begin
    insert into public.integration_jobs (
      organization_id, booking_id, job_type, idempotency_key, payload
    ) values (
      '11111111-1111-4111-8111-111111111111', invalid_booking_id,
      'email.booking.confirmation', 'invalid-payload-fixture', '{}'::jsonb
    );
    raise exception 'incomplete integration payload insert should fail';
  exception when sqlstate '23514' then null;
  end;

  foreach invalid_semantic_payload in array array[
    valid_manual_payload - 'booking_id',
    jsonb_set(
      valid_manual_payload,
      '{line_items,0}',
      (valid_manual_payload#>'{line_items,0}') - 'catalog_item_id'
    ),
    jsonb_set(valid_manual_payload, '{organization,name}', '7'::jsonb),
    jsonb_set(valid_manual_payload, '{organization,from_name}', '{"x":1}'::jsonb),
    jsonb_set(valid_manual_payload, '{realtor,full_name}', '7'::jsonb),
    jsonb_set(valid_manual_payload, '{property,street_address}', '7'::jsonb),
    jsonb_set(valid_manual_payload, '{line_items,0,name}', '7'::jsonb),
    jsonb_set(valid_manual_payload, '{line_items,0,slug}', 'true'::jsonb),
    jsonb_set(valid_manual_payload, '{public_request_id}', '"not-a-uuid"'::jsonb),
    jsonb_set(valid_manual_payload, '{app_url}', '"javascript:alert(1)"'::jsonb),
    jsonb_set(valid_manual_payload, '{app_url}', '"https://user:pass@example.com"'::jsonb),
    jsonb_set(valid_manual_payload, '{realtor,email}', '"not-an-email"'::jsonb),
    jsonb_set(valid_manual_payload, '{booking,scheduled_at}', '"not-a-date"'::jsonb),
    jsonb_set(valid_manual_payload, '{booking,scheduled_at}', '"2030-01-01"'::jsonb),
    jsonb_set(valid_manual_payload, '{booking,scheduled_at}', '"2030-02-30T15:00:00Z"'::jsonb),
    jsonb_set(valid_manual_payload, '{booking,scheduled_at}', '"2030-06-30T23:59:60Z"'::jsonb),
    jsonb_set(valid_manual_payload, '{booking,square_footage}', '-1'::jsonb),
    jsonb_set(valid_manual_payload, '{line_items}', '[null]'::jsonb)
  ] loop
    invalid_semantic_index := invalid_semantic_index + 1;
    begin
      insert into public.integration_jobs (
        organization_id, booking_id, job_type, idempotency_key, payload
      ) values (
        '11111111-1111-4111-8111-111111111111', invalid_booking_id,
        'email.booking.confirmation',
        'semantic-invalid-payload-fixture-' || invalid_semantic_index,
        invalid_semantic_payload
      );
      raise exception 'complete-shaped invalid integration payload should fail';
    exception when sqlstate '23514' then null;
    end;
  end loop;
  if not public.is_valid_booking_integration_payload(
    jsonb_set(valid_manual_payload, '{app_url}', '"http://localhost?preview=1"'::jsonb),
    '11111111-1111-4111-8111-111111111111',
    invalid_booking_id
  ) then raise exception 'valid localhost query URL was rejected'; end if;

  begin
    insert into public.integration_jobs (
      organization_id, booking_id, job_type, idempotency_key, payload
    ) values (
      '11111111-1111-4111-8111-111111111111', invalid_booking_id,
      'unsupported.provider.job', 'unsupported-job-fixture', valid_manual_payload
    );
    raise exception 'unsupported integration job type should fail';
  exception when sqlstate '23514' then null;
  end;

  begin
    insert into public.integration_jobs (
      organization_id, booking_id, job_type, idempotency_key,
      payload_version, payload
    ) values (
      '11111111-1111-4111-8111-111111111111', invalid_booking_id,
      'email.booking.confirmation', 'unsupported-version-fixture',
      2, valid_manual_payload
    );
    raise exception 'unsupported integration payload version should fail';
  exception when sqlstate '23514' then null;
  end;

  replay_result := public.create_public_booking_with_jobs(
    '90000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10 Atomic Street', 'Toronto', 'M1M 1M1', '',
    base_slot, 2500, 'vacant', true, 'Fixture',
    array['10000000-0000-4000-8000-000000000002']::uuid[],
    array['10000000-0000-4000-8000-000000000003']::uuid[]
  );
  if replay_result->>'booking_id' <> first_result->>'booking_id'
     or not (replay_result->>'replayed')::boolean then
    raise exception 'idempotent replay mismatch';
  end if;
  if (select count(*) from public.integration_jobs job where job.booking_id = v_booking_id) <> 5 then
    raise exception 'idempotent replay duplicated outbox';
  end if;

  update public.catalog_items
    set active = false
    where organization_id = '11111111-1111-4111-8111-111111111111';
  replay_result := public.create_public_booking_with_jobs(
    '90000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10 Atomic Street', 'Toronto', 'M1M 1M1', '',
    base_slot, 2500, 'vacant', true, 'Fixture',
    array['10000000-0000-4000-8000-000000000002']::uuid[],
    array['10000000-0000-4000-8000-000000000003']::uuid[]
  );
  if replay_result->>'booking_id' <> first_result->>'booking_id' then
    raise exception 'replay depended on mutable catalog';
  end if;
  update public.catalog_items
    set active = true
    where organization_id = '11111111-1111-4111-8111-111111111111';

  update public.profiles
    set archived_at = pg_catalog.now()
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  begin
    perform public.create_public_booking_with_jobs(
      '90000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '10 Atomic Street', 'Toronto', 'M1M 1M1', '',
      base_slot, 2500, 'vacant', true, 'Fixture',
      array['10000000-0000-4000-8000-000000000002']::uuid[],
      array['10000000-0000-4000-8000-000000000003']::uuid[]
    );
    raise exception 'archived replay should fail';
  exception when sqlstate 'PB001' then null;
  end;
  update public.profiles
    set archived_at = null
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  begin
    perform public.create_public_booking_with_jobs(
      '90000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '10 Atomic Street', 'Changed City', 'M1M 1M1', '',
      base_slot, 2500, 'vacant', true, 'Fixture',
      array['10000000-0000-4000-8000-000000000002']::uuid[],
      array['10000000-0000-4000-8000-000000000003']::uuid[]
    );
    raise exception 'changed replay should fail';
  exception when sqlstate 'PB004' then null;
  end;

  begin
    perform public.create_public_booking_with_jobs(
      '90000000-0000-4000-8000-000000000002',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '20 Overlap Street', 'Toronto', 'M2M 2M2', '',
      base_slot + interval '1 hour', 1000, 'occupied', false, '',
      array['10000000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[]
    );
    raise exception 'overlap should fail';
  exception when sqlstate '23P01' then null;
  end;
  if exists (select 1 from public.properties where street_address = '20 Overlap Street') then
    raise exception 'overlap left orphan property';
  end if;

  begin
    perform public.create_public_booking_with_jobs(
      '90000000-0000-4000-8000-000000000003',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '30 Cross Tenant Street', 'Toronto', 'M3M 3M3', '',
      base_slot + interval '1 day', 1000, 'occupied', false, '',
      array['20000000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[]
    );
    raise exception 'cross-tenant catalog should fail';
  exception when sqlstate 'PB002' then null;
  end;
  if exists (select 1 from public.properties where street_address = '30 Cross Tenant Street') then
    raise exception 'cross-tenant catalog left residue';
  end if;

  begin
    perform public.create_public_booking_with_jobs(
      '90000000-0000-4000-8000-000000000004',
      '11111111-1111-4111-8111-111111111111',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '40 Admin Street', 'Toronto', 'M4M 4M4', '',
      base_slot + interval '2 days', 1000, 'occupied', false, '',
      array['10000000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[]
    );
    raise exception 'company identity should fail';
  exception when sqlstate 'PB001' then null;
  end;

  perform public.create_public_booking_with_jobs(
    '90000000-0000-4000-8000-000000000006',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '60 Ordered Street', 'Toronto', 'M6M 6M6', '',
    base_slot + interval '4 days', 1000, 'vacant', false, '',
    array[
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001'
    ]::uuid[],
    array['10000000-0000-4000-8000-000000000003']::uuid[]
  );
  if exists (
    select 1 from public.integration_jobs job
    where job.booking_id = (
      select id from public.bookings
      where public_request_id = '90000000-0000-4000-8000-000000000006'
    )
      and (
        job.payload#>>'{line_items,0,name}' <> 'Video'
        or job.payload#>>'{line_items,1,name}' <> 'Photos'
        or job.payload#>>'{line_items,2,name}' <> 'Reel'
      )
  ) then raise exception 'provider payload did not preserve selection order'; end if;

  if public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'email.booking.confirmation', 'premature-email-worker',
    '70000000-0000-4000-8000-000000000020'
  ) is not null then raise exception 'customer email claimed before invoice started'; end if;
  invoice_dependency_claim := public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'quickbooks.invoice.create', 'invoice-dependency-worker',
    '70000000-0000-4000-8000-000000000021'
  );
  if invoice_dependency_claim is null then raise exception 'invoice dependency claim failed'; end if;
  if public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'email.booking.confirmation', 'concurrent-email-worker',
    '70000000-0000-4000-8000-000000000022'
  ) is not null then raise exception 'customer email claimed while invoice was leased'; end if;
  if not public.finish_integration_job(
    '11111111-1111-4111-8111-111111111111',
    (invoice_dependency_claim->>'id')::uuid,
    '70000000-0000-4000-8000-000000000021',
    'completed', 'invoice-1', '{"invoice_url":"https://pay.example.test/invoice-1"}'::jsonb,
    '', '', null
  ) then raise exception 'invoice dependency completion failed'; end if;

  claim_result := public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'email.booking.confirmation', 'test-worker',
    '70000000-0000-4000-8000-000000000001'
  );
  if claim_result is null then raise exception 'claim failed'; end if;
  if claim_result#>>'{dependency_result,invoice_url}' <> 'https://pay.example.test/invoice-1' then
    raise exception 'customer email claim did not carry completed invoice result';
  end if;
  if claim_result->>'organization_id' <> '11111111-1111-4111-8111-111111111111'
    or claim_result->>'booking_id' <> v_booking_id::text
    or claim_result->>'job_type' <> 'email.booking.confirmation'
    or (claim_result->>'payload_version')::integer <> 1
  then raise exception 'claim envelope was not context-bound'; end if;
  if public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'email.booking.confirmation', 'second-worker',
    '70000000-0000-4000-8000-000000000002'
  ) is not null then raise exception 'double claim succeeded'; end if;
  if public.finish_integration_job(
    '11111111-1111-4111-8111-111111111111', (claim_result->>'id')::uuid,
    '70000000-0000-4000-8000-000000000002', 'completed', '', '{}'::jsonb,
    '', '', null
  ) then raise exception 'wrong lease completed job'; end if;
  if not public.finish_integration_job(
    '11111111-1111-4111-8111-111111111111', (claim_result->>'id')::uuid,
    '70000000-0000-4000-8000-000000000001', 'completed', 'message-1', '{}'::jsonb,
    '', '', null
  ) then raise exception 'correct lease did not complete job'; end if;

  update public.integration_jobs
  set status = 'processing',
      completed_at = null,
      created_at = pg_catalog.now() - interval '24 hours',
      attempts = 1,
      lease_token = '70000000-0000-4000-8000-000000000008',
      locked_by = 'old-email-worker',
      locked_at = pg_catalog.now() - interval '24 hours',
      lease_expires_at = pg_catalog.now() - interval '23 hours'
  where id = (claim_result->>'id')::uuid;
  if public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'email.booking.confirmation', 'too-late-email-worker',
    '70000000-0000-4000-8000-000000000009'
  ) is not null then raise exception 'email was reclaimed outside provider idempotency window'; end if;
  if (select status from public.integration_jobs where id = (claim_result->>'id')::uuid) <> 'dead_letter' then
    raise exception 'expired old email was not terminalized';
  end if;

  update public.integration_jobs
  set status = 'retryable',
      completed_at = null,
      attempts = 1,
      next_attempt_at = pg_catalog.now() - interval '1 minute',
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null
  where id = (claim_result->>'id')::uuid;
  if public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'email.booking.confirmation', 'too-late-retry-worker',
    '70000000-0000-4000-8000-000000000010'
  ) is not null then raise exception 'retryable email bypassed provider idempotency cutoff'; end if;
  if (select status from public.integration_jobs where id = (claim_result->>'id')::uuid) <> 'dead_letter' then
    raise exception 'old retryable email was not terminalized';
  end if;

  stale_claim := public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'email.admin.new_booking', 'stale-email-worker',
    '70000000-0000-4000-8000-000000000003'
  );
  update public.integration_jobs
    set lease_expires_at = pg_catalog.now() - interval '1 minute'
    where id = (stale_claim->>'id')::uuid;
  if public.finish_integration_job(
    '11111111-1111-4111-8111-111111111111', (stale_claim->>'id')::uuid,
    '70000000-0000-4000-8000-000000000003', 'completed', '', '{}'::jsonb,
    '', '', null
  ) then raise exception 'expired lease completed job'; end if;
  stale_claim := public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'email.admin.new_booking', 'recovery-email-worker',
    '70000000-0000-4000-8000-000000000004'
  );
  if stale_claim is null then raise exception 'expired email lease was not reclaimed'; end if;
  if not public.finish_integration_job(
    '11111111-1111-4111-8111-111111111111', (stale_claim->>'id')::uuid,
    '70000000-0000-4000-8000-000000000004', 'completed', 'message-2', '{}'::jsonb,
    '', '', null
  ) then raise exception 'reclaimed email lease did not complete'; end if;

  unsafe_claim := public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'google_calendar.event.create', 'stale-calendar-worker',
    '70000000-0000-4000-8000-000000000005'
  );
  update public.integration_jobs
    set lease_expires_at = pg_catalog.now() - interval '1 minute'
    where id = (unsafe_claim->>'id')::uuid;
  if public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'google_calendar.event.create', 'unsafe-retry-worker',
    '70000000-0000-4000-8000-000000000006'
  ) is not null then raise exception 'ambiguous calendar lease was retried'; end if;
  if (select status from public.integration_jobs where id = (unsafe_claim->>'id')::uuid) <> 'dead_letter' then
    raise exception 'ambiguous expired lease was not terminalized';
  end if;

  update public.integration_jobs
    set attempts = max_attempts - 1
    where organization_id = '11111111-1111-4111-8111-111111111111'
      and booking_id = v_booking_id
      and job_type = 'push.admin.new_booking';
  final_claim := public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111', v_booking_id,
    'push.admin.new_booking', 'final-worker',
    '70000000-0000-4000-8000-000000000007'
  );
  if not public.finish_integration_job(
    '11111111-1111-4111-8111-111111111111', (final_claim->>'id')::uuid,
    '70000000-0000-4000-8000-000000000007', 'retryable', '', '{}'::jsonb,
    'failed', 'final failure', null
  ) then raise exception 'final attempt did not settle'; end if;
  if (select status from public.integration_jobs where id = (final_claim->>'id')::uuid) <> 'dead_letter' then
    raise exception 'final retryable attempt was not dead-lettered';
  end if;
end;
$$;

do $$
declare
  booking_a jsonb;
  booking_b jsonb;
  booking_c jsonb;
  booking_d jsonb;
  booking_a_id uuid;
  booking_b_id uuid;
  booking_c_id uuid;
  booking_d_id uuid;
  due_bookings uuid[];
  due_types text[];
  booking_a_types text[];
  cancelled_claim jsonb;
begin
  booking_a := public.create_public_booking_with_jobs(
    '90000000-0000-4000-8000-000000000010',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70 Recovery Invoice Street', 'Toronto', 'M7M 7M7', '',
    pg_catalog.now() + interval '110 days', 1000, 'vacant', false, '',
    array['10000000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[]
  );
  booking_b := public.create_public_booking_with_jobs(
    '90000000-0000-4000-8000-000000000011',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '71 Recovery Email Street', 'Toronto', 'M7M 7M8', '',
    pg_catalog.now() + interval '111 days', 1000, 'vacant', false, '',
    array['10000000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[]
  );
  booking_c := public.create_public_booking_with_jobs(
    '90000000-0000-4000-8000-000000000012',
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '72 Recovery Lease Street', 'Toronto', 'M7M 7M9', '',
    pg_catalog.now() + interval '112 days', 1000, 'vacant', false, '',
    array['20000000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[]
  );
  booking_d := public.create_public_booking_with_jobs(
    '90000000-0000-4000-8000-000000000013',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '73 Cancelled Recovery Street', 'Toronto', 'M7M 7N0', '',
    pg_catalog.now() + interval '113 days', 1000, 'vacant', false, '',
    array['10000000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[]
  );
  booking_a_id := (booking_a->>'booking_id')::uuid;
  booking_b_id := (booking_b->>'booking_id')::uuid;
  booking_c_id := (booking_c->>'booking_id')::uuid;
  booking_d_id := (booking_d->>'booking_id')::uuid;

  update public.integration_jobs
  set status = 'skipped', completed_at = pg_catalog.now(),
      lease_token = null, locked_by = null, locked_at = null,
      lease_expires_at = null
  where booking_id in (booking_a_id, booking_b_id, booking_c_id, booking_d_id);

  update public.integration_jobs
  set status = 'pending', completed_at = null,
      next_attempt_at = pg_catalog.now() - interval '5 minutes'
  where booking_id = booking_a_id
    and job_type = 'quickbooks.invoice.create';
  update public.integration_jobs
  set status = 'pending', completed_at = null,
      next_attempt_at = pg_catalog.now() - interval '2 minutes'
  where booking_id = booking_a_id
    and job_type = 'email.booking.confirmation';
  update public.integration_jobs
  set status = 'pending', completed_at = null,
      next_attempt_at = pg_catalog.now() - interval '4 minutes'
  where booking_id = booking_b_id
    and job_type = 'email.booking.confirmation';
  update public.integration_jobs
  set status = 'processing', completed_at = null, attempts = 1,
      lease_token = '71000000-0000-4000-8000-000000000001',
      locked_by = 'expired-email-worker',
      locked_at = pg_catalog.now() - interval '10 minutes',
      lease_expires_at = pg_catalog.now() - interval '6 minutes'
  where booking_id = booking_c_id
    and job_type = 'email.admin.new_booking';
  update public.integration_jobs
  set status = 'processing', completed_at = null, attempts = max_attempts,
      lease_token = '71000000-0000-4000-8000-000000000002',
      locked_by = 'active-cancelled-worker',
      locked_at = pg_catalog.now(),
      lease_expires_at = pg_catalog.now() + interval '8 minutes'
  where booking_id = booking_d_id
    and job_type = 'email.admin.new_booking';
  update public.bookings set status = 'cancelled' where id = booking_d_id;

  begin
    update public.integration_jobs
    set status = 'retryable', completed_at = null
    where booking_id = booking_b_id
      and job_type = 'google_calendar.event.create';
    raise exception 'non-email retryable work was not prohibited';
  exception when sqlstate '23514' then null;
  end;

  if exists (
    select 1
    from public.list_due_integration_jobs(
      5,
      pg_catalog.now() + interval '1 hour'
    )
  ) then raise exception 'pre-rollout jobs crossed the configured watermark'; end if;

  select pg_catalog.array_agg(due.booking_id), pg_catalog.array_agg(due.job_type)
    into due_bookings, due_types
  from public.list_due_integration_jobs(3, pg_catalog.now() - interval '1 hour') due;

  if pg_catalog.cardinality(due_bookings) <> 3
    or due_bookings[1] = due_bookings[2]
    or (select organization_id from public.bookings where id = due_bookings[1]) =
       (select organization_id from public.bookings where id = due_bookings[2])
  then raise exception 'due integration list was not tenant fair'; end if;
  if pg_catalog.array_position(due_bookings, booking_a_id) >=
     pg_catalog.array_position(due_bookings, booking_b_id)
  then raise exception 'invoice was not ordered before customer email'; end if;
  if pg_catalog.array_position(due_bookings, booking_c_id) is null
    or due_types[pg_catalog.array_position(due_bookings, booking_c_id)] <>
       'email.admin.new_booking'
  then raise exception 'expired processing email was not listed'; end if;

  with ordered_due as materialized (
    select due.*, pg_catalog.row_number() over () as due_position
    from public.list_due_integration_jobs(50, pg_catalog.now() - interval '1 hour') due
  )
  select pg_catalog.array_agg(job_type order by due_position)
    into booking_a_types
  from ordered_due
  where booking_id = booking_a_id;
  if pg_catalog.array_position(
       booking_a_types, 'quickbooks.invoice.create'
     ) is null
    or pg_catalog.array_position(
       booking_a_types, 'email.booking.confirmation'
     ) is null
    or pg_catalog.array_position(
       booking_a_types, 'quickbooks.invoice.create'
     ) >= pg_catalog.array_position(
       booking_a_types, 'email.booking.confirmation'
     )
  then raise exception 'due list did not preserve exact invoice-before-email scope'; end if;

  if not exists (
    select 1 from public.integration_jobs
    where booking_id = booking_d_id
      and job_type = 'email.admin.new_booking'
      and status = 'processing'
      and lease_expires_at > pg_catalog.now()
  ) then raise exception 'cancelled booking cleared an active provider lease'; end if;

  update public.integration_jobs
  set lease_expires_at = pg_catalog.now() - interval '1 minute'
  where booking_id = booking_d_id
    and job_type = 'email.admin.new_booking';
  if not exists (
    select 1
    from public.list_due_integration_jobs(
      50,
      pg_catalog.now() - interval '1 hour'
    ) due
    where due.booking_id = booking_d_id
      and due.job_type = 'email.admin.new_booking'
  ) then raise exception 'expired final-attempt processing job was not recoverable'; end if;
  select public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111',
    booking_d_id,
    'email.admin.new_booking',
    'cancelled-expired-test-worker',
    '71000000-0000-4000-8000-000000000003'
  ) into cancelled_claim;
  if cancelled_claim is not null or not exists (
    select 1 from public.integration_jobs
    where booking_id = booking_d_id
      and job_type = 'email.admin.new_booking'
      and status = 'dead_letter'
      and last_error_code = 'lease_expired_ambiguous'
  ) then raise exception 'cancelled expired lease was not preserved for reconciliation'; end if;

  update public.bookings set status = 'cancelled' where id = booking_b_id;
  select public.claim_integration_job(
    '11111111-1111-4111-8111-111111111111',
    booking_b_id,
    'email.booking.confirmation',
    'cancelled-pending-test-worker',
    '71000000-0000-4000-8000-000000000004'
  ) into cancelled_claim;
  if cancelled_claim is not null or not exists (
    select 1 from public.integration_jobs
    where booking_id = booking_b_id
      and job_type = 'email.booking.confirmation'
      and status = 'cancelled'
      and last_error_code = 'booking_cancelled'
  ) then raise exception 'cancelled booking job was claimable'; end if;

  update public.integration_jobs
  set status = 'dead_letter', completed_at = pg_catalog.now(),
      last_error_code = 'ambiguous_provider_result',
      last_error_message = 'Fixture requires reconciliation',
      last_error_at = pg_catalog.now(),
      lease_token = null, locked_by = null, locked_at = null,
      lease_expires_at = null
  where booking_id = booking_a_id
    and job_type = 'quickbooks.invoice.create';
  update public.integration_jobs
  set status = 'dead_letter', completed_at = pg_catalog.now(),
      last_error_code = 'lease_expired_ambiguous',
      last_error_message = 'Fixture requires reconciliation',
      last_error_at = pg_catalog.now(),
      lease_token = null, locked_by = null, locked_at = null,
      lease_expires_at = null
  where booking_id = booking_c_id
    and job_type = 'email.admin.new_booking';
end;
$$;

select pg_catalog.set_config(
  'test.tenant_one_reconciliation_job',
  (
    select job.id::text
    from public.integration_jobs job
    join public.bookings booking on booking.id = job.booking_id
    where booking.public_request_id = '90000000-0000-4000-8000-000000000010'
      and job.job_type = 'quickbooks.invoice.create'
  ),
  true
);
select pg_catalog.set_config(
  'test.tenant_two_reconciliation_job',
  (
    select job.id::text
    from public.integration_jobs job
    join public.bookings booking on booking.id = job.booking_id
    where booking.public_request_id = '90000000-0000-4000-8000-000000000012'
      and job.job_type = 'email.admin.new_booking'
  ),
  true
);

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  true
);

do $$
declare
  tenant_one_job uuid;
  tenant_two_job uuid;
begin
  tenant_one_job := pg_catalog.current_setting(
    'test.tenant_one_reconciliation_job'
  )::uuid;
  tenant_two_job := pg_catalog.current_setting(
    'test.tenant_two_reconciliation_job'
  )::uuid;

  begin
    perform public.reconcile_integration_job(
      '22222222-2222-4222-8222-222222222222', tenant_two_job,
      'provider_confirmed_absent', 'Checked the provider and found no external mutation.'
    );
    raise exception 'cross-tenant reconciliation was authorized';
  exception when insufficient_privilege then null;
  end;

  if not public.reconcile_integration_job(
    '11111111-1111-4111-8111-111111111111', tenant_one_job,
    'provider_confirmed_completed', 'Confirmed the invoice exists in QuickBooks and matches the booking.'
  ) then raise exception 'reconciliation audit was not persisted'; end if;
  if public.reconcile_integration_job(
    '11111111-1111-4111-8111-111111111111', tenant_one_job,
    'provider_confirmed_completed', 'A second reconciliation must never overwrite the first audit.'
  ) then raise exception 'reconciliation was not single-use'; end if;
end;
$$;

set local role service_role;
do $$
begin
  if not exists (
    select 1
    from public.integration_jobs job
    join public.bookings booking on booking.id = job.booking_id
    where booking.public_request_id = '90000000-0000-4000-8000-000000000010'
      and job.job_type = 'quickbooks.invoice.create'
      and job.reconciled_at is not null
      and job.reconciled_by = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and job.reconciliation_category = 'provider_confirmed_completed'
      and job.reconciliation_note =
        'Confirmed the invoice exists in QuickBooks and matches the booking.'
  ) then raise exception 'reconciliation audit was not persisted'; end if;

  begin
    update public.integration_jobs job
    set reconciliation_note = 'A service-role rewrite must not alter completed audit evidence.'
    from public.bookings booking
    where booking.id = job.booking_id
      and booking.public_request_id = '90000000-0000-4000-8000-000000000010'
      and job.job_type = 'quickbooks.invoice.create';
    raise exception 'completed reconciliation audit was mutable';
  exception when sqlstate '23514' then null;
  end;
end;
$$;

create or replace function public.test_fail_line_insert()
returns trigger language plpgsql as $$ begin raise exception 'forced line failure'; end $$;
create trigger test_force_line_failure before insert on public.booking_line_items
for each row execute function public.test_fail_line_insert();

do $$
begin
  begin
    perform public.create_public_booking_with_jobs(
      '90000000-0000-4000-8000-000000000005',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '50 Rollback Street', 'Toronto', 'M5M 5M5', '',
      pg_catalog.now() + interval '93 days', 2500, 'vacant', true, '',
      array['10000000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[]
    );
    raise exception 'forced line failure should abort';
  exception when others then
    if sqlerrm = 'forced line failure should abort' then raise; end if;
  end;
  if exists (select 1 from public.properties where street_address = '50 Rollback Street')
     or exists (select 1 from public.bookings where public_request_id = '90000000-0000-4000-8000-000000000005')
     or exists (select 1 from public.integration_jobs where idempotency_key like '%90000000-0000-4000-8000-000000000005%') then
    raise exception 'forced line failure left aggregate residue';
  end if;
end;
$$;

rollback;
