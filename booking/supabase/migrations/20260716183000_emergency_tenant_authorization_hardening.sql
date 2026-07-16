-- Emergency tenant authorization hardening.
--
-- This migration closes two release-blocking SaaS isolation defects:
-- 1. authenticated browser clients could change privileged profile fields;
-- 2. legacy global is_admin() policies crossed organization boundaries.

create or replace function public.prevent_profile_authorization_self_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and (
       old.role is distinct from new.role
       or old.organization_id is distinct from new.organization_id
       or old.email is distinct from new.email
       or old.archived_at is distinct from new.archived_at
     ) then
    raise exception 'Profile authorization fields cannot be changed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_profile_authorization_self_change()
  from public, anon, authenticated;

drop trigger if exists profiles_prevent_authorization_self_change
  on public.profiles;
create trigger profiles_prevent_authorization_self_change
  before update of role, organization_id, email, archived_at
  on public.profiles
  for each row execute function public.prevent_profile_authorization_self_change();

-- Browser RLS authority requires all three facts to agree: the caller has an
-- unarchived profile, that profile's active organization matches the target,
-- and a privileged membership exists in that same organization.
create or replace function public.is_organization_admin(target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      join public.organization_members om
        on om.profile_id = p.id
       and om.organization_id = p.organization_id
     where p.id = (select auth.uid())
       and p.organization_id = target_org_id
       and p.archived_at is null
       and om.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_organization_admin(uuid)
  from public, anon;
grant execute on function public.is_organization_admin(uuid)
  to authenticated;

-- organization_members represents the active organization selected on profiles.
-- Enforce that invariant for service-role and browser writes alike. The lock
-- closes the gap between validating existing rows and installing the trigger.
lock table public.organization_members in share row exclusive mode;

do $$
begin
  if exists (
    select 1
      from public.organization_members om
      left join public.profiles p on p.id = om.profile_id
     where p.id is null
        or p.organization_id is distinct from om.organization_id
  ) then
    raise exception 'Existing organization membership does not match profile organization'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.enforce_membership_organization_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.profiles p
     where p.id = new.profile_id
       and p.organization_id = new.organization_id
  ) then
    raise exception 'Membership organization must match profile organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_membership_organization_match()
  from public, anon, authenticated;

drop trigger if exists organization_members_enforce_profile_organization
  on public.organization_members;
create trigger organization_members_enforce_profile_organization
  before insert or update of organization_id, profile_id
  on public.organization_members
  for each row execute function public.enforce_membership_organization_match();

-- Organizations are visible and editable only inside the caller's membership.
-- Platform-wide creation/listing continues through server-only service-role code.
drop policy if exists "organizations: admin read" on public.organizations;
drop policy if exists "organizations: admin write" on public.organizations;
drop policy if exists "organizations: org admin read" on public.organizations;
drop policy if exists "organizations: org admin update" on public.organizations;

create policy "organizations: org admin read"
  on public.organizations for select
  to authenticated
  using (public.is_organization_admin(id));

create policy "organizations: org admin update"
  on public.organizations for update
  to authenticated
  using (public.is_organization_admin(id))
  with check (public.is_organization_admin(id));

-- Membership reads stay available to the member and that organization's
-- administrators. Writes can only target an organization the caller already
-- administers, preventing creation of a membership in another tenant.
drop policy if exists "organization_members: self or admin read"
  on public.organization_members;
drop policy if exists "organization_members: admin write"
  on public.organization_members;
drop policy if exists "organization_members: self or org admin read"
  on public.organization_members;
drop policy if exists "organization_members: org admin insert"
  on public.organization_members;
drop policy if exists "organization_members: org admin update"
  on public.organization_members;
drop policy if exists "organization_members: org admin delete"
  on public.organization_members;

create policy "organization_members: self or org admin read"
  on public.organization_members for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.is_organization_admin(organization_id)
  );

create policy "organization_members: org admin insert"
  on public.organization_members for insert
  to authenticated
  with check (public.is_organization_admin(organization_id));

create policy "organization_members: org admin update"
  on public.organization_members for update
  to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

create policy "organization_members: org admin delete"
  on public.organization_members for delete
  to authenticated
  using (public.is_organization_admin(organization_id));

-- These tables contain OAuth tokens, provider API credentials, or notification
-- recipient PII. Runtime management already goes through requireAdmin() plus the
-- service-role client, so authenticated browser clients need no direct policy.
drop policy if exists "google_calendar_connection: admin read"
  on public.google_calendar_connection;
drop policy if exists "google_calendar_connection: admin write"
  on public.google_calendar_connection;

drop policy if exists "booking_notifications_admin_all"
  on public.booking_notifications;

drop policy if exists "integration_credentials: admin read"
  on public.integration_credentials;
drop policy if exists "integration_credentials: admin write"
  on public.integration_credentials;
drop policy if exists "integration_credentials: org admin read"
  on public.integration_credentials;
drop policy if exists "integration_credentials: org admin write"
  on public.integration_credentials;

drop policy if exists "quickbooks_connection: admin read"
  on public.quickbooks_connection;
drop policy if exists "quickbooks_connection: admin write"
  on public.quickbooks_connection;
drop policy if exists "quickbooks_connection: org admin read"
  on public.quickbooks_connection;
drop policy if exists "quickbooks_connection: org admin write"
  on public.quickbooks_connection;

-- No remaining policy depends on the legacy global helper. Keep it unavailable
-- through PostgREST so tenant users cannot invoke a platform-wide role oracle.
revoke all on function public.is_admin()
  from public, anon, authenticated;
