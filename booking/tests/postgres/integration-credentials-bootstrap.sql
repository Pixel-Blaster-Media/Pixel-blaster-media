create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.organizations (
  id uuid primary key
);

create table public.profiles (
  id uuid primary key
);

create table public.integration_credentials (
  organization_id uuid not null references public.organizations(id),
  provider text not null,
  credentials jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (organization_id, provider)
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger integration_credentials_set_updated_at
before update on public.integration_credentials
for each row execute function public.set_updated_at();

insert into public.organizations(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
