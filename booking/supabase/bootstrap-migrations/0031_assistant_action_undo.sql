-- ============================================================================
-- Pixel Assistant undo support
-- ----------------------------------------------------------------------------
-- Store enough before-state for confirmed assistant actions to be reversed.
-- Existing log rows remain valid; only new reversible actions get undo payloads.
-- ============================================================================

alter table public.assistant_action_logs
  add column if not exists undo_payload jsonb,
  add column if not exists undone_at timestamptz,
  add column if not exists undone_by uuid
    references public.profiles(id) on delete set null,
  add column if not exists undo_result_message text;

create index if not exists assistant_action_logs_undone_idx
  on public.assistant_action_logs(organization_id, undone_at)
  where undo_payload is not null;

comment on column public.assistant_action_logs.undo_payload is
  'Reversible before-state for assistant actions that support undo.';

comment on column public.assistant_action_logs.undone_at is
  'Timestamp when this assistant action was reversed, if applicable.';
