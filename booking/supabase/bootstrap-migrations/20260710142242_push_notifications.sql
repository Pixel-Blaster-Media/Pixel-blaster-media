-- One row per browser/device that an authenticated admin explicitly allows to
-- receive app notifications. Endpoints and encryption keys are secrets: the
-- browser may manage only its own rows, and the service role handles sends.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_organization_idx
  on public.push_subscriptions(organization_id);
create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions(profile_id);

drop trigger if exists push_subscriptions_set_updated_at
  on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions
  from public, anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions
  to authenticated;
grant all on table public.push_subscriptions to service_role;

drop policy if exists "push_subscriptions: owner read"
  on public.push_subscriptions;
create policy "push_subscriptions: owner read"
  on public.push_subscriptions
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and profile_id = (select auth.uid())
    and organization_id = public.current_organization_id()
  );

drop policy if exists "push_subscriptions: owner insert"
  on public.push_subscriptions;
create policy "push_subscriptions: owner insert"
  on public.push_subscriptions
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and profile_id = (select auth.uid())
    and organization_id = public.current_organization_id()
    and public.is_organization_admin(organization_id)
  );

drop policy if exists "push_subscriptions: owner update"
  on public.push_subscriptions;
create policy "push_subscriptions: owner update"
  on public.push_subscriptions
  for update
  to authenticated
  using (
    profile_id = (select auth.uid())
    and organization_id = public.current_organization_id()
  )
  with check (
    profile_id = (select auth.uid())
    and organization_id = public.current_organization_id()
    and public.is_organization_admin(organization_id)
  );

drop policy if exists "push_subscriptions: owner delete"
  on public.push_subscriptions;
create policy "push_subscriptions: owner delete"
  on public.push_subscriptions
  for delete
  to authenticated
  using (
    profile_id = (select auth.uid())
    and organization_id = public.current_organization_id()
  );

comment on table public.push_subscriptions is
  'Tenant-scoped Web Push endpoints for admins who enabled app notifications.';
