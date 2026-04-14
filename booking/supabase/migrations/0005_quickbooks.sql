-- ============================================================================
-- Pixel Blaster Booking — Phase 7: QuickBooks Online integration
--
-- Three additions:
--
-- 1. `quickbooks_connection` — singleton row holding the OAuth refresh
--    token + current access token + realm (company) id. One row only;
--    if the admin ever needs to reconnect, we overwrite it in place.
--
-- 2. `service_prices` — a small lookup of service_id → price in cents.
--    Prices live in the DB rather than in code so the admin can edit
--    them in /admin/settings/pricing without a deploy.
--
-- 3. Invoice tracking columns on `bookings` — what invoice (if any) did
--    we create in QB for this shoot, what's its status, and the link
--    we can email the realtor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- quickbooks_connection (singleton)
-- ---------------------------------------------------------------------------
create table public.quickbooks_connection (
  -- Hardcoded primary key: there's only ever one QB connection per
  -- install. Using a fixed id lets us use .upsert() without worrying
  -- about stale rows.
  id                         int primary key default 1 check (id = 1),
  environment                text not null check (environment in ('sandbox','production')),
  realm_id                   text not null,
  refresh_token              text not null,
  access_token               text,
  access_token_expires_at    timestamptz,
  default_item_id            text,  -- QB Item (Service) used as the line-item ref
  connected_at               timestamptz not null default now(),
  connected_by               uuid references public.profiles(id) on delete set null,
  updated_at                 timestamptz not null default now()
);

create trigger quickbooks_connection_set_updated_at
  before update on public.quickbooks_connection
  for each row execute function public.set_updated_at();

-- RLS: admin-only. Server-side code uses the service role and bypasses
-- this anyway, but we gate the table hard because refresh_token is a
-- long-lived credential.
alter table public.quickbooks_connection enable row level security;

create policy "quickbooks_connection: admin read"
  on public.quickbooks_connection for select
  using (public.is_admin());

create policy "quickbooks_connection: admin write"
  on public.quickbooks_connection for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- service_prices
-- ---------------------------------------------------------------------------
create table public.service_prices (
  -- service_id matches lib/booking/services.ts (ServiceId | AddOnId). We
  -- deliberately don't FK-enforce against an enum here because the
  -- catalog lives in app code and can evolve faster than migrations.
  service_id      text primary key,
  price_cents     int not null default 0 check (price_cents >= 0),
  taxable         boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null
);

create trigger service_prices_set_updated_at
  before update on public.service_prices
  for each row execute function public.set_updated_at();

alter table public.service_prices enable row level security;

-- Any signed-in user can read prices (harmless — they'd see them on the
-- booking form anyway in a future phase). Only admins can write.
create policy "service_prices: authenticated read"
  on public.service_prices for select
  to authenticated
  using (true);

create policy "service_prices: admin write"
  on public.service_prices for all
  using (public.is_admin())
  with check (public.is_admin());

-- Seed every service + add-on from the current catalog with price = 0 so
-- the admin UI has rows to populate. Real prices are set in the admin
-- pricing page before the first invoice is created.
insert into public.service_prices (service_id, price_cents) values
  ('real_estate_photos', 0),
  ('iguide_tour',        0),
  ('floor_plan',         0),
  ('drone',              0),
  ('walkthrough_video',  0),
  ('twilight',           0),
  ('virtual_staging',    0),
  ('rush_24h',           0)
on conflict (service_id) do nothing;

-- ---------------------------------------------------------------------------
-- Invoice tracking on bookings
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists quickbooks_invoice_id          text,
  add column if not exists quickbooks_invoice_number      text,
  add column if not exists quickbooks_invoice_url         text,
  add column if not exists quickbooks_invoice_status      text,
  add column if not exists quickbooks_invoice_total_cents int,
  add column if not exists quickbooks_invoice_synced_at   timestamptz;

-- Uniqueness so re-running "Create invoice" on the same booking can't
-- accidentally duplicate the invoice in QB (the app-level code also
-- short-circuits, but this is a safety net).
create unique index if not exists bookings_qb_invoice_id_key
  on public.bookings(quickbooks_invoice_id)
  where quickbooks_invoice_id is not null;
