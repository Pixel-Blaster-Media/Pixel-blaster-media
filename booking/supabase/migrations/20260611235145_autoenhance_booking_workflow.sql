-- ============================================================================
-- Autoenhance booking workflow
-- ----------------------------------------------------------------------------
-- Tracks Autoenhance orders created from a booking, then records which finished
-- images have been pushed into the linked iGUIDE gallery. This lets the admin
-- page resume after a refresh and keeps the future background worker path
-- idempotent.
-- ============================================================================

create table if not exists public.autoenhance_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  booking_id uuid not null
    references public.bookings(id) on delete cascade,
  property_id uuid not null
    references public.properties(id) on delete cascade,
  order_id text not null,
  order_name text not null,
  upload_mode text not null default 'hdr'
    check (upload_mode in ('hdr', 'single')),
  status text not null default 'uploading',
  process_status text,
  brackets_per_image integer not null default 3,
  settings jsonb not null default '{}'::jsonb,
  bracket_ids text[] not null default '{}',
  uploaded_image_ids text[] not null default '{}',
  finished_image_ids text[] not null default '{}',
  iguide_portal_id text,
  iguide_uploaded_image_ids text[] not null default '{}',
  iguide_failed_image_ids text[] not null default '{}',
  last_iguide_push_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists autoenhance_batches_org_order_key
  on public.autoenhance_batches(organization_id, order_id);

create index if not exists autoenhance_batches_booking_idx
  on public.autoenhance_batches(booking_id, created_at desc);

create index if not exists autoenhance_batches_org_status_idx
  on public.autoenhance_batches(organization_id, status);

drop trigger if exists autoenhance_batches_set_updated_at
  on public.autoenhance_batches;
create trigger autoenhance_batches_set_updated_at
  before update on public.autoenhance_batches
  for each row execute function public.set_updated_at();

alter table public.autoenhance_batches enable row level security;

drop policy if exists "autoenhance_batches: org admin read"
  on public.autoenhance_batches;
create policy "autoenhance_batches: org admin read"
  on public.autoenhance_batches for select
  using (public.is_organization_admin(organization_id));

drop policy if exists "autoenhance_batches: org admin write"
  on public.autoenhance_batches;
create policy "autoenhance_batches: org admin write"
  on public.autoenhance_batches for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

create table if not exists public.autoenhance_iguide_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  batch_id uuid not null
    references public.autoenhance_batches(id) on delete cascade,
  booking_id uuid not null
    references public.bookings(id) on delete cascade,
  iguide_portal_id text not null,
  autoenhance_image_id text not null,
  filename text not null,
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'failed')),
  iguide_asset_name text,
  iguide_job_id text,
  process_complete boolean,
  warning text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists autoenhance_iguide_uploads_image_key
  on public.autoenhance_iguide_uploads(
    organization_id,
    batch_id,
    iguide_portal_id,
    autoenhance_image_id
  );

create index if not exists autoenhance_iguide_uploads_booking_idx
  on public.autoenhance_iguide_uploads(booking_id, created_at desc);

drop trigger if exists autoenhance_iguide_uploads_set_updated_at
  on public.autoenhance_iguide_uploads;
create trigger autoenhance_iguide_uploads_set_updated_at
  before update on public.autoenhance_iguide_uploads
  for each row execute function public.set_updated_at();

alter table public.autoenhance_iguide_uploads enable row level security;

drop policy if exists "autoenhance_iguide_uploads: org admin read"
  on public.autoenhance_iguide_uploads;
create policy "autoenhance_iguide_uploads: org admin read"
  on public.autoenhance_iguide_uploads for select
  using (public.is_organization_admin(organization_id));

drop policy if exists "autoenhance_iguide_uploads: org admin write"
  on public.autoenhance_iguide_uploads;
create policy "autoenhance_iguide_uploads: org admin write"
  on public.autoenhance_iguide_uploads for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

comment on table public.autoenhance_batches is
  'Autoenhance orders created from booking media uploads.';

comment on table public.autoenhance_iguide_uploads is
  'Per-photo Autoenhance-to-iGUIDE upload attempts for idempotency and diagnostics.';;
