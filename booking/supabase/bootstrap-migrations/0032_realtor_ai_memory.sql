-- ============================================================================
-- Structured realtor memory
-- ----------------------------------------------------------------------------
-- Keep admin-controlled client preferences in a structured JSON object so the
-- booking concierge, daily brief, and Pixel Assistant can use them safely.
-- The column lives on profiles, so existing tenant-scoped profile RLS applies.
-- ============================================================================

alter table public.profiles
  add column if not exists ai_memory jsonb not null default '{}'::jsonb;

comment on column public.profiles.ai_memory is
  'Admin-managed structured realtor preferences used by AI booking and workflow assistants.';
