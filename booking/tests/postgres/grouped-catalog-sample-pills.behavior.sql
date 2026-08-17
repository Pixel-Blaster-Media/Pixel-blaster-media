begin;

insert into public.organizations (id, name, slug) values (
  '33333333-3333-4333-8333-333333333333',
  'Grouped Sample Tenant',
  'grouped-sample-tenant'
);
insert into public.catalog_items (
  id, organization_id, slug, name, description, kind, duration_minutes, price_cents
) values (
  '33000000-0000-4000-8000-000000000001',
  '33333333-3333-4333-8333-333333333333',
  'site_plan_fixture',
  'Site Plan Fixture',
  '',
  'addon',
  20,
  10000
);

set local role service_role;

do $$
declare
  v_id uuid;
begin
  v_id := public.attach_external_catalog_example(
    '33333333-3333-4333-8333-333333333333',
    '33000000-0000-4000-8000-000000000001',
    'Site Plan Sample',
    'Interactive property site plan',
    'link',
    'https://example.com/site-plan',
    'custom_site_plan',
    'Site Plan'
  );
  if v_id is null then
    raise exception 'grouped external example was not attached';
  end if;
  if not exists (
    select 1 from public.catalog_item_examples
    where id = v_id
      and organization_id = '33333333-3333-4333-8333-333333333333'
      and sample_group_key = 'custom_site_plan'
      and sample_group_label = 'Site Plan'
  ) then
    raise exception 'grouped external example did not persist its pill metadata';
  end if;

  if public.attach_external_catalog_example(
    '33333333-3333-4333-8333-333333333333',
    '33000000-0000-4000-8000-000000000001',
    'Unsafe Group',
    null,
    'link',
    'https://example.com/unsafe',
    'BAD KEY',
    'Unsafe'
  ) is not null then
    raise exception 'invalid sample group key was accepted';
  end if;
end $$;

-- Both sample-group fields must be null together; either partial-null permutation fails.
do $$
begin
  begin
    insert into public.catalog_item_examples (
      organization_id, catalog_item_id, title, kind, source_type, external_url,
      sample_group_key, sample_group_label, display_order
    ) values (
      '33333333-3333-4333-8333-333333333333',
      '33000000-0000-4000-8000-000000000001',
      'Partial key', 'link', 'external_url', 'https://example.com/partial-key',
      'photos', null, 1
    );
    raise exception 'sample group key partial-null unexpectedly accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.catalog_item_examples (
      organization_id, catalog_item_id, title, kind, source_type, external_url,
      sample_group_key, sample_group_label, display_order
    ) values (
      '33333333-3333-4333-8333-333333333333',
      '33000000-0000-4000-8000-000000000001',
      'Partial label', 'link', 'external_url', 'https://example.com/partial-label',
      null, 'Photos', 1
    );
    raise exception 'sample group label partial-null unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;

-- The six-argument overload remains compatible with the currently deployed application.
do $$
declare
  v_legacy_id uuid;
begin
  v_legacy_id := public.attach_external_catalog_example(
    '33333333-3333-4333-8333-333333333333',
    '33000000-0000-4000-8000-000000000001',
    'Legacy Example',
    null,
    'interactive',
    'https://youriguide.com/legacy'
  );
  if v_legacy_id is null then
    raise exception 'legacy external example overload stopped working';
  end if;
  if exists (
    select 1 from public.catalog_item_examples
    where id = v_legacy_id
      and (sample_group_key is not null or sample_group_label is not null)
  ) then
    raise exception 'legacy overload unexpectedly invented persisted group metadata';
  end if;
end $$;

reset role;

do $$
begin
  if not has_function_privilege(
    'service_role',
    'public.attach_external_catalog_example(uuid,uuid,text,text,text,text,text,text)',
    'execute'
  ) then
    raise exception 'service role cannot attach grouped examples';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.attach_external_catalog_example(uuid,uuid,text,text,text,text,text,text)',
    'execute'
  ) then
    raise exception 'authenticated role can attach grouped examples';
  end if;
end $$;

rollback;
