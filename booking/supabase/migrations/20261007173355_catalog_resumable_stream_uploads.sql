-- One statement: additive metadata and service-only reservation install atomically.
do $catalog_resumable_uploads$
begin
  set local lock_timeout = '5s';
  alter table public.catalog_stream_upload_claims
    add column upload_protocol text not null default 'basic',
    add column upload_size bigint,
    add column upload_fingerprint text,
    add column upload_expires_at timestamptz,
    add column upload_url text,
    add constraint catalog_stream_resumable_metadata_check check (
      (upload_protocol = 'basic' and upload_size is null and upload_fingerprint is null
        and upload_expires_at is null and upload_url is null)
      or (upload_protocol = 'tus' and upload_size between 1 and 1000000000
        and upload_size is not null and upload_fingerprint ~ '^[a-f0-9]{64}$'
        and upload_fingerprint is not null and upload_expires_at is not null
        and (upload_url is null or char_length(upload_url) between 1 and 4096))
    );

  create or replace function public.claim_catalog_resumable_upload(
    p_claim_id uuid,
    p_organization_id uuid,
    p_catalog_item_id uuid,
    p_upload_size bigint,
    p_upload_fingerprint text
  ) returns jsonb
  language plpgsql
  security invoker
  set search_path = ''
  set lock_timeout = '5s'
  as $$
  declare
    v_existing public.catalog_stream_upload_claims%rowtype;
    v_status text;
    v_expiry timestamptz;
  begin
    if p_upload_size is null or p_upload_size not between 1 and 1000000000
      or p_upload_fingerprint is null or p_upload_fingerprint !~ '^[a-f0-9]{64}$' then
      return jsonb_build_object('status', 'invalid');
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text, 0));
    select * into v_existing from public.catalog_stream_upload_claims
    where organization_id = p_organization_id and catalog_item_id = p_catalog_item_id
      and upload_protocol = 'tus' and upload_size = p_upload_size
      and upload_fingerprint = p_upload_fingerprint and upload_expires_at > now()
      and state in ('claimed', 'provider_unknown', 'provisioned', 'attached')
    order by created_at desc limit 1 for update;
    if found then
      return jsonb_build_object('status', 'resume', 'claim_id', v_existing.id,
        'expires_at', v_existing.upload_expires_at);
    end if;
    v_status := public.claim_catalog_stream_upload(p_claim_id, p_organization_id, p_catalog_item_id);
    if v_status <> 'claimed' then return jsonb_build_object('status', v_status); end if;
    v_expiry := date_trunc('second', now() + interval '6 hours');
    update public.catalog_stream_upload_claims
      set upload_protocol = 'tus', upload_size = p_upload_size,
        upload_fingerprint = p_upload_fingerprint, upload_expires_at = v_expiry
      where id = p_claim_id and organization_id = p_organization_id and state = 'claimed';
    if not found then raise exception 'upload reservation changed'; end if;
    return jsonb_build_object('status', 'claimed', 'claim_id', p_claim_id, 'expires_at', v_expiry);
  end;
  $$;
  revoke all on function public.claim_catalog_resumable_upload(uuid, uuid, uuid, bigint, text)
    from public, anon, authenticated;
  grant execute on function public.claim_catalog_resumable_upload(uuid, uuid, uuid, bigint, text)
    to service_role;
  comment on column public.catalog_stream_upload_claims.upload_url is
    'Private, short-lived upload capability. Service-only table; never log or project into public examples.';
end;
$catalog_resumable_uploads$;
