\ir autohdr-state-machine-bootstrap.sql

create table public.integration_credentials (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider text not null,
  credentials jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (organization_id, provider)
);
