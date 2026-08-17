set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.catalog_item_example_placements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  catalog_item_id uuid not null,
  source_example_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  display_order integer not null check (display_order between 0 and 7),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_item_example_placements_catalog_tenant_fk
    foreign key (catalog_item_id, organization_id)
    references public.catalog_items(id, organization_id)
    on delete restrict,
  constraint catalog_item_example_placements_source_tenant_fk
    foreign key (source_example_id, organization_id)
    references public.catalog_item_examples(id, organization_id)
    on delete restrict,
  constraint catalog_item_example_placements_source_unique
    unique (organization_id, catalog_item_id, source_example_id),
  constraint catalog_item_example_placements_position_unique
    unique (organization_id, catalog_item_id, display_order)
);

create index catalog_item_example_placements_source_idx
  on public.catalog_item_example_placements (organization_id, source_example_id)
  where active = true;

alter table public.catalog_item_example_placements enable row level security;
alter table public.catalog_item_example_placements force row level security;
revoke all on table public.catalog_item_example_placements from public, anon, authenticated;
grant select, insert, update, delete on table public.catalog_item_example_placements to service_role;

create or replace function public.next_catalog_example_display_order(
  p_organization_id uuid,
  p_catalog_item_id uuid
)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select candidate
  from generate_series(0, 7) as candidate
  where not exists (
    select 1
    from public.catalog_item_examples e
    where e.organization_id = p_organization_id
      and e.catalog_item_id = p_catalog_item_id
      and e.display_order = candidate
  )
  and not exists (
    select 1
    from public.catalog_item_example_placements p
    where p.organization_id = p_organization_id
      and p.catalog_item_id = p_catalog_item_id
      and p.display_order = candidate
  )
  order by candidate
  limit 1
$$;
revoke all on function public.next_catalog_example_display_order(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.next_catalog_example_display_order(uuid, uuid)
  to service_role;

create or replace function public.guard_catalog_example_placement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_catalog_item_id uuid;
  v_total integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || new.organization_id::text || ':' || new.catalog_item_id::text, 0)
  );

  select e.catalog_item_id
  into v_source_catalog_item_id
  from public.catalog_item_examples e
  where e.id = new.source_example_id
    and e.organization_id = new.organization_id
    and e.source_type = 'cloudflare_stream'
    and e.kind = 'video'
    and e.stream_uid is not null
    and e.status = 'ready'
    and e.active = true
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'shared catalog video source is unavailable';
  end if;
  if new.catalog_item_id = v_source_catalog_item_id then
    raise exception using errcode = 'P0001', message = 'source catalog item already owns this video';
  end if;

  if exists (
    select 1 from public.catalog_item_examples e
    where e.organization_id = new.organization_id
      and e.catalog_item_id = new.catalog_item_id
      and e.display_order = new.display_order
  ) then
    raise exception using errcode = 'P0001', message = 'catalog example display position is occupied';
  end if;

  select
    (select count(*) from public.catalog_item_examples e
      where e.organization_id = new.organization_id and e.catalog_item_id = new.catalog_item_id)
    +
    (select count(*) from public.catalog_item_example_placements p
      where p.organization_id = new.organization_id
        and p.catalog_item_id = new.catalog_item_id
        and (tg_op = 'INSERT' or p.id <> new.id))
  into v_total;
  if v_total >= 8 then
    raise exception using errcode = 'P0001', message = 'catalog item already has eight examples';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_catalog_example_placement
before insert or update on public.catalog_item_example_placements
for each row execute function public.guard_catalog_example_placement();

create or replace function public.guard_catalog_example_base_slot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
begin
  if tg_op = 'UPDATE'
     and new.organization_id = old.organization_id
     and new.catalog_item_id = old.catalog_item_id
     and new.display_order = old.display_order then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || new.organization_id::text || ':' || new.catalog_item_id::text, 0)
  );
  if exists (
    select 1 from public.catalog_item_example_placements p
    where p.organization_id = new.organization_id
      and p.catalog_item_id = new.catalog_item_id
      and p.display_order = new.display_order
  ) then
    raise exception using errcode = 'P0001', message = 'catalog example display position is occupied';
  end if;

  select
    (select count(*) from public.catalog_item_examples e
      where e.organization_id = new.organization_id
        and e.catalog_item_id = new.catalog_item_id
        and (tg_op = 'INSERT' or e.id <> new.id))
    +
    (select count(*) from public.catalog_item_example_placements p
      where p.organization_id = new.organization_id and p.catalog_item_id = new.catalog_item_id)
  into v_total;
  if v_total >= 8 then
    raise exception using errcode = 'P0001', message = 'catalog item already has eight examples';
  end if;
  return new;
end;
$$;

create trigger guard_catalog_example_base_slot
before insert or update of organization_id, catalog_item_id, display_order
on public.catalog_item_examples
for each row execute function public.guard_catalog_example_base_slot();

create or replace function public.protect_shared_catalog_stream_source()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.catalog_item_example_placements p
    where p.organization_id = old.organization_id
      and p.source_example_id = old.id
  ) then
    if tg_op = 'DELETE'
       or new.organization_id is distinct from old.organization_id
       or new.catalog_item_id is distinct from old.catalog_item_id
       or new.stream_uid is distinct from old.stream_uid
       or new.source_type is distinct from old.source_type
       or new.kind is distinct from old.kind
       or new.status is distinct from old.status
       or new.active is distinct from old.active then
      raise exception using errcode = 'P0001', message = 'catalog video is still shared';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger protect_shared_catalog_stream_source
before update or delete on public.catalog_item_examples
for each row execute function public.protect_shared_catalog_stream_source();

create or replace function public.attach_external_catalog_example(
  p_organization_id uuid,
  p_catalog_item_id uuid,
  p_title text,
  p_description text,
  p_kind text,
  p_external_url text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_display_order integer;
  v_id uuid;
begin
  if p_kind not in ('video', 'interactive', 'link')
     or char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(coalesce(p_description, '')) > 500
     or p_external_url not like 'https://%'
     or char_length(p_external_url) > 2048 then
    return null;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || p_organization_id::text || ':' || p_catalog_item_id::text, 0)
  );
  if not exists (
    select 1 from public.catalog_items
    where id = p_catalog_item_id and organization_id = p_organization_id
  ) then return null; end if;
  v_display_order := public.next_catalog_example_display_order(p_organization_id, p_catalog_item_id);
  if v_display_order is null then return null; end if;

  insert into public.catalog_item_examples (
    organization_id, catalog_item_id, title, description, kind, source_type,
    external_url, status, active, display_order
  ) values (
    p_organization_id, p_catalog_item_id, btrim(p_title), nullif(btrim(p_description), ''),
    p_kind, 'external_url', p_external_url, 'ready', true, v_display_order
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.attach_external_catalog_example(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_external_catalog_example(uuid, uuid, text, text, text, text)
  to service_role;

create or replace function public.attach_shared_catalog_stream_example(
  p_organization_id uuid,
  p_catalog_item_id uuid,
  p_source_example_id uuid,
  p_title text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_display_order integer;
  v_id uuid;
begin
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(coalesce(p_description, '')) > 500 then
    return null;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-stream-example:' || p_source_example_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || p_organization_id::text || ':' || p_catalog_item_id::text, 0)
  );
  select id into v_id
  from public.catalog_item_example_placements
  where organization_id = p_organization_id
    and catalog_item_id = p_catalog_item_id
    and source_example_id = p_source_example_id;
  if found then return v_id; end if;
  v_display_order := public.next_catalog_example_display_order(p_organization_id, p_catalog_item_id);
  if v_display_order is null then return null; end if;

  insert into public.catalog_item_example_placements (
    organization_id, catalog_item_id, source_example_id, title, description,
    display_order, active
  ) values (
    p_organization_id, p_catalog_item_id, p_source_example_id, btrim(p_title),
    nullif(btrim(p_description), ''), v_display_order, true
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.attach_shared_catalog_stream_example(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_shared_catalog_stream_example(uuid, uuid, uuid, text, text)
  to service_role;

create or replace function public.remove_shared_catalog_stream_placement(
  p_organization_id uuid,
  p_placement_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_catalog_item_id uuid;
  v_source_example_id uuid;
begin
  select catalog_item_id, source_example_id
  into v_catalog_item_id, v_source_example_id
  from public.catalog_item_example_placements
  where id = p_placement_id and organization_id = p_organization_id
  for update;
  if not found then return false; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('catalog-stream-example:' || v_source_example_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || p_organization_id::text || ':' || v_catalog_item_id::text, 0)
  );
  delete from public.catalog_item_example_placements
  where id = p_placement_id and organization_id = p_organization_id;
  return found;
end;
$$;
revoke all on function public.remove_shared_catalog_stream_placement(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_shared_catalog_stream_placement(uuid, uuid)
  to service_role;

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
  perform pg_advisory_xact_lock(
    hashtextextended('catalog-example-slots:' || p_organization_id::text || ':' || p_catalog_item_id::text, 0)
  );
  if exists (select 1 from public.catalog_stream_upload_claims where id = p_claim_id) then return 'duplicate'; end if;
  if not exists (
    select 1 from public.catalog_items where id = p_catalog_item_id and organization_id = p_organization_id
  ) then return 'catalog_not_found'; end if;
  if (
    select count(*) from public.catalog_stream_upload_claims
    where organization_id = p_organization_id and created_at >= now() - interval '1 hour'
  ) >= 10 then return 'rate_limited'; end if;
  if (
    select count(*) from public.catalog_stream_upload_claims
    where organization_id = p_organization_id
      and state in ('claimed', 'provider_unknown', 'provisioned', 'attached')
  ) >= 2 then return 'too_many_pending'; end if;
  if public.next_catalog_example_display_order(p_organization_id, p_catalog_item_id) is null then
    return 'max_examples';
  end if;
  insert into public.catalog_stream_upload_claims (id, organization_id, catalog_item_id)
  values (p_claim_id, p_organization_id, p_catalog_item_id);
  return 'claimed';
end;
$$;

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
    hashtextextended('catalog-example-slots:' || p_organization_id::text || ':' || p_catalog_item_id::text, 0)
  );
  perform 1 from public.catalog_stream_upload_claims
  where id = p_claim_id and organization_id = p_organization_id
    and catalog_item_id = p_catalog_item_id and stream_uid = p_stream_uid and state = 'provisioned'
  for update;
  if not found then return null; end if;
  v_display_order := public.next_catalog_example_display_order(p_organization_id, p_catalog_item_id);
  if v_display_order is null then return null; end if;

  insert into public.catalog_item_examples (
    organization_id, catalog_item_id, title, description, kind, source_type,
    stream_uid, status, active, display_order
  ) values (
    p_organization_id, p_catalog_item_id, p_title, nullif(p_description, ''),
    'video', 'cloudflare_stream', p_stream_uid, 'uploading', true, v_display_order
  ) returning id into v_example_id;

  update public.catalog_stream_upload_claims
  set example_id = v_example_id, state = 'attached', updated_at = now()
  where id = p_claim_id and organization_id = p_organization_id
    and catalog_item_id = p_catalog_item_id and stream_uid = p_stream_uid and state = 'provisioned';
  if not found then raise exception 'catalog stream upload claim changed during attachment'; end if;
  return v_example_id;
end;
$$;

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
  perform pg_advisory_xact_lock(hashtextextended('catalog-stream-example:' || p_example_id::text, 0));
  select stream_uid into v_stream_uid
  from public.catalog_item_examples
  where organization_id = p_organization_id and id = p_example_id
    and source_type = 'cloudflare_stream' and stream_uid is not null
    and status in ('uploading', 'ready', 'failed', 'deleting')
  for update;
  if not found then return null; end if;
  if exists (
    select 1 from public.catalog_item_example_placements
    where organization_id = p_organization_id and source_example_id = p_example_id
  ) then return null; end if;

  perform 1 from public.catalog_stream_upload_claims
  where organization_id = p_organization_id and example_id = p_example_id
    and stream_uid = v_stream_uid and state in ('attached', 'completed', 'cleanup_required')
  for update;
  if not found then return null; end if;

  update public.catalog_item_examples set active = false, status = 'deleting'
  where organization_id = p_organization_id and id = p_example_id and stream_uid = v_stream_uid;
  update public.catalog_stream_upload_claims set state = 'cleanup_required', updated_at = now()
  where organization_id = p_organization_id and example_id = p_example_id
    and stream_uid = v_stream_uid and state in ('attached', 'completed', 'cleanup_required');
  if not found then raise exception 'catalog Stream deletion transition race'; end if;
  return v_stream_uid;
end;
$$;

comment on table public.catalog_item_example_placements is
  'Tenant-scoped reusable placements of one ready managed video on additional catalog items. Removing a placement never deletes the provider asset.';
