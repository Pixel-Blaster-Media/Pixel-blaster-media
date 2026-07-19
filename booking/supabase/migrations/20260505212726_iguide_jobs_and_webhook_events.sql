-- ============================================================================
-- Pixel Blaster Booking — iGUIDE jobs + webhook event inbox
--
-- Jobs track iGUIDEs we create from a booking, which gives the webhook an
-- exact immutable match later. Webhook events keep portal-created iGUIDEs from
-- disappearing when they cannot be matched safely on first delivery.
-- ============================================================================

create table if not exists public.iguide_jobs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  iguide_id text not null,
  alias text,
  work_order_id text,
  default_view_id text,
  status text not null default 'created',
  match_source text not null default 'booking_created',
  raw_create_response jsonb not null default '{}'::jsonb,
  raw_ready_event jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists iguide_jobs_iguide_id_key
  on public.iguide_jobs(iguide_id);

create unique index if not exists iguide_jobs_booking_id_key
  on public.iguide_jobs(booking_id);

create index if not exists iguide_jobs_work_order_idx
  on public.iguide_jobs(work_order_id)
  where work_order_id is not null;

drop trigger if exists iguide_jobs_set_updated_at on public.iguide_jobs;
create trigger iguide_jobs_set_updated_at
  before update on public.iguide_jobs
  for each row execute function public.set_updated_at();

alter table public.iguide_jobs enable row level security;

drop policy if exists "iguide_jobs: admin read" on public.iguide_jobs;
create policy "iguide_jobs: admin read"
  on public.iguide_jobs for select
  using (public.is_admin());

drop policy if exists "iguide_jobs: admin write" on public.iguide_jobs;
create policy "iguide_jobs: admin write"
  on public.iguide_jobs for all
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.iguide_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  iguide_id text not null,
  work_order_id text,
  alias text,
  payload_json jsonb not null default '{}'::jsonb,
  match_status text not null default 'unmatched',
  matched_booking_id uuid references public.bookings(id) on delete set null,
  match_source text,
  processed_at timestamptz,
  last_error text,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists iguide_webhook_events_dedupe_key
  on public.iguide_webhook_events(
    event_type,
    iguide_id,
    (coalesce(work_order_id, ''))
  );

create index if not exists iguide_webhook_events_match_status_idx
  on public.iguide_webhook_events(match_status);

drop trigger if exists iguide_webhook_events_set_updated_at on public.iguide_webhook_events;
create trigger iguide_webhook_events_set_updated_at
  before update on public.iguide_webhook_events
  for each row execute function public.set_updated_at();

alter table public.iguide_webhook_events enable row level security;

drop policy if exists "iguide_webhook_events: admin read" on public.iguide_webhook_events;
create policy "iguide_webhook_events: admin read"
  on public.iguide_webhook_events for select
  using (public.is_admin());

drop policy if exists "iguide_webhook_events: admin write" on public.iguide_webhook_events;
create policy "iguide_webhook_events: admin write"
  on public.iguide_webhook_events for all
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.iguide_jobs is
  'iGUIDE Portal jobs tied to bookings. Used for exact webhook matching and work-order tracking.';

comment on table public.iguide_webhook_events is
  'Raw iGUIDE webhook inbox. Unmatched portal-created tours stay here for review instead of being dropped.';;
