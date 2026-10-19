-- Additive, opt-in rollout. No existing booking or live preference is changed.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.organizations
  add column require_24_hour_notice boolean not null default false;
comment on column public.organizations.require_24_hour_notice is
  'Require rolling 24-hour notice for customer booking creation and online rescheduling. Existing appointments and authenticated admin scheduling are unchanged.';

create function public.customer_booking_notice_satisfied(p_start timestamptz, p_now timestamptz)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(pg_catalog.isfinite(p_start) and pg_catalog.isfinite(p_now)
    and p_start >= p_now + interval '24 hours', false)
$$;

create function public.assert_customer_booking_notice(p_organization_id uuid, p_start timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
declare notice_required boolean;
begin
  -- Reuse the calendar writer's tenant lock. A queued writer must not pass
  -- notice validation before waiting for a conflicting schedule write.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text, 0));
  -- Serialize setting changes with admission. Use the current clock AFTER any
  -- lock wait, not the transaction start or the browser's old availability time.
  select require_24_hour_notice into notice_required from public.organizations
    where id = p_organization_id for share;
  if not found then
    raise exception 'Booking company not found' using errcode = 'PB003';
  end if;
  if notice_required and not public.customer_booking_notice_satisfied(p_start, clock_timestamp()) then
    raise exception 'Please choose a shoot time at least 24 hours from now'
      using errcode = 'PB006';
  end if;
end;
$$;

-- Retain the existing authenticated owner-insert policy. This narrow definer
-- trigger needs to read settings that realtors cannot SELECT under RLS. It is
-- not a callable RPC and never grants writes or trusts posted override flags.
create function public.guard_customer_booking_notice()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.public_request_id is not null
     or (pg_catalog.current_setting('role', true) = 'authenticated'
         and not public.is_organization_admin(new.organization_id)) then
    perform public.assert_customer_booking_notice(new.organization_id, new.scheduled_at);
  end if;
  return new;
end;
$$;
create trigger bookings_customer_notice_guard
  before insert on public.bookings for each row
  execute function public.guard_customer_booking_notice();

revoke all on function public.customer_booking_notice_satisfied(timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.assert_customer_booking_notice(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.guard_customer_booking_notice() from public,anon,authenticated;
grant execute on function public.customer_booking_notice_satisfied(timestamptz,timestamptz) to service_role;
grant execute on function public.assert_customer_booking_notice(uuid,timestamptz) to service_role;
grant execute on function public.guard_customer_booking_notice() to service_role;

-- Preserve all existing lifecycle validation, locking and notice behavior.
-- Only a customer-requested schedule change gets the admission check.
create or replace function public.change_booking_with_lifecycle_notices(
  p_organization_id uuid, p_booking_id uuid, p_expected_version bigint,
  p_event text, p_initiator text, p_notices jsonb,
  p_scheduled_at timestamptz default null, p_scheduled_ends_at timestamptz default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  b public.bookings%rowtype;
  notice jsonb;
  notice_ids jsonb := '[]'::jsonb;
  notice_id uuid;
  seen_recipients text[] := '{}'::text[];
begin
  if p_event not in ('rescheduled', 'cancelled') or p_event is null
     or p_initiator not in ('admin', 'realtor') or p_initiator is null
     or p_expected_version is null
     or p_notices is null or jsonb_typeof(p_notices) <> 'array'
     or jsonb_array_length(p_notices) > 2 then
    raise exception 'Invalid lifecycle change' using errcode = 'PB003';
  end if;
  select * into b from public.bookings
    where id = p_booking_id and organization_id = p_organization_id for update;
  if not found or b.lifecycle_version <> p_expected_version then
    raise exception 'Booking changed; refresh before retrying' using errcode = 'PB004';
  end if;
  if b.status not in ('requested', 'confirmed') and not
     (p_event = 'cancelled' and p_initiator = 'admin' and b.status in ('shot', 'editing')) then
    raise exception 'Booking cannot be changed from this status' using errcode = 'PB003';
  end if;
  if p_event = 'rescheduled' then
    if p_initiator <> 'realtor' or b.scheduled_at is null or b.scheduled_at <= now()
       or p_scheduled_at is null or p_scheduled_at <= now()
       or p_scheduled_ends_at is distinct from p_scheduled_at + make_interval(mins => greatest(
         coalesce(round(extract(epoch from (b.scheduled_ends_at - b.scheduled_at)) / 60)::integer, 60), 60
       )) then
      raise exception 'Invalid reschedule time or duration' using errcode = 'PB003';
    end if;
    perform public.assert_customer_booking_notice(p_organization_id, p_scheduled_at);
    update public.bookings set scheduled_at = p_scheduled_at,
      scheduled_ends_at = p_scheduled_ends_at, allow_schedule_overlap = false
      where id = b.id and organization_id = b.organization_id returning * into b;
    -- Existing effect-generation bookkeeping can increment lifecycle_version.
    -- Finish it before snapshotting the notice version, as the admin aggregate
    -- does; the deferred trigger then observes the same payload and is a no-op.
    perform public.refresh_booking_effects(b.organization_id, b.id);
    select * into b from public.bookings
      where id = p_booking_id and organization_id = p_organization_id;
  else
    -- Calendar linkage remains until the canonical Calendar service confirms deletion.
    update public.bookings set status = 'cancelled'
      where id = b.id and organization_id = b.organization_id returning * into b;
  end if;

  for notice in select value from jsonb_array_elements(p_notices) loop
    if jsonb_typeof(notice) <> 'object'
       or coalesce(notice->>'recipient', '') not in ('realtor', 'admin')
       or notice->>'recipient' = any(seen_recipients)
       or jsonb_typeof(notice->'payload') is distinct from 'object'
       or coalesce(length(notice#>>'{payload,subject}'), 0) not between 1 and 998
       or coalesce(length(notice#>>'{payload,html}'), 0) not between 1 and 50000
       or coalesce(length(notice#>>'{payload,to}'), 0) > 320
       or (p_event = 'cancelled' and p_initiator = 'admin' and notice->>'recipient' <> 'realtor') then
      raise exception 'Invalid lifecycle notice' using errcode = 'PB003';
    end if;
    seen_recipients := array_append(seen_recipients, notice->>'recipient');
    if notice->>'recipient' = 'realtor' and b.suppress_realtor_notifications then
      continue;
    end if;
    insert into public.booking_lifecycle_notices(
      organization_id, booking_id, lifecycle_version, event, recipient,
      scheduled_at, payload, status, error_code
    ) values (
      b.organization_id, b.id, b.lifecycle_version, p_event, notice->>'recipient',
      b.scheduled_at, notice->'payload',
      case when nullif(btrim(notice#>>'{payload,to}'), '') is null then 'dead_letter' else 'pending' end,
      case when nullif(btrim(notice#>>'{payload,to}'), '') is null then 'missing_recipient' else null end
    ) returning id into notice_id;
    notice_ids := notice_ids || jsonb_build_array(notice_id);
  end loop;
  if (p_initiator = 'realtor' and not ('admin' = any(seen_recipients)))
     or (not b.suppress_realtor_notifications and
       (p_event = 'rescheduled' or p_initiator = 'admin') and not ('realtor' = any(seen_recipients))) then
    raise exception 'Required lifecycle notice is missing' using errcode = 'PB003';
  end if;
  return jsonb_build_object('booking_id', b.id, 'lifecycle_version', b.lifecycle_version,
    'notice_ids', notice_ids);
end;
$$;
