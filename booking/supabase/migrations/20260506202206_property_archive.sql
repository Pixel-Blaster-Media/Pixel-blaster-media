alter table public.properties
  add column if not exists archived_at timestamptz;

create index if not exists properties_owner_archived_idx
  on public.properties(owner_id, archived_at);;
