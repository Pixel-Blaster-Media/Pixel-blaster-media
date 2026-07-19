-- ============================================================================
-- iGUIDE tenant isolation
-- ----------------------------------------------------------------------------
-- The main SaaS tenant pass scoped bookings, properties, deliverables, catalog,
-- credentials, and calendars. These two iGUIDE operational tables were still
-- single-business tables, so org admins could see another company's iGUIDE
-- webhook inbox/jobs once a second organization existed.
-- ============================================================================

alter table public.iguide_jobs
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.iguide_jobs ij
set organization_id = b.organization_id
from public.bookings b
where ij.booking_id = b.id
  and ij.organization_id is null;

update public.iguide_jobs
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.iguide_jobs
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

drop index if exists public.iguide_jobs_iguide_id_key;

create unique index if not exists iguide_jobs_org_iguide_id_key
  on public.iguide_jobs(organization_id, iguide_id);

create index if not exists iguide_jobs_organization_idx
  on public.iguide_jobs(organization_id);

alter table public.iguide_webhook_events
  add column if not exists organization_id uuid
    references public.organizations(id) on delete cascade;

update public.iguide_webhook_events iwe
set organization_id = b.organization_id
from public.bookings b
where iwe.matched_booking_id = b.id
  and iwe.organization_id is null;

update public.iguide_webhook_events
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

alter table public.iguide_webhook_events
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

drop index if exists public.iguide_webhook_events_dedupe_key;

create unique index if not exists iguide_webhook_events_org_dedupe_key
  on public.iguide_webhook_events(
    organization_id,
    event_type,
    iguide_id,
    (coalesce(work_order_id, ''))
  );

create index if not exists iguide_webhook_events_organization_idx
  on public.iguide_webhook_events(organization_id);

drop policy if exists "iguide_jobs: admin read" on public.iguide_jobs;
drop policy if exists "iguide_jobs: admin write" on public.iguide_jobs;

create policy "iguide_jobs: org admin read"
  on public.iguide_jobs for select
  using (public.is_organization_admin(organization_id));

create policy "iguide_jobs: org admin write"
  on public.iguide_jobs for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "iguide_webhook_events: admin read"
  on public.iguide_webhook_events;
drop policy if exists "iguide_webhook_events: admin write"
  on public.iguide_webhook_events;

create policy "iguide_webhook_events: org admin read"
  on public.iguide_webhook_events for select
  using (public.is_organization_admin(organization_id));

create policy "iguide_webhook_events: org admin write"
  on public.iguide_webhook_events for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

comment on column public.iguide_jobs.organization_id is
  'Organization/business that owns this iGUIDE job.';

comment on column public.iguide_webhook_events.organization_id is
  'Organization/business that owns this iGUIDE webhook event.';;
