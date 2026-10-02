-- Only new authorized lifecycle changes enqueue notices. No historical backfill.
create table public.booking_lifecycle_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  booking_id uuid not null,
  lifecycle_version bigint not null,
  event text not null check (event in ('rescheduled', 'cancelled')),
  recipient text not null check (recipient in ('realtor', 'admin')),
  scheduled_at timestamptz,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retryable', 'completed', 'superseded', 'dead_letter')),
  attempt_count integer not null default 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_id text,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (organization_id, booking_id)
    references public.bookings(organization_id, id) on delete cascade,
  unique (organization_id, booking_id, lifecycle_version, recipient)
);
create index booking_lifecycle_notices_due_idx
  on public.booking_lifecycle_notices(next_attempt_at, created_at)
  where status in ('pending', 'retryable', 'processing');
create index booking_lifecycle_notices_booking_idx
  on public.booking_lifecycle_notices(organization_id, booking_id, created_at desc);
alter table public.booking_lifecycle_notices enable row level security;
revoke all on public.booking_lifecycle_notices from public, anon, authenticated;
grant select, insert, update, delete on public.booking_lifecycle_notices to service_role;

-- Keep each provider request immutable, including its recipient and body.
create function public.protect_booking_lifecycle_notice_payload()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.id, new.organization_id, new.booking_id, new.lifecycle_version,
      new.event, new.recipient, new.scheduled_at, new.payload, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.booking_id, old.lifecycle_version,
      old.event, old.recipient, old.scheduled_at, old.payload, old.created_at) then
    raise exception 'Lifecycle notice identity and payload are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger booking_lifecycle_notice_immutable
  before update on public.booking_lifecycle_notices
  for each row execute function public.protect_booking_lifecycle_notice_payload();

-- Callers authorize the signed manage token or authenticated admin/realtor first.
-- The RPC rechecks tenant, version and transition while holding the booking lock.
-- A failed enqueue rolls back the booking update; a stale retry never duplicates it.
create function public.change_booking_with_lifecycle_notices(
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

-- Lease at most two sends at once. Expired attempts keep the SAME provider key.
-- After 23 hours, stop automatic retries rather than risk a duplicate outside
-- Resend's 24-hour idempotency window. No historical replay/requeue endpoint.
create function public.claim_booking_lifecycle_notices(
  p_not_before timestamptz, p_organization_id uuid default null,
  p_booking_id uuid default null, p_limit integer default 2
)
returns setof public.booking_lifecycle_notices
language plpgsql security invoker set search_path = '' as $$
declare
  job public.booking_lifecycle_notices%rowtype;
  b public.bookings%rowtype;
  claimed integer := 0;
begin
  if p_not_before is null or p_limit not between 1 and 2 or p_limit is null
     or (p_booking_id is not null and p_organization_id is null) then
    raise exception 'Invalid dispatch scope' using errcode = 'PB003';
  end if;
  for job in select n.* from public.booking_lifecycle_notices n
    where n.created_at >= p_not_before
      and (p_organization_id is null or n.organization_id = p_organization_id)
      and (p_booking_id is null or n.booking_id = p_booking_id)
      and ((n.status in ('pending', 'retryable') and n.next_attempt_at <= now())
        or (n.status = 'processing' and n.lease_expires_at < now()))
    order by n.next_attempt_at, n.created_at, n.id
    limit 50 for update skip locked
  loop
    select * into b from public.bookings
      where id = job.booking_id and organization_id = job.organization_id;
    if not found or (job.recipient = 'realtor' and b.suppress_realtor_notifications)
       or (job.event = 'rescheduled' and (b.status = 'cancelled' or
           b.scheduled_at is distinct from job.scheduled_at or exists (
             select 1 from public.booking_lifecycle_notices newer
             where newer.organization_id = job.organization_id and newer.booking_id = job.booking_id
               and newer.lifecycle_version > job.lifecycle_version
           ))) then
      update public.booking_lifecycle_notices set status = 'superseded',
        lease_token = null, lease_expires_at = null, completed_at = now()
        where id = job.id;
      continue;
    end if;
    if job.first_attempt_at <= now() - interval '23 hours' or job.attempt_count >= 8 then
      update public.booking_lifecycle_notices set status = 'dead_letter',
        error_code = 'delivery_unconfirmed', lease_token = null,
        lease_expires_at = null, completed_at = now() where id = job.id;
      continue;
    end if;
    update public.booking_lifecycle_notices set status = 'processing',
      attempt_count = attempt_count + 1, first_attempt_at = coalesce(first_attempt_at, now()),
      lease_token = gen_random_uuid(), lease_expires_at = now() + interval '90 seconds'
      where id = job.id returning * into job;
    return next job;
    claimed := claimed + 1;
    exit when claimed >= p_limit;
  end loop;
end;
$$;

create function public.finish_booking_lifecycle_notice(
  p_organization_id uuid, p_id uuid, p_lease_token uuid,
  p_provider_id text, p_error_code text
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed uuid;
begin
  if nullif(p_provider_id, '') is null and (p_error_code is null or p_error_code not in
    ('provider_unavailable', 'provider_rejected', 'delivery_unconfirmed')) then
    raise exception 'Invalid delivery outcome' using errcode = 'PB003';
  end if;
  update public.booking_lifecycle_notices set
    status = case when nullif(p_provider_id, '') is not null then 'completed'
      when attempt_count >= 8 or first_attempt_at <= now() - interval '23 hours'
        then 'dead_letter' else 'retryable' end,
    provider_id = nullif(p_provider_id, ''),
    error_code = case when nullif(p_provider_id, '') is not null then null else p_error_code end,
    completed_at = case when nullif(p_provider_id, '') is not null then now() else null end,
    next_attempt_at = now() + make_interval(mins => least(120, 5 * (2 ^ least(attempt_count, 5))::integer)),
    lease_token = null, lease_expires_at = null
    where id = p_id and organization_id = p_organization_id
      and status = 'processing' and lease_token = p_lease_token
    returning id into changed;
  return changed is not null;
end;
$$;

revoke all on function public.protect_booking_lifecycle_notice_payload() from public, anon, authenticated;
revoke all on function public.change_booking_with_lifecycle_notices(uuid, uuid, bigint, text, text, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_booking_lifecycle_notices(timestamptz, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.finish_booking_lifecycle_notice(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.protect_booking_lifecycle_notice_payload() to service_role;
grant execute on function public.change_booking_with_lifecycle_notices(uuid, uuid, bigint, text, text, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.claim_booking_lifecycle_notices(timestamptz, uuid, uuid, integer) to service_role;
grant execute on function public.finish_booking_lifecycle_notice(uuid, uuid, uuid, text, text) to service_role;
