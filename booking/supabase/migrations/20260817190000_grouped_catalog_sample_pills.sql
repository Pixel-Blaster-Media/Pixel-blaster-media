set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.catalog_item_examples
  add column sample_group_key text,
  add column sample_group_label text;

alter table public.catalog_item_examples
  add constraint catalog_item_examples_sample_group_pair
  check (
    (sample_group_key is null and sample_group_label is null)
    or (
      sample_group_key is not null
      and sample_group_label is not null
      and sample_group_key ~ '^[a-z][a-z0-9_]{0,31}$'
      and char_length(btrim(sample_group_label)) between 1 and 24
      and sample_group_label !~ '[[:cntrl:]]'
    )
  );

comment on column public.catalog_item_examples.sample_group_key is
  'Optional stable group key for the capability pill that opens this example. Null legacy rows derive a safe group from kind.';
comment on column public.catalog_item_examples.sample_group_label is
  'Optional customer-facing capability pill label. Paired with sample_group_key and bounded to 24 characters.';

create or replace function public.attach_external_catalog_example(
  p_organization_id uuid,
  p_catalog_item_id uuid,
  p_title text,
  p_description text,
  p_kind text,
  p_external_url text,
  p_sample_group_key text,
  p_sample_group_label text
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
     or char_length(p_external_url) > 2048
     or p_sample_group_key is null
     or p_sample_group_label is null
     or p_sample_group_key !~ '^[a-z][a-z0-9_]{0,31}$'
     or char_length(btrim(p_sample_group_label)) not between 1 and 24
     or p_sample_group_label ~ '[[:cntrl:]]' then
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
    external_url, sample_group_key, sample_group_label, status, active, display_order
  ) values (
    p_organization_id, p_catalog_item_id, btrim(p_title), nullif(btrim(p_description), ''),
    p_kind, 'external_url', p_external_url, p_sample_group_key,
    btrim(p_sample_group_label), 'ready', true, v_display_order
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.attach_external_catalog_example(
  uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.attach_external_catalog_example(
  uuid, uuid, text, text, text, text, text, text
) to service_role;

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
       or new.sample_group_key is distinct from old.sample_group_key
       or new.sample_group_label is distinct from old.sample_group_label
       or new.status is distinct from old.status
       or new.active is distinct from old.active then
      raise exception using errcode = 'P0001', message = 'catalog video is still shared';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Pixel Blaster's Reel remains one service and one price with two creative styles.
do $$
declare
  v_rows integer;
begin
  if not exists (
    select 1 from public.catalog_items
    where organization_id = '00000000-0000-0000-0000-000000000001'
      and slug in ('social_media_reel', 'social_media_special')
  ) then
    return;
  end if;

  update public.catalog_items
  set description = $copy$Short vertical video for social media. Choose a smooth One-Take walkthrough or an Edited Reel made from short clips cut to music. Both styles focus on the main spaces with a clean, streamlined finish. For detail shots, advanced colour work, and cinematic coverage, choose the Full Video Tour.$copy$,
      updated_at = now()
  where organization_id = '00000000-0000-0000-0000-000000000001'
    and slug = 'social_media_reel';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Expected exactly one Pixel Social Media Reel row, found %', v_rows;
  end if;

  update public.catalog_items
  set description = $copy$Your choice of a One-Take Reel or Edited Reel, complemented by drone footage
Weekly analytics
Up to 7 drone photos
Up to 2,500 sq.ft of measuring included. Extra billed $40 per 500 sq. ft ($50 for iGuide Premium). Houses over 2,500 sq ft: +$50 video overage.$copy$,
      updated_at = now()
  where organization_id = '00000000-0000-0000-0000-000000000001'
    and slug = 'social_media_special';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Expected exactly one Pixel Social Media Special row, found %', v_rows;
  end if;
end;
$$;
