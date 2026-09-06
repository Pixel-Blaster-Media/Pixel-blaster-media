-- Append-only booking effect generations. Provider requests are never rewritten.
-- Migration-first compatible with the existing claim-by-booking/type API.
alter table public.bookings
  add column effect_version bigint not null default 1 check(effect_version > 0),
  add column schedule_version bigint not null default 1 check(schedule_version > 0);
alter table public.integration_jobs
  add column effect_version bigint not null default 1 check(effect_version > 0);
alter table public.integration_jobs drop constraint integration_jobs_organization_id_booking_id_job_type_key;
create unique index integration_jobs_effect_generation_key
  on public.integration_jobs(organization_id,booking_id,job_type,effect_version);
-- Only one unresolved dispatch candidate per type; retain all terminal history.
create unique index integration_jobs_active_effect_key
  on public.integration_jobs(organization_id,booking_id,job_type)
  where status in ('pending','retryable','processing');

create function public.guard_integration_effect_generation() returns trigger language plpgsql set search_path='' as $$
begin
  if new.effect_version is distinct from old.effect_version then
    raise exception 'Integration effect generation is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger integration_effect_generation_immutable before update on public.integration_jobs
for each row execute function public.guard_integration_effect_generation();
revoke all on function public.guard_integration_effect_generation() from public,anon,authenticated;

create function public.version_booking_schedule() returns trigger
language plpgsql set search_path='' as $$
begin
  if (new.scheduled_at,new.scheduled_ends_at) is distinct from (old.scheduled_at,old.scheduled_ends_at) then
    new.schedule_version := old.schedule_version+1;
    new.reminder_sent_at := null;
  else
    new.schedule_version := old.schedule_version;
  end if;
  return new;
end;
$$;
create trigger booking_schedule_generation before update on public.bookings
for each row execute function public.version_booking_schedule();

create function public.refresh_booking_effects(p_organization_id uuid,p_booking_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  b public.bookings%rowtype;
  seed jsonb;
  current_payload jsonb;
  generation bigint;
  job public.integration_jobs%rowtype;
begin
  select * into b from public.bookings where organization_id=p_organization_id and id=p_booking_id for update;
  if not found then return; end if;
  select payload into seed from public.integration_jobs
  where organization_id=b.organization_id and booking_id=b.id
  order by effect_version desc,created_at desc,id limit 1;
  -- Existing non-outbox admin bookings do not acquire new creation effects.
  if seed is null then return; end if;
  select seed || jsonb_build_object(
    'realtor',jsonb_build_object('id',r.id,'email',r.email,'full_name',coalesce(nullif(r.full_name,''),r.email),
      'phone',r.phone,'brokerage',r.brokerage,'delivery_cc_emails',coalesce(r.delivery_cc_emails,'{}'::text[])),
    'booking',jsonb_build_object('scheduled_at',b.scheduled_at,'scheduled_ends_at',b.scheduled_ends_at,
      'square_footage',b.square_footage,'is_vacant',b.is_vacant,'include_basement',b.include_basement,
      'client_notes',coalesce(b.client_notes,'')),
    'property',jsonb_build_object('street_address',p.street_address,'city',p.city,'postal_code',p.postal_code,'unit_number',b.unit_number),
    'line_items',coalesce((select jsonb_agg(jsonb_build_object(
      'catalog_item_id',l.catalog_item_id,'name',l.item_name,'slug',l.item_slug,'kind',l.item_kind,
      'quantity',l.quantity,'unit_price_cents',l.unit_price_cents,'unit_duration_minutes',l.unit_duration_minutes)
      order by case when l.item_kind='addon' then 1 else 0 end,
      case when l.item_kind='addon' then array_position(b.add_ons,l.item_slug) else array_position(b.services,l.item_slug) end,l.id)
      from public.booking_line_items l where l.booking_id=b.id),'[]'::jsonb))
    into current_payload from public.properties p
    join public.profiles r on r.id=b.owner_id and r.organization_id=b.organization_id
    where p.id=b.property_id and p.organization_id=b.organization_id;
  if current_payload is null then raise exception 'Booking effect property scope mismatch' using errcode='23514'; end if;
  generation := b.effect_version;
  if exists(select 1 from public.integration_jobs where organization_id=b.organization_id and booking_id=b.id
    and job_type in ('email.booking.confirmation','email.admin.new_booking','quickbooks.invoice.create')
    and status in ('pending','retryable') and attempts=0 and payload is distinct from current_payload) then
    generation := b.effect_version+1;
    update public.bookings set effect_version=generation where id=b.id and organization_id=b.organization_id;
  end if;
  -- Never replace attempted requests with a new key: the provider may have
  -- accepted them. Keep active leases, terminalize obsolete attempts on recovery.
  update public.integration_jobs set status='dead_letter',completed_at=now(),
    last_error_code='booking_effect_superseded_ambiguous',
    last_error_message='Booking changed after provider attempt; reconcile before any replacement',
    last_error_at=now(),lease_token=null,locked_by=null,locked_at=null,lease_expires_at=null
  where organization_id=b.organization_id and booking_id=b.id
    and job_type in ('email.booking.confirmation','email.admin.new_booking','quickbooks.invoice.create')
    and payload is distinct from current_payload and attempts>0
    and (status in ('pending','retryable') or (status='processing' and lease_expires_at<=now()));
  for job in select * from public.integration_jobs where organization_id=b.organization_id and booking_id=b.id
    and job_type in ('email.booking.confirmation','email.admin.new_booking','quickbooks.invoice.create')
    and status in ('pending','retryable') and attempts=0 and payload is distinct from current_payload for update
  loop
    update public.integration_jobs set status='cancelled',completed_at=now(),last_error_code='booking_effect_superseded',
      last_error_message='Unclaimed effect superseded by a newer booking generation',last_error_at=now(),updated_at=now()
      where id=job.id;
    if b.status <> 'cancelled' then
      insert into public.integration_jobs(organization_id,booking_id,job_type,idempotency_key,payload,effect_version)
      values(b.organization_id,b.id,job.job_type,'booking:'||b.id||':'||job.job_type||':generation:'||generation,current_payload,generation);
    end if;
  end loop;
end;
$$;

create function public.refresh_booking_effects_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare b record;
begin
  if tg_table_name='bookings' then
    perform public.refresh_booking_effects(new.organization_id,new.id);
  elsif tg_table_name='properties' then
    for b in select id,organization_id from public.bookings where property_id=new.id and organization_id=new.organization_id order by id loop
      perform public.refresh_booking_effects(b.organization_id,b.id);
    end loop;
  else
    for b in select id,organization_id from public.bookings where id=case when tg_op='DELETE' then old.booking_id else new.booking_id end loop
      perform public.refresh_booking_effects(b.organization_id,b.id);
    end loop;
  end if;
  return null;
end;
$$;
-- Deferred triggers observe the FINAL aggregate (including replacement lines),
-- not the intermediate state inside the admin aggregate transaction.
create constraint trigger booking_effect_refresh after update of scheduled_at,scheduled_ends_at,property_id,services,add_ons,client_notes,unit_number,square_footage,is_vacant,include_basement
on public.bookings deferrable initially deferred for each row execute function public.refresh_booking_effects_trigger();
create constraint trigger booking_lines_effect_refresh after insert or update or delete
on public.booking_line_items deferrable initially deferred for each row execute function public.refresh_booking_effects_trigger();
create constraint trigger property_booking_effect_refresh after update of street_address,city,postal_code
on public.properties deferrable initially deferred for each row execute function public.refresh_booking_effects_trigger();

revoke all on function public.version_booking_schedule(),public.refresh_booking_effects(uuid,uuid),public.refresh_booking_effects_trigger() from public,anon,authenticated;
grant execute on function public.refresh_booking_effects(uuid,uuid) to service_role;

alter function public.claim_integration_job(uuid,uuid,text,text,uuid) rename to claim_integration_job_before_generations;
revoke all on function public.claim_integration_job_before_generations(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
create function public.claim_integration_job(p_organization_id uuid,p_booking_id uuid,p_job_type text,p_worker_id text,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  -- Same parent lock as aggregate edits. Refresh before leasing, including
  -- jobs whose earlier in-flight attempt has since settled or expired.
  perform public.refresh_booking_effects(p_organization_id,p_booking_id);
  return public.claim_integration_job_before_generations(p_organization_id,p_booking_id,p_job_type,p_worker_id,p_lease_token);
end $$;
revoke all on function public.claim_integration_job(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_integration_job(uuid,uuid,text,text,uuid) to service_role;
