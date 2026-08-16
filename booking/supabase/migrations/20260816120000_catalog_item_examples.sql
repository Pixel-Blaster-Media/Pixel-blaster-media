set local lock_timeout = '5s';
set local statement_timeout = '30s';

create unique index if not exists catalog_items_id_organization_unique
  on public.catalog_items (id, organization_id);

create table public.catalog_item_examples (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  catalog_item_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text,
  kind text not null check (kind in ('video', 'interactive', 'link')),
  source_type text not null check (source_type in ('external_url', 'cloudflare_stream')),
  external_url text,
  stream_uid text,
  status text not null default 'ready' check (status in ('uploading', 'ready', 'failed', 'deleting')),
  active boolean not null default true,
  display_order integer not null default 0 check (display_order between 0 and 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_item_examples_catalog_tenant_fk
    foreign key (catalog_item_id, organization_id)
    references public.catalog_items(id, organization_id)
    on delete restrict,
  constraint catalog_item_examples_description_length
    check (description is null or char_length(description) <= 500),
  constraint catalog_item_examples_position_unique
    unique (organization_id, catalog_item_id, display_order),
  constraint catalog_item_examples_source_shape
    check (
      (source_type = 'external_url'
        and external_url like 'https://%'
        and char_length(external_url) <= 2048
        and stream_uid is null
        and status = 'ready')
      or
      (source_type = 'cloudflare_stream'
        and external_url is null
        and stream_uid ~ '^[0-9a-f]{32}$')
    )
);

create index catalog_item_examples_public_lookup_idx
  on public.catalog_item_examples (organization_id, catalog_item_id, active, status, display_order);

create unique index catalog_item_examples_stream_uid_unique
  on public.catalog_item_examples (stream_uid)
  where stream_uid is not null;
create unique index catalog_item_examples_id_organization_unique
  on public.catalog_item_examples (id, organization_id);

create table public.catalog_stream_upload_claims (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  catalog_item_id uuid,
  example_id uuid,
  stream_uid text unique check (stream_uid is null or stream_uid ~ '^[0-9a-f]{32}$'),
  state text not null default 'claimed'
    check (state in ('claimed', 'provider_unknown', 'provisioned', 'attached', 'completed', 'cleanup_required', 'cleaned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_stream_upload_claims_catalog_tenant_fk
    foreign key (catalog_item_id, organization_id)
    references public.catalog_items(id, organization_id)
    on delete set null (catalog_item_id),
  constraint catalog_stream_upload_claims_example_tenant_fk
    foreign key (example_id, organization_id)
    references public.catalog_item_examples(id, organization_id)
    on delete set null (example_id)
);

create index catalog_stream_upload_claims_rate_idx
  on public.catalog_stream_upload_claims (organization_id, created_at desc);
create index catalog_stream_upload_claims_cleanup_idx
  on public.catalog_stream_upload_claims (state, created_at)
  where state in ('provider_unknown', 'cleanup_required');

alter table public.catalog_stream_upload_claims enable row level security;
alter table public.catalog_stream_upload_claims force row level security;
revoke all on table public.catalog_stream_upload_claims from public, anon, authenticated;
grant select, insert, update on table public.catalog_stream_upload_claims to service_role;

create or replace function public.claim_catalog_stream_upload(
  p_claim_id uuid,
  p_organization_id uuid,
  p_catalog_item_id uuid
) returns text
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));

  if exists (select 1 from public.catalog_stream_upload_claims where id = p_claim_id) then
    return 'duplicate';
  end if;
  if not exists (
    select 1 from public.catalog_items
    where id = p_catalog_item_id and organization_id = p_organization_id
  ) then
    return 'catalog_not_found';
  end if;
  if (
    select count(*) from public.catalog_stream_upload_claims
    where organization_id = p_organization_id
      and created_at >= now() - interval '1 hour'
  ) >= 10 then
    return 'rate_limited';
  end if;
  if (
    select count(*) from public.catalog_stream_upload_claims
    where organization_id = p_organization_id
      and state in ('claimed', 'provider_unknown', 'provisioned', 'attached')
  ) >= 2 then
    return 'too_many_pending';
  end if;
  if (
    select count(*) from public.catalog_item_examples
    where organization_id = p_organization_id
      and catalog_item_id = p_catalog_item_id
  ) >= 8 then
    return 'max_examples';
  end if;

  insert into public.catalog_stream_upload_claims (
    id, organization_id, catalog_item_id
  ) values (
    p_claim_id, p_organization_id, p_catalog_item_id
  );
  return 'claimed';
end;
$$;

revoke all on function public.claim_catalog_stream_upload(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_catalog_stream_upload(uuid, uuid, uuid)
  to service_role;

create or replace function public.attach_catalog_stream_upload(
  p_claim_id uuid,
  p_organization_id uuid,
  p_catalog_item_id uuid,
  p_stream_uid text,
  p_title text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_example_id uuid;
  v_display_order integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-stream-attach:' || p_catalog_item_id::text, 0)
  );

  perform 1
  from public.catalog_stream_upload_claims
  where id = p_claim_id
    and organization_id = p_organization_id
    and catalog_item_id = p_catalog_item_id
    and stream_uid = p_stream_uid
    and state = 'provisioned'
  for update;

  if not found then
    return null;
  end if;

  select candidate
  into v_display_order
  from generate_series(0, 7) as candidate
  where not exists (
    select 1
    from public.catalog_item_examples
    where organization_id = p_organization_id
      and catalog_item_id = p_catalog_item_id
      and display_order = candidate
  )
  order by candidate
  limit 1;

  if v_display_order is null then
    return null;
  end if;

  insert into public.catalog_item_examples (
    organization_id, catalog_item_id, title, description, kind, source_type,
    stream_uid, status, active, display_order
  ) values (
    p_organization_id, p_catalog_item_id, p_title, nullif(p_description, ''),
    'video', 'cloudflare_stream', p_stream_uid, 'uploading', true, v_display_order
  )
  returning id into v_example_id;

  update public.catalog_stream_upload_claims
  set example_id = v_example_id,
      state = 'attached',
      updated_at = now()
  where id = p_claim_id
    and organization_id = p_organization_id
    and catalog_item_id = p_catalog_item_id
    and stream_uid = p_stream_uid
    and state = 'provisioned';

  if not found then
    raise exception 'catalog stream upload claim changed during attachment';
  end if;

  return v_example_id;
end;
$$;

revoke all on function public.attach_catalog_stream_upload(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_catalog_stream_upload(uuid, uuid, uuid, text, text, text)
  to service_role;

create or replace function public.finalize_catalog_stream_upload(
  p_example_id uuid,
  p_organization_id uuid,
  p_stream_uid text,
  p_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_outcome not in ('ready', 'failed') then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('catalog-stream-example:' || p_example_id::text, 0)
  );

  if exists (
    select 1
    from public.catalog_stream_upload_claims c
    join public.catalog_item_examples e
      on e.id = c.example_id and e.organization_id = c.organization_id
    where c.organization_id = p_organization_id
      and c.example_id = p_example_id
      and c.stream_uid = p_stream_uid
      and c.state = 'completed'
      and e.status = p_outcome
  ) then
    return true;
  end if;

  perform 1
  from public.catalog_stream_upload_claims
  where organization_id = p_organization_id
    and example_id = p_example_id
    and stream_uid = p_stream_uid
    and state = 'attached'
  for update;
  if not found then return false; end if;

  perform 1
  from public.catalog_item_examples
  where organization_id = p_organization_id
    and id = p_example_id
    and stream_uid = p_stream_uid
    and status = 'uploading'
    and active = true
  for update;
  if not found then return false; end if;

  update public.catalog_stream_upload_claims
  set state = 'completed', updated_at = now()
  where organization_id = p_organization_id
    and example_id = p_example_id
    and stream_uid = p_stream_uid
    and state = 'attached';
  if not found then raise exception 'catalog Stream claim finalization race'; end if;

  update public.catalog_item_examples
  set status = p_outcome,
      active = (p_outcome = 'ready')
  where organization_id = p_organization_id
    and id = p_example_id
    and stream_uid = p_stream_uid
    and status = 'uploading'
    and active = true;
  if not found then raise exception 'catalog Stream example finalization race'; end if;

  return true;
end;
$$;

revoke all on function public.finalize_catalog_stream_upload(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_catalog_stream_upload(uuid, uuid, text, text)
  to service_role;

create or replace function public.begin_catalog_stream_example_deletion(
  p_example_id uuid,
  p_organization_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stream_uid text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-stream-example:' || p_example_id::text, 0)
  );

  select stream_uid
  into v_stream_uid
  from public.catalog_item_examples
  where organization_id = p_organization_id
    and id = p_example_id
    and source_type = 'cloudflare_stream'
    and stream_uid is not null
    and status in ('uploading', 'ready', 'failed', 'deleting')
  for update;
  if not found then return null; end if;

  perform 1
  from public.catalog_stream_upload_claims
  where organization_id = p_organization_id
    and example_id = p_example_id
    and stream_uid = v_stream_uid
    and state in ('attached', 'completed', 'cleanup_required')
  for update;
  if not found then return null; end if;

  update public.catalog_item_examples
  set active = false, status = 'deleting'
  where organization_id = p_organization_id
    and id = p_example_id
    and stream_uid = v_stream_uid;

  update public.catalog_stream_upload_claims
  set state = 'cleanup_required', updated_at = now()
  where organization_id = p_organization_id
    and example_id = p_example_id
    and stream_uid = v_stream_uid
    and state in ('attached', 'completed', 'cleanup_required');
  if not found then raise exception 'catalog Stream deletion transition race'; end if;

  return v_stream_uid;
end;
$$;

revoke all on function public.begin_catalog_stream_example_deletion(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_catalog_stream_example_deletion(uuid, uuid)
  to service_role;

alter table public.catalog_item_examples enable row level security;
alter table public.catalog_item_examples force row level security;

revoke all on table public.catalog_item_examples from public, anon, authenticated;
grant select, insert, update, delete on table public.catalog_item_examples to service_role;

comment on table public.catalog_item_examples is
  'Tenant-scoped examples attached to bookable catalog items. Public booking reads use server-side service access; clients never mutate this table directly.';
comment on table public.catalog_stream_upload_claims is
  'Durable, tenant-scoped Stream provisioning ledger used for quotas, idempotency, and orphan cleanup.';
