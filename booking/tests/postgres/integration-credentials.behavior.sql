\set ON_ERROR_STOP on

select public.merge_integration_credentials(
  '11111111-1111-4111-8111-111111111111',
  'autoenhance',
  '{"api_key":"key-a","webhook_secret":"secret-a","enabled":"true"}'::jsonb,
  null
);

select public.merge_integration_credentials(
  '11111111-1111-4111-8111-111111111111',
  'autoenhance',
  '{"enabled":"false"}'::jsonb,
  null
);

do $$
declare
  v_credentials jsonb;
begin
  select credentials into v_credentials
  from public.integration_credentials
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and provider = 'autoenhance';
  if v_credentials is distinct from
    '{"api_key":"key-a","webhook_secret":"secret-a","enabled":"false"}'::jsonb then
    raise exception 'toggle did not preserve secrets: %', v_credentials;
  end if;

  if has_function_privilege('anon',
      'public.merge_integration_credentials(uuid,text,jsonb,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
      'public.merge_integration_credentials(uuid,text,jsonb,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role',
      'public.merge_integration_credentials(uuid,text,jsonb,uuid)', 'EXECUTE') then
    raise exception 'credential merge function grants are unsafe';
  end if;
  if has_function_privilege('anon',
      'public.clear_integration_credentials(uuid,text,text[])', 'EXECUTE')
     or has_function_privilege('authenticated',
      'public.clear_integration_credentials(uuid,text,text[])', 'EXECUTE')
     or not has_function_privilege('service_role',
      'public.clear_integration_credentials(uuid,text,text[])', 'EXECUTE') then
    raise exception 'credential clear function grants are unsafe';
  end if;
end;
$$;

select public.clear_integration_credentials(
  '11111111-1111-4111-8111-111111111111',
  'autoenhance',
  array['webhook_secret']
);

do $$
begin
  if (select credentials ? 'webhook_secret'
      from public.integration_credentials
      where organization_id='11111111-1111-4111-8111-111111111111'
        and provider='autoenhance')
     or (select credentials->>'api_key'
         from public.integration_credentials
         where organization_id='11111111-1111-4111-8111-111111111111'
           and provider='autoenhance') <> 'key-a' then
    raise exception 'clear did not preserve unrelated credentials';
  end if;
end;
$$;

select public.merge_integration_credentials(
  '11111111-1111-4111-8111-111111111111',
  'autoenhance',
  '{"webhook_secret":"secret-a"}'::jsonb,
  null
);

-- Tenant isolation: the same provider in another tenant remains independent.
select public.merge_integration_credentials(
  '22222222-2222-4222-8222-222222222222',
  'autoenhance',
  '{"api_key":"key-b","enabled":"true"}'::jsonb,
  null
);

do $$
begin
  if (select credentials->>'api_key'
      from public.integration_credentials
      where organization_id='11111111-1111-4111-8111-111111111111'
        and provider='autoenhance') <> 'key-a' then
    raise exception 'cross-tenant credential mutation';
  end if;
end;
$$;

-- Rejected input must not alter the row.
do $$
begin
  begin
    perform public.merge_integration_credentials(
      '11111111-1111-4111-8111-111111111111',
      'autoenhance',
      '{"unknown":"bad"}'::jsonb,
      null
    );
    raise exception 'unknown field was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  if (select credentials ? 'unknown'
      from public.integration_credentials
      where organization_id='11111111-1111-4111-8111-111111111111'
        and provider='autoenhance') then
    raise exception 'rejected input altered credentials';
  end if;
end;
$$;
