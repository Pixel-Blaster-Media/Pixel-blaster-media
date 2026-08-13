\ir canonical-media-bootstrap.sql

create or replace function public.is_organization_admin(target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles profile
      join public.organization_members member
        on member.profile_id = profile.id
       and member.organization_id = profile.organization_id
     where profile.id = (select auth.uid())
       and profile.organization_id = target_org_id
       and profile.archived_at is null
       and member.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_organization_admin(uuid) from public, anon;
grant execute on function public.is_organization_admin(uuid) to authenticated;
