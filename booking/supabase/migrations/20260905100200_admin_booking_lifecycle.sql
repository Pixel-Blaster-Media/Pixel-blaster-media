-- Service-only admin aggregate. No provider calls or new browser grants.
alter table public.bookings add column lifecycle_version bigint not null default 1;
create function public.bump_booking_lifecycle_version() returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='cancelled' and (new.status is distinct from old.status or new.scheduled_at is distinct from old.scheduled_at or new.scheduled_ends_at is distinct from old.scheduled_ends_at) then
    raise exception 'Cancelled booking cannot be moved or reopened' using errcode='PB004';
  end if;
  new.lifecycle_version := old.lifecycle_version + 1;
  return new;
end $$;
create trigger bookings_lifecycle_version before update on public.bookings for each row execute function public.bump_booking_lifecycle_version();

create table public.admin_booking_requests (
 organization_id uuid not null, request_id uuid not null, actor_id uuid not null,
 input jsonb not null, booking_id uuid not null references public.bookings(id), result jsonb not null,
 primary key(organization_id,request_id)
);
alter table public.admin_booking_requests enable row level security;
revoke all on public.admin_booking_requests from public,anon,authenticated;
grant all on public.admin_booking_requests to service_role;

create function public.save_admin_booking_aggregate(p_organization_id uuid,p_actor_id uuid,p_request_id uuid,p_booking_id uuid,p_expected_version bigint,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_owner uuid := (p_input->>'owner_id')::uuid;
  v_ids uuid[]; v_property uuid; v_booking uuid; v_start timestamptz := (p_input->>'scheduled_at')::timestamptz;
  v_sqft integer := (p_input->>'square_footage')::integer;
  v_duration integer; v_services text[]; v_addons text[];
  v_old public.bookings%rowtype; v_request public.admin_booking_requests%rowtype;
  v_fingerprint jsonb; v_result jsonb; v_retained boolean := false; v_version bigint;
begin
  if not exists(select 1 from public.profiles p join public.organization_members m on m.profile_id=p.id and m.organization_id=p_organization_id where p.id=p_actor_id and p.organization_id=p_organization_id and p.archived_at is null and m.role in ('owner','admin'))
    or not exists(select 1 from public.profiles p where p.id=v_owner and p.organization_id=p_organization_id and p.role='realtor' and p.archived_at is null) then
    raise exception 'Not authorized' using errcode='PB001';
  end if;
  if p_request_id is null then raise exception 'Request key required' using errcode='PB002'; end if;
  select array_agg(value::uuid order by value::uuid) into v_ids from jsonb_array_elements_text(p_input->'catalog_item_ids');
  v_fingerprint := jsonb_build_object('booking',p_booking_id,'version',p_expected_version,'input',p_input || jsonb_build_object('catalog_item_ids',to_jsonb(v_ids)));
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_request_id::text,2));
  select * into v_request from public.admin_booking_requests where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if v_request.actor_id<>p_actor_id or v_request.input is distinct from v_fingerprint then raise exception 'Changed request' using errcode='PB003'; end if;
    return v_request.result || '{"replayed":true}'::jsonb;
  end if;
  if p_booking_id is not null then
    select * into v_old from public.bookings where id=p_booking_id and organization_id=p_organization_id and owner_id=v_owner for update;
    if not found or p_expected_version is null or v_old.lifecycle_version<>p_expected_version or v_old.status='cancelled' then raise exception 'Booking changed; reload' using errcode='PB004'; end if;
    v_retained := v_ids is not distinct from (select array_agg(catalog_item_id order by catalog_item_id) from public.booking_line_items where booking_id=p_booking_id);
  end if;
  if nullif(btrim(p_input->>'street_address'),'') is null or (p_booking_id is null and v_start is null) or v_sqft<0 then raise exception 'Invalid input' using errcode='PB002'; end if;
  if not v_retained then
  if coalesce(cardinality(v_ids),0)=0 or cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids) x)
    or exists(select 1 from unnest(v_ids) x left join public.catalog_items c on c.id=x and c.organization_id=p_organization_id and (c.active or exists(select 1 from public.booking_line_items l where l.booking_id=p_booking_id and l.catalog_item_id=x)) where c.id is null)
    or not exists(select 1 from public.catalog_items c where c.id=any(v_ids) and c.kind in ('bundle','a_la_carte'))
    or (select count(*) from public.catalog_items c where c.id=any(v_ids) and c.kind='bundle')>1 then
    raise exception 'Invalid catalog selection' using errcode='PB002';
  end if;
  if exists(select 1 from public.catalog_items a where a.id=any(v_ids) and a.kind='addon' and (
    (a.require_has_video and not exists(select 1 from public.catalog_items c where c.id=any(v_ids) and c.kind<>'addon' and c.is_video)) or
    (a.require_has_media and not exists(select 1 from public.catalog_items c where c.id=any(v_ids) and c.kind<>'addon' and (c.is_video or c.is_photo or c.is_iguide))) or
    (a.exclude_has_aerial and exists(select 1 from public.catalog_items c where c.id=any(v_ids) and c.kind<>'addon' and c.is_aerial)))) then
    raise exception 'Ineligible add-on' using errcode='PB002';
  end if;
  select greatest(sum(coalesce(l.unit_duration_minutes*l.quantity,c.duration_minutes)),60), coalesce(array_agg(coalesce(l.item_slug,c.slug) order by array_position(v_ids,c.id)) filter(where coalesce(l.item_kind,c.kind::text)<>'addon'),'{}'), coalesce(array_agg(coalesce(l.item_slug,c.slug) order by array_position(v_ids,c.id)) filter(where coalesce(l.item_kind,c.kind::text)='addon'),'{}') into v_duration,v_services,v_addons from public.catalog_items c left join public.booking_line_items l on l.booking_id=p_booking_id and l.catalog_item_id=c.id where c.id=any(v_ids);
  else
    select greatest(sum(unit_duration_minutes*quantity),60),coalesce(array_agg(item_slug) filter(where item_kind<>'addon'),'{}'),coalesce(array_agg(item_slug) filter(where item_kind='addon'),'{}') into v_duration,v_services,v_addons from public.booking_line_items where booking_id=p_booking_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_owner::text||':'||lower(btrim(p_input->>'street_address')),1));
  select id into v_property from public.properties where organization_id=p_organization_id and owner_id=v_owner and lower(btrim(street_address))=lower(btrim(p_input->>'street_address')) and city is not distinct from nullif(p_input->>'city','') and province is not distinct from coalesce(nullif(p_input->>'province',''),'ON') and postal_code is not distinct from nullif(p_input->>'postal_code','') order by created_at,id limit 1;
  if v_property is null then
    insert into public.properties(organization_id,owner_id,street_address,city,province,postal_code) values(p_organization_id,v_owner,btrim(p_input->>'street_address'),nullif(p_input->>'city',''),coalesce(nullif(p_input->>'province',''),'ON'),nullif(p_input->>'postal_code','')) returning id into v_property;
  end if;
  if p_booking_id is null then
  insert into public.bookings(organization_id,owner_id,property_id,status,scheduled_at,scheduled_ends_at,allow_schedule_overlap,services,add_ons,square_footage,unit_number,client_notes,suppress_realtor_notifications)
  values(p_organization_id,v_owner,v_property,'confirmed',v_start,v_start+make_interval(mins=>v_duration),true,v_services,v_addons,v_sqft,nullif(p_input->>'unit_number',''),nullif(p_input->>'client_notes',''),coalesce((p_input->>'suppress_realtor_notifications')::boolean,false)) returning id,lifecycle_version into v_booking,v_version;
  else
    update public.bookings set property_id=v_property,scheduled_at=v_start,scheduled_ends_at=v_start+make_interval(mins=>v_duration),allow_schedule_overlap=true,services=v_services,add_ons=v_addons,square_footage=v_sqft,unit_number=nullif(p_input->>'unit_number',''),client_notes=nullif(p_input->>'client_notes','') where id=p_booking_id returning id,lifecycle_version into v_booking,v_version;
  end if;
  if not v_retained then
    delete from public.booking_line_items where booking_id=v_booking and not (catalog_item_id=any(v_ids));
  insert into public.booking_line_items(booking_id,catalog_item_id,item_name,item_slug,item_kind,quantity,unit_price_cents,unit_duration_minutes)
  select v_booking,id,name,slug,kind::text,1,price_cents+case when sqft_pricing_enabled and included_sqft>0 and overage_increment_sqft>0 and overage_price_cents>0 and v_sqft>included_sqft then ceil((v_sqft-included_sqft)::numeric/overage_increment_sqft)::integer*overage_price_cents else 0 end,duration_minutes from public.catalog_items c where id=any(v_ids) and not exists(select 1 from public.booking_line_items l where l.booking_id=v_booking and l.catalog_item_id=c.id);
  end if;
  if p_input ? 'contact_name' then
    if nullif(btrim(p_input->>'contact_name'),'') is null then raise exception 'Contact name required' using errcode='PB002'; end if;
    update public.profiles set full_name=btrim(p_input->>'contact_name'),phone=nullif(p_input->>'contact_phone',''),brokerage=nullif(p_input->>'brokerage','') where id=v_owner and organization_id=p_organization_id;
  end if;
  if p_booking_id is null then
    insert into public.integration_jobs(organization_id,booking_id,job_type,idempotency_key,payload)
    select p_organization_id,v_booking,j.kind,'booking:'||v_booking||':'||j.kind||':admin-v1',
      jsonb_build_object(
        'schema_version',1,'booking_id',v_booking,'organization_id',p_organization_id,'public_request_id',p_request_id,
        'app_url',coalesce(p_input->>'app_url',''),
        'organization',jsonb_build_object('name',o.name,'from_name',coalesce(nullif(o.email_from_name,''),o.name),
          'reply_to_email',coalesce(nullif(o.reply_to_email,''),nullif(o.admin_notification_email,''),nullif(p_input->>'admin_notification_email','')),
          'admin_notification_email',coalesce(nullif(o.admin_notification_email,''),nullif(p_input->>'admin_notification_email',''))),
        'realtor',jsonb_build_object('id',p.id,'email',p.email,'full_name',coalesce(nullif(p.full_name,''),p.email),'phone',p.phone,'brokerage',p.brokerage,'delivery_cc_emails',coalesce(p.delivery_cc_emails,'{}'::text[])),
        'property',jsonb_build_object('street_address',a.street_address,'city',a.city,'postal_code',a.postal_code,'unit_number',b.unit_number),
        'booking',jsonb_build_object('scheduled_at',b.scheduled_at,'scheduled_ends_at',b.scheduled_ends_at,'square_footage',b.square_footage,'is_vacant',b.is_vacant,'include_basement',b.include_basement,'client_notes',coalesce(b.client_notes,'')),
        'line_items',(select jsonb_agg(jsonb_build_object('catalog_item_id',l.catalog_item_id,'name',l.item_name,'slug',l.item_slug,'kind',l.item_kind,'quantity',l.quantity,'unit_price_cents',l.unit_price_cents,'unit_duration_minutes',l.unit_duration_minutes) order by array_position(v_ids,l.catalog_item_id)) from public.booking_line_items l where l.booking_id=v_booking))
    from public.bookings b join public.properties a on a.id=b.property_id and a.organization_id=b.organization_id
    join public.organizations o on o.id=b.organization_id join public.profiles p on p.id=b.owner_id and p.organization_id=b.organization_id
    cross join (values ('google_calendar.event.create'),('email.booking.confirmation'),('email.admin.new_booking'),('push.admin.new_booking'),('quickbooks.invoice.create')) j(kind)
    where b.id=v_booking and (j.kind<>'quickbooks.invoice.create' or o.invoice_timing='at_booking');
  end if;
  -- Migration-safe hook: finish effect bookkeeping on final snapshots before
  -- capturing CAS. Deferred triggers subsequently see the same payload (no-op).
  if to_regprocedure('public.refresh_booking_effects(uuid,uuid)') is not null then
    execute 'select public.refresh_booking_effects($1,$2)' using p_organization_id,v_booking;
  end if;
  select lifecycle_version into v_version from public.bookings where id=v_booking and organization_id=p_organization_id;
  v_result := jsonb_build_object('booking_id',v_booking,'property_id',v_property,'lifecycle_version',v_version,'replayed',false);
  insert into public.admin_booking_requests values(p_organization_id,p_request_id,p_actor_id,v_fingerprint,v_booking,v_result);
  return v_result;
end $$;
revoke all on function public.save_admin_booking_aggregate(uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_admin_booking_aggregate(uuid,uuid,uuid,uuid,bigint,jsonb) to service_role;
revoke all on function public.bump_booking_lifecycle_version() from public,anon,authenticated;
