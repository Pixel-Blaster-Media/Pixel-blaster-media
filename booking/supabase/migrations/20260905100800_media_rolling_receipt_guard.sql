-- Additive rolling-deployment fence. Old writers do not supply the per-write
-- expected claim, so neither their reclaim UPDATE nor stale ON CONFLICT UPDATE
-- may erase new receipt evidence. Keep this migration installed on app rollback.
alter table public.autoenhance_iguide_uploads
  add column media_claim_token text,
  add column media_expected_claim text;

-- Adopt receipts already emitted by the new application before this migration.
update public.autoenhance_iguide_uploads
set media_claim_token = warning
where warning like 'media:claim:%' or warning ~ '^media:retryable:[123]$';

create function public.guard_media_receipt_transition()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    new.media_claim_token := case
      when new.warning like 'media:claim:%' or new.warning ~ '^media:retryable:[123]$'
      then new.warning else null end;
  elsif old.media_claim_token is not null then
    if new.media_expected_claim is distinct from old.media_claim_token
      or new.media_claim_token is distinct from old.media_claim_token
      or row(new.id, new.organization_id, new.batch_id, new.booking_id,
             new.iguide_portal_id, new.autoenhance_image_id)
         is distinct from row(old.id, old.organization_id, old.batch_id, old.booking_id,
                              old.iguide_portal_id, old.autoenhance_image_id)
      or old.status = 'uploaded'
      or (old.iguide_asset_name is not null and new.iguide_asset_name is distinct from old.iguide_asset_name)
      or (old.iguide_job_id is not null and new.iguide_job_id is distinct from old.iguide_job_id)
    then
      raise exception 'media receipt transition fenced' using errcode = '23514';
    end if;
    if old.status = 'failed' then
      if not coalesce(old.warning ~ '^media:retryable:[12]$', false)
        or new.status <> 'pending'
        or not coalesce(new.warning like 'media:claim:%', false)
        or old.updated_at > now() - interval '15 minutes'
        or old.iguide_asset_name is not null or old.iguide_job_id is not null
      then
        raise exception 'media receipt transition fenced' using errcode = '23514';
      end if;
      new.media_claim_token := new.warning;
    elsif new.status = 'pending' and new.warning is distinct from old.warning then
      raise exception 'media receipt transition fenced' using errcode = '23514';
    elsif new.status = 'failed' and new.warning ~ '^media:retryable:[123]$' then
      if old.iguide_asset_name is not null or old.iguide_job_id is not null then
        raise exception 'media receipt transition fenced' using errcode = '23514';
      end if;
      new.media_claim_token := new.warning;
    end if;
  else
    -- Legacy-only rows remain compatible. Once adopted, protection is sticky.
    new.media_claim_token := case
      when new.warning like 'media:claim:%' or new.warning ~ '^media:retryable:[123]$'
      then new.warning else null end;
  end if;
  -- A stored authorization must never let a later old writer inherit authority.
  new.media_expected_claim := null;
  return new;
end;
$$;
revoke all on function public.guard_media_receipt_transition() from public;
create trigger autoenhance_iguide_uploads_guard_transition
before insert or update on public.autoenhance_iguide_uploads
for each row execute function public.guard_media_receipt_transition();
