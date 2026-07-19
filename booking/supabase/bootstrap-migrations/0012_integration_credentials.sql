-- ============================================================================
-- Pixel Blaster Booking — Phase 12: integration_credentials
-- ----------------------------------------------------------------------------
-- DB-managed home for static API credentials so the admin can rotate keys
-- without a Vercel env var dance + redeploy. Per-provider row holds an
-- opaque jsonb object; the runtime helper (lib/integrations/credentials.ts)
-- prefers the DB value but falls back to the matching env var when the row
-- is missing — so existing setups keep working until each key is migrated
-- through the admin UI.
--
-- Multi-tenant note: when we eventually make the booking system SaaS, this
-- table is one of the first to gain a tenant_id column + RLS policy on
-- it. The shape here (provider PK) keeps single-tenant simple while
-- leaving room for that evolution.
-- ============================================================================

create table public.integration_credentials (
  provider     text primary key,
  credentials  jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null
);

create trigger integration_credentials_set_updated_at
  before update on public.integration_credentials
  for each row execute function public.set_updated_at();

alter table public.integration_credentials enable row level security;

-- Admin-only — both reads and writes. Realtors should never have a way
-- to even see whether a credential is set. The runtime path uses the
-- service-role client so this RLS doesn't get in its own way.
create policy "integration_credentials: admin read"
  on public.integration_credentials for select
  using (public.is_admin());

create policy "integration_credentials: admin write"
  on public.integration_credentials for all
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.integration_credentials is
  'Per-provider API credentials editable from /admin/settings/integrations. JSONB shape varies by provider (e.g. {api_key: "..."} for Fotello, {app_id: "...", app_token: "...", webhook_secret: "..."} for iGuide).';
