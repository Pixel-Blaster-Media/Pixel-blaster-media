-- Atomically merge tenant-scoped integration credential fields.
-- The service-role-only boundary prevents read/merge/write races from dropping
-- unrelated secrets when an enablement toggle and credential rotation overlap.

create or replace function public.merge_integration_credentials(
  p_organization_id uuid,
  p_provider text,
  p_fields jsonb,
  p_updated_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed_fields text[];
  v_credentials jsonb;
begin
  v_allowed_fields := case p_provider
    when 'admin_settings' then array['today_command_preferences']::text[]
    when 'autohdr' then array['api_key', 'enabled']::text[]
    when 'autoenhance' then array['api_key', 'webhook_secret', 'enabled']::text[]
    when 'fotello' then array['api_key']::text[]
    when 'google_maps' then array['api_key']::text[]
    when 'iguide' then array['app_id', 'app_token', 'webhook_secret']::text[]
    when 'openai' then array['api_key', 'model']::text[]
    when 'resend' then array['api_key']::text[]
    else null
  end;

  if p_organization_id is null
     or v_allowed_fields is null
     or p_fields is null
     or jsonb_typeof(p_fields) is distinct from 'object'
     or p_fields = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'invalid credential merge input';
  end if;

  if exists (
    select 1
    from jsonb_each(p_fields) as field(key, value)
    where not (field.key = any(v_allowed_fields))
       or jsonb_typeof(field.value) is distinct from 'string'
       or btrim(field.value #>> '{}') = ''
       or (
         field.key = 'enabled'
         and lower(btrim(field.value #>> '{}')) not in ('true', 'false')
       )
  ) then
    raise exception using errcode = '22023', message = 'invalid credential merge field';
  end if;

  insert into public.integration_credentials (
    organization_id,
    provider,
    credentials,
    updated_by
  ) values (
    p_organization_id,
    p_provider,
    p_fields,
    p_updated_by
  )
  on conflict (organization_id, provider) do update
    set credentials = public.integration_credentials.credentials || excluded.credentials,
        updated_by = excluded.updated_by
  returning credentials into v_credentials;

  return v_credentials;
end;
$$;

revoke all on function public.merge_integration_credentials(uuid, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.merge_integration_credentials(uuid, text, jsonb, uuid)
  to service_role;

create or replace function public.clear_integration_credentials(
  p_organization_id uuid,
  p_provider text,
  p_fields text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed_fields text[];
  v_credentials jsonb;
begin
  v_allowed_fields := case p_provider
    when 'admin_settings' then array['today_command_preferences']::text[]
    when 'autohdr' then array['api_key', 'enabled']::text[]
    when 'autoenhance' then array['api_key', 'webhook_secret', 'enabled']::text[]
    when 'fotello' then array['api_key']::text[]
    when 'google_maps' then array['api_key']::text[]
    when 'iguide' then array['app_id', 'app_token', 'webhook_secret']::text[]
    when 'openai' then array['api_key', 'model']::text[]
    when 'resend' then array['api_key']::text[]
    else null
  end;

  if p_organization_id is null
     or v_allowed_fields is null
     or p_fields is null
     or cardinality(p_fields) = 0
     or exists (
       select 1 from unnest(p_fields) as field
       where field is null or not (field = any(v_allowed_fields))
     ) then
    raise exception using errcode = '22023', message = 'invalid credential clear input';
  end if;

  update public.integration_credentials
  set credentials = credentials - p_fields
  where organization_id = p_organization_id
    and provider = p_provider
  returning credentials into v_credentials;

  if v_credentials = '{}'::jsonb then
    delete from public.integration_credentials
    where organization_id = p_organization_id
      and provider = p_provider;
    return null;
  end if;
  return v_credentials;
end;
$$;

revoke all on function public.clear_integration_credentials(uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.clear_integration_credentials(uuid, text, text[])
  to service_role;
