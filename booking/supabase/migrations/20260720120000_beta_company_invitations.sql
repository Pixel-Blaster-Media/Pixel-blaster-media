-- Durable private-beta invitation state machine and hidden onboarding tenants.
-- Raw bearer tokens are never stored; only SHA-256 hex hashes are persisted.

set lock_timeout = '5s';

create table public.beta_company_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  invited_by uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'confirmed', 'unconfirmed')),
  delivery_attempted_at timestamptz,
  status text not null default 'issued'
    check (status in ('issued', 'provisioning', 'completed', 'revoked', 'reconciliation_required')),
  revoked_at timestamptz,
  consumed_at timestamptz,
  organization_id uuid unique,
  auth_user_id uuid unique,
  auth_provisioning_key text,
  provisioning_deadline timestamptz,
  admin_name text,
  company_name text,
  company_slug text,
  primary_color text,
  accent_color text,
  copy_catalog boolean,
  source_catalog_organization_id uuid,
  constraint beta_company_invites_email_normalized_check
    check (email = lower(btrim(email)) and position('@' in email) > 1),
  constraint beta_company_invites_token_hash_check
    check (length(token_hash) = 64 and token_hash ~ '^[0-9a-f]{64}$'),
  constraint beta_company_invites_auth_provisioning_key_check
    check (
      auth_provisioning_key is null
      or (
        length(auth_provisioning_key) = 64
        and auth_provisioning_key ~ '^[0-9a-f]{64}$'
      )
    ),
  constraint beta_company_invites_expiry_check check (expires_at > created_at),
  constraint beta_company_invites_revocation_check
    check ((status = 'revoked') = (revoked_at is not null)),
  constraint beta_company_invites_completion_check
    check ((status = 'completed') = (consumed_at is not null)),
  constraint beta_company_invites_terminal_state_check
    check (not (consumed_at is not null and revoked_at is not null))
);

alter table public.organizations
  add column lifecycle_status text not null default 'active'
    check (lifecycle_status in ('onboarding', 'active', 'suspended')),
  add column beta_invitation_id uuid unique
    references public.beta_company_invites(id) on delete restrict;

alter table public.beta_company_invites
  add constraint beta_company_invites_organization_fkey
  foreign key (organization_id) references public.organizations(id) on delete restrict;

create index beta_company_invites_email_created_idx
  on public.beta_company_invites (email, created_at desc);

alter table public.beta_company_invites enable row level security;

create or replace function public.guard_beta_auth_email_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(new.email));
  reservation record;
begin
  if normalized_email is null or normalized_email = '' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_email, 0)
  );

  select b.id, b.status, b.auth_provisioning_key
  into reservation
  from public.beta_company_invites b
  where b.email = normalized_email
    and b.status in ('issued', 'provisioning', 'reconciliation_required')
  order by b.created_at desc
  limit 1;

  if not found then
    return new;
  end if;

  if reservation.status <> 'provisioning'
     or reservation.auth_provisioning_key is null
     or coalesce(new.raw_user_meta_data ->> 'beta_provisioning_key', '')
        <> reservation.auth_provisioning_key then
    raise exception 'email is reserved for beta company provisioning';
  end if;

  return new;
end;
$$;

create trigger guard_beta_auth_email_reservation
before insert or update of email on auth.users
for each row execute function public.guard_beta_auth_email_reservation();

create or replace function public.protect_beta_organization_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and (
       new.lifecycle_status is distinct from old.lifecycle_status
       or new.beta_invitation_id is distinct from old.beta_invitation_id
     ) then
    raise exception 'organization lifecycle is platform-controlled';
  end if;
  return new;
end;
$$;

create trigger protect_beta_organization_lifecycle
before update of lifecycle_status, beta_invitation_id on public.organizations
for each row execute function public.protect_beta_organization_lifecycle();

create or replace function public.is_beta_platform_actor(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.organization_members om
      on om.profile_id = p.id
     and om.organization_id = p.organization_id
    where p.id = p_actor_id
      and p.organization_id = '00000000-0000-0000-0000-000000000001'::uuid
      and p.archived_at is null
      and om.role in ('owner', 'admin')
  );
$$;

create or replace function public.find_beta_auth_user_by_email(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(p_email));
  found_count integer;
  auth_row jsonb;
begin
  if normalized_email = '' or position('@' in normalized_email) <= 1 then
    raise exception 'invalid beta invitation email';
  end if;
  select count(*) into found_count
  from auth.users u
  where lower(u.email) = normalized_email;
  if found_count > 1 then
    raise exception 'ambiguous beta auth identity';
  end if;
  select pg_catalog.jsonb_build_object(
    'user_id', u.id,
    'company_invitation_id', u.raw_app_meta_data ->> 'company_invitation_id',
    'has_profile', exists(select 1 from public.profiles p where p.id = u.id)
  ) into auth_row
  from auth.users u
  where lower(u.email) = normalized_email;
  return auth_row;
end;
$$;

create or replace function public.issue_beta_company_invite(
  p_email text,
  p_token_hash text,
  p_invited_by uuid,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(p_email));
  invite_id uuid;
begin
  if normalized_email = '' or position('@' in normalized_email) <= 1 then
    raise exception 'invalid beta invitation email';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid beta invitation token hash';
  end if;
  if p_expires_at <= pg_catalog.now() + interval '1 hour'
     or p_expires_at > pg_catalog.now() + interval '14 days' then
    raise exception 'invalid beta invitation expiry';
  end if;
  if not public.is_beta_platform_actor(p_invited_by) then
    raise exception 'invalid beta invitation actor';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_email, 0)
  );

  if exists (
    select 1 from auth.users u where lower(u.email) = normalized_email
  ) then
    raise exception 'that email already has an Auth identity';
  end if;

  update public.beta_company_invites
  set status = 'revoked', revoked_at = pg_catalog.now()
  where email = normalized_email
    and status = 'issued'
    and expires_at <= pg_catalog.now();

  if exists (
    select 1 from public.beta_company_invites b
    where b.email = normalized_email
      and b.status in ('provisioning', 'reconciliation_required')
  ) then
    raise exception 'that email already has company provisioning in progress';
  end if;

  select b.id into invite_id
  from public.beta_company_invites b
  where b.email = normalized_email and b.status = 'issued'
  order by b.created_at desc
  limit 1;
  if invite_id is not null then
    return pg_catalog.jsonb_build_object(
      'id', invite_id,
      'created', false,
      'expires_at', (select b.expires_at from public.beta_company_invites b where b.id = invite_id),
      'delivery_status', (select b.delivery_status from public.beta_company_invites b where b.id = invite_id)
    );
  end if;

  insert into public.beta_company_invites (
    email, token_hash, invited_by, expires_at
  ) values (
    normalized_email, p_token_hash, p_invited_by, p_expires_at
  ) returning id into invite_id;

  return pg_catalog.jsonb_build_object(
    'id', invite_id,
    'created', true,
    'expires_at', p_expires_at,
    'delivery_status', 'pending'
  );
end;
$$;

create or replace function public.mark_beta_company_invite_delivery(
  p_invite_id uuid,
  p_delivery_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_delivery_status not in ('confirmed', 'unconfirmed') then
    return false;
  end if;
  update public.beta_company_invites
  set delivery_status = p_delivery_status,
      delivery_attempted_at = pg_catalog.now()
  where id = p_invite_id and status <> 'revoked';
  return found;
end;
$$;

create or replace function public.begin_beta_company_onboarding(
  p_token_hash text,
  p_admin_name text,
  p_company_name text,
  p_company_slug text,
  p_primary_color text,
  p_accent_color text,
  p_copy_catalog boolean,
  p_source_catalog_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.beta_company_invites%rowtype;
  normalized_admin_name text := btrim(p_admin_name);
  normalized_company_name text := btrim(p_company_name);
  normalized_slug text := lower(btrim(p_company_slug));
  normalized_primary text := lower(btrim(p_primary_color));
  normalized_accent text := lower(btrim(p_accent_color));
  new_organization_id uuid;
  new_auth_provisioning_key text;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid beta invitation';
  end if;

  select * into invite
  from public.beta_company_invites b
  where b.token_hash = p_token_hash
  for update;

  if not found
     or invite.revoked_at is not null
     or invite.consumed_at is not null
     or invite.expires_at <= pg_catalog.now()
     or invite.status not in ('issued', 'provisioning') then
    raise exception 'invalid beta invitation';
  end if;
  if length(normalized_admin_name) < 2 or length(normalized_admin_name) > 80
     or length(normalized_company_name) < 2 or length(normalized_company_name) > 80
     or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(normalized_slug) > 60
     or normalized_primary !~ '^#[0-9a-f]{6}$'
     or normalized_accent !~ '^#[0-9a-f]{6}$'
     or not exists (
       select 1 from public.organizations o
       where o.id = p_source_catalog_organization_id
     ) then
    raise exception 'invalid beta company details';
  end if;

  if invite.status = 'provisioning' then
    if invite.provisioning_deadline <= pg_catalog.now() then
      update public.beta_company_invites
      set status = 'reconciliation_required'
      where id = invite.id;
      return pg_catalog.jsonb_build_object(
        'invitation_id', invite.id,
        'organization_id', invite.organization_id,
        'email', invite.email,
        'state', 'reconciliation_required'
      );
    end if;
    if invite.admin_name is distinct from normalized_admin_name
       or invite.company_name is distinct from normalized_company_name
       or invite.company_slug is distinct from normalized_slug
       or invite.primary_color is distinct from normalized_primary
       or invite.accent_color is distinct from normalized_accent
       or invite.copy_catalog is distinct from p_copy_catalog
       or invite.source_catalog_organization_id is distinct from p_source_catalog_organization_id then
      raise exception 'company inputs do not match the provisioning attempt';
    end if;
    return pg_catalog.jsonb_build_object(
      'invitation_id', invite.id,
      'organization_id', invite.organization_id,
      'email', invite.email,
      'auth_provisioning_key', invite.auth_provisioning_key,
      'state', 'resumed'
    );
  end if;

  new_organization_id := gen_random_uuid();
  new_auth_provisioning_key := encode(
    extensions.gen_random_bytes(32),
    'hex'
  );
  insert into public.organizations (
    id, name, slug, primary_color, accent_color,
    email_from_name, reply_to_email, admin_notification_email,
    lifecycle_status, beta_invitation_id
  ) values (
    new_organization_id, normalized_company_name, normalized_slug,
    normalized_primary, normalized_accent, normalized_company_name,
    invite.email, invite.email, 'onboarding', invite.id
  );

  update public.beta_company_invites
  set status = 'provisioning',
      organization_id = new_organization_id,
      auth_provisioning_key = new_auth_provisioning_key,
      provisioning_deadline = least(expires_at, pg_catalog.now() + interval '30 minutes'),
      admin_name = normalized_admin_name,
      company_name = normalized_company_name,
      company_slug = normalized_slug,
      primary_color = normalized_primary,
      accent_color = normalized_accent,
      copy_catalog = p_copy_catalog,
      source_catalog_organization_id = p_source_catalog_organization_id
  where id = invite.id;

  return pg_catalog.jsonb_build_object(
    'invitation_id', invite.id,
    'organization_id', new_organization_id,
    'email', invite.email,
    'auth_provisioning_key', new_auth_provisioning_key,
    'state', 'started'
  );
end;
$$;

create or replace function public.complete_beta_company_onboarding(
  p_token_hash text,
  p_auth_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.beta_company_invites%rowtype;
begin
  select * into invite
  from public.beta_company_invites b
  where b.token_hash = p_token_hash
  for update;

  if not found then return false; end if;
  if invite.status = 'completed' then
    return invite.auth_user_id = p_auth_user_id;
  end if;
  if invite.status <> 'provisioning'
     or invite.revoked_at is not null
     or invite.consumed_at is not null
     or invite.provisioning_deadline <= pg_catalog.now() then
    return false;
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = p_auth_user_id
      and lower(u.email) = invite.email
      and u.raw_app_meta_data ->> 'company_invitation_id' = invite.id::text
  ) then
    raise exception 'beta invitation identity mismatch';
  end if;
  if not exists (
    select 1
    from public.organization_members om
    join public.profiles p on p.id = om.profile_id
    where om.organization_id = invite.organization_id
      and om.profile_id = p_auth_user_id
      and om.role = 'owner'
      and p.organization_id = invite.organization_id
      and p.archived_at is null
      and lower(p.email) = invite.email
  ) then
    raise exception 'beta invitation owner mismatch';
  end if;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    - 'beta_provisioning_key'
  where id = p_auth_user_id;

  update public.beta_company_invites
  set status = 'completed',
      auth_user_id = p_auth_user_id,
      auth_provisioning_key = null,
      consumed_at = pg_catalog.now()
  where id = invite.id;
  return true;
end;
$$;

create or replace function public.resume_beta_company_onboarding(
  p_invite_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_beta_platform_actor(p_actor_id) then
    raise exception 'invalid beta reconciliation actor';
  end if;
  update public.beta_company_invites b
  set status = 'provisioning',
      provisioning_deadline = pg_catalog.now() + interval '30 minutes'
  where b.id = p_invite_id
    and (
      b.status = 'reconciliation_required'
      or (
        b.status = 'provisioning'
        and b.provisioning_deadline <= pg_catalog.now()
      )
    )
    and b.organization_id is not null;
  return found;
end;
$$;

create or replace function public.revoke_beta_company_invite(
  p_invite_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_beta_platform_actor(p_actor_id) then
    raise exception 'invalid beta invitation actor';
  end if;
  update public.beta_company_invites
  set status = 'revoked', revoked_at = pg_catalog.now()
  where id = p_invite_id and status = 'issued';
  return found;
end;
$$;

create or replace function public.activate_beta_company(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_beta_platform_actor(p_actor_id) then
    raise exception 'invalid beta activation actor';
  end if;
  update public.organizations o
  set lifecycle_status = 'active'
  where o.id = p_organization_id
    and o.lifecycle_status = 'onboarding'
    and exists (
      select 1 from public.beta_company_invites b
      where b.id = o.beta_invitation_id
        and b.status = 'completed'
        and b.organization_id = o.id
    );
  return found;
end;
$$;

revoke all on table public.beta_company_invites from public, anon, authenticated;
grant select on table public.beta_company_invites to service_role;

revoke all on function public.guard_beta_auth_email_reservation() from public, anon, authenticated;
revoke all on function public.protect_beta_organization_lifecycle() from public, anon, authenticated;
revoke all on function public.is_beta_platform_actor(uuid) from public, anon, authenticated;
grant execute on function public.is_beta_platform_actor(uuid) to service_role;
revoke all on function public.find_beta_auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.find_beta_auth_user_by_email(text) to service_role;

revoke all on function public.issue_beta_company_invite(text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.issue_beta_company_invite(text, text, uuid, timestamptz) to service_role;
revoke all on function public.mark_beta_company_invite_delivery(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_beta_company_invite_delivery(uuid, text) to service_role;
revoke all on function public.begin_beta_company_onboarding(text, text, text, text, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.begin_beta_company_onboarding(text, text, text, text, text, text, boolean, uuid) to service_role;
revoke all on function public.complete_beta_company_onboarding(text, uuid) from public, anon, authenticated;
grant execute on function public.complete_beta_company_onboarding(text, uuid) to service_role;
revoke all on function public.resume_beta_company_onboarding(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resume_beta_company_onboarding(uuid, uuid) to service_role;
revoke all on function public.revoke_beta_company_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_beta_company_invite(uuid, uuid) to service_role;
revoke all on function public.activate_beta_company(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_beta_company(uuid, uuid) to service_role;

comment on table public.beta_company_invites is
  'Private-beta invitation state. Raw bearer and provider tokens are never stored.';

reset lock_timeout;
