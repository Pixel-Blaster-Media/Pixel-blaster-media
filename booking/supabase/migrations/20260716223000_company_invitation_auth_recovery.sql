-- Quarantine pending company owners, recover ambiguous Auth mutations, and
-- atomically claim tenant membership only after workspace provisioning succeeds.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Pending invitation users must not inherit the default organization. Without
  -- a profile, all normal application authorization paths fail closed.
  if new.raw_app_meta_data ? 'company_invitation_id' then
    return new;
  end if;

  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.find_company_invitation_auth_user(
  p_invitation_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matching_ids uuid[];
begin
  select array_agg(u.id order by u.id)
  into matching_ids
  from auth.users u
  where u.raw_app_meta_data ->> 'company_invitation_id' = p_invitation_id::text;

  if coalesce(cardinality(matching_ids), 0) = 0 then
    return null;
  end if;
  if cardinality(matching_ids) <> 1 then
    raise exception 'company invitation marker is not unique';
  end if;
  return matching_ids[1];
end;
$$;

create or replace function public.claim_company_invitation_owner(
  p_invitation_id uuid,
  p_user_id uuid,
  p_organization_id uuid,
  p_email text,
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_profile_org uuid;
  profile_exists boolean;
begin
  if not exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and lower(u.email) = lower(p_email)
      and u.raw_app_meta_data ->> 'company_invitation_id' = p_invitation_id::text
  ) then
    raise exception 'invitation identity mismatch';
  end if;

  select p.organization_id
  into existing_profile_org
  from public.profiles p
  where p.id = p_user_id
  for update;
  profile_exists := found;

  if profile_exists and existing_profile_org is distinct from p_organization_id then
    raise exception 'invitation user already belongs to another organization';
  end if;

  if exists (
    select 1
    from public.organization_members om
    where om.profile_id = p_user_id
      and om.organization_id <> p_organization_id
  ) then
    raise exception 'invitation user already has another organization membership';
  end if;

  if profile_exists then
    update public.profiles
    set email = lower(p_email),
        full_name = p_full_name,
        role = 'admin'
    where id = p_user_id
      and organization_id = p_organization_id;
  else
    insert into public.profiles (
      id,
      organization_id,
      email,
      full_name,
      role
    ) values (
      p_user_id,
      p_organization_id,
      lower(p_email),
      p_full_name,
      'admin'
    );
  end if;

  insert into public.organization_members (
    organization_id,
    profile_id,
    role
  ) values (
    p_organization_id,
    p_user_id,
    'owner'
  )
  on conflict (organization_id, profile_id)
  do update set role = 'owner';
end;
$$;

revoke all on function public.find_company_invitation_auth_user(uuid) from public;
revoke all on function public.find_company_invitation_auth_user(uuid) from anon;
revoke all on function public.find_company_invitation_auth_user(uuid) from authenticated;
grant execute on function public.find_company_invitation_auth_user(uuid) to service_role;

revoke all on function public.claim_company_invitation_owner(uuid, uuid, uuid, text, text) from public;
revoke all on function public.claim_company_invitation_owner(uuid, uuid, uuid, text, text) from anon;
revoke all on function public.claim_company_invitation_owner(uuid, uuid, uuid, text, text) from authenticated;
grant execute on function public.claim_company_invitation_owner(uuid, uuid, uuid, text, text) to service_role;
