-- ============================================================================
-- Pixel Assistant action audit log
-- ----------------------------------------------------------------------------
-- Confirmed assistant actions can now change bookings, pricing, availability,
-- and realtor memory. Keep a tenant-scoped record of what an admin approved.
-- ============================================================================

create table if not exists public.assistant_action_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  actor_profile_id uuid
    references public.profiles(id) on delete set null,
  action_type text not null,
  target_booking_id uuid
    references public.bookings(id) on delete set null,
  target_realtor_id uuid
    references public.profiles(id) on delete set null,
  label text not null default '',
  details text not null default '',
  payload jsonb not null default '{}'::jsonb,
  result_status text not null
    check (result_status in ('success', 'failed')),
  result_message text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists assistant_action_logs_org_created_idx
  on public.assistant_action_logs(organization_id, created_at desc);

create index if not exists assistant_action_logs_actor_idx
  on public.assistant_action_logs(actor_profile_id, created_at desc);

create index if not exists assistant_action_logs_booking_idx
  on public.assistant_action_logs(target_booking_id, created_at desc);

alter table public.assistant_action_logs enable row level security;

drop policy if exists "assistant_action_logs: org admin read"
  on public.assistant_action_logs;
drop policy if exists "assistant_action_logs: org admin insert"
  on public.assistant_action_logs;

create policy "assistant_action_logs: org admin read"
  on public.assistant_action_logs for select
  using (public.is_organization_admin(organization_id));

create policy "assistant_action_logs: org admin insert"
  on public.assistant_action_logs for insert
  with check (public.is_organization_admin(organization_id));

comment on table public.assistant_action_logs is
  'Tenant-scoped audit history of confirmed Pixel Assistant actions.';;
