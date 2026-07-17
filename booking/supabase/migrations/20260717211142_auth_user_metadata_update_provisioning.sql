-- Supabase Auth applies admin app_metadata after the initial auth.users insert.
-- Keep the initial identity quarantined/profile-less, then provision only when
-- protected metadata is present. Public signup remains disabled at Auth config.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  realtor_organization_id uuid;
begin
  -- Owner invitations remain profile-less until atomic invitation claim.
  if coalesce(new.raw_app_meta_data, '{}'::jsonb) ? 'company_invitation_id' then
    return new;
  end if;

  -- A marker-less identity has no tenant authority and remains quarantined.
  -- Supabase Admin createUser writes protected app_metadata after INSERT, so an
  -- UPDATE trigger below performs trusted realtor provisioning.
  if not (
    coalesce(new.raw_app_meta_data, '{}'::jsonb) ?
    'realtor_organization_id'
  ) then
    return new;
  end if;

  begin
    realtor_organization_id :=
      nullif(new.raw_app_meta_data ->> 'realtor_organization_id', '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'invalid realtor organization marker'
        using errcode = '22023';
  end;

  if realtor_organization_id is null or not exists (
    select 1
    from public.organizations o
    where o.id = realtor_organization_id
  ) then
    raise exception 'realtor organization does not exist'
      using errcode = '23503';
  end if;

  insert into public.profiles (
    id,
    email,
    full_name,
    organization_id,
    role
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    realtor_organization_id,
    'realtor'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of raw_app_meta_data on auth.users
for each row execute function public.handle_new_auth_user();
