set lock_timeout = '5s';

alter table public.catalog_item_examples
  add column if not exists video_width integer,
  add column if not exists video_height integer;

alter table public.catalog_item_examples
  drop constraint if exists catalog_item_examples_video_dimensions_check;
alter table public.catalog_item_examples
  add constraint catalog_item_examples_video_dimensions_check check (
    (video_width is null and video_height is null)
    or (
      video_width is not null
      and video_height is not null
      and
      source_type = 'cloudflare_stream'
      and kind = 'video'
      and video_width between 1 and 32768
      and video_height between 1 and 32768
    )
  );

create or replace function public.record_catalog_stream_example_dimensions(
  p_example_id uuid,
  p_organization_id uuid,
  p_stream_uid text,
  p_video_width integer,
  p_video_height integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_video_width is null
    or p_video_height is null
    or p_video_width not between 1 and 32768
    or p_video_height not between 1 and 32768 then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('catalog-stream-example:' || p_example_id::text, 0)
  );

  if exists (
    select 1
    from public.catalog_item_examples
    where id = p_example_id
      and organization_id = p_organization_id
      and source_type = 'cloudflare_stream'
      and kind = 'video'
      and stream_uid = p_stream_uid
      and status = 'ready'
      and active = true
      and video_width = p_video_width
      and video_height = p_video_height
  ) then
    return true;
  end if;

  update public.catalog_item_examples
  set video_width = p_video_width,
      video_height = p_video_height
  where id = p_example_id
    and organization_id = p_organization_id
    and source_type = 'cloudflare_stream'
    and kind = 'video'
    and stream_uid = p_stream_uid
    and status = 'ready'
    and active = true
    and video_width is null
    and video_height is null;

  return found;
end;
$$;

revoke all on function public.record_catalog_stream_example_dimensions(uuid, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_catalog_stream_example_dimensions(uuid, uuid, text, integer, integer)
  to service_role;

create or replace function public.finalize_catalog_stream_upload_with_dimensions(
  p_example_id uuid,
  p_organization_id uuid,
  p_stream_uid text,
  p_video_width integer,
  p_video_height integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_video_width is null
    or p_video_height is null
    or p_video_width not between 1 and 32768
    or p_video_height not between 1 and 32768 then
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
      and e.status = 'ready'
      and e.active = true
      and e.video_width = p_video_width
      and e.video_height = p_video_height
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
    and source_type = 'cloudflare_stream'
    and kind = 'video'
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
  if not found then raise exception 'catalog Stream claim dimension finalization race'; end if;

  update public.catalog_item_examples
  set status = 'ready',
      active = true,
      video_width = p_video_width,
      video_height = p_video_height
  where organization_id = p_organization_id
    and id = p_example_id
    and stream_uid = p_stream_uid
    and status = 'uploading'
    and active = true;
  if not found then raise exception 'catalog Stream dimension finalization race'; end if;

  return true;
end;
$$;

revoke all on function public.finalize_catalog_stream_upload_with_dimensions(uuid, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.finalize_catalog_stream_upload_with_dimensions(uuid, uuid, text, integer, integer)
  to service_role;

comment on column public.catalog_item_examples.video_width is
  'Validated native input width reported by Cloudflare Stream after processing.';
comment on column public.catalog_item_examples.video_height is
  'Validated native input height reported by Cloudflare Stream after processing.';
