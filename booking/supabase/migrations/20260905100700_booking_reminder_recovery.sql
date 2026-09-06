-- Private schedule-scoped reminders. No capability URLs or credentials stored.
create table public.booking_reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  booking_id uuid not null,
  schedule_version bigint not null check(schedule_version>0),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  status text not null default 'pending' check(status in ('pending','processing','retryable','completed','skipped','cancelled','dead_letter')),
  attempts integer not null default 0 check(attempts between 0 and 8),
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  request_hash text check(request_hash ~ '^[a-f0-9]{64}$'),
  provider_id text,
  completed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  foreign key(organization_id,booking_id) references public.bookings(organization_id,id),
  unique(organization_id,booking_id,schedule_version),
  check((status='processing')=(lease_token is not null and lease_expires_at is not null)),
  check(status<>'completed' or (completed_at is not null and nullif(provider_id,'') is not null))
);
alter table public.booking_reminder_jobs enable row level security;
revoke all on public.booking_reminder_jobs from public,anon,authenticated,service_role;
grant select on public.booking_reminder_jobs to service_role;
create index booking_reminder_jobs_due on public.booking_reminder_jobs(next_attempt_at) where status in ('pending','retryable','processing');

create function public.list_due_booking_reminders(p_limit integer default 20)
returns table(organization_id uuid,booking_id uuid,schedule_version bigint)
language sql security definer set search_path='' as $$
  select x.organization_id,x.booking_id,x.schedule_version from (
    select j.organization_id,j.booking_id,j.schedule_version,j.next_attempt_at due
    from public.booking_reminder_jobs j
    where (j.status in ('pending','retryable') and j.next_attempt_at<=now()) or (j.status='processing' and j.lease_expires_at<=now())
    union all
    select b.organization_id,b.id,b.schedule_version,b.scheduled_at-interval '24 hours'
    from public.bookings b where b.status in ('requested','confirmed')
      and b.scheduled_at>now() and b.scheduled_at<=now()+interval '24 hours'
      and b.reminder_sent_at is null
      and not exists(select 1 from public.booking_reminder_jobs j where j.organization_id=b.organization_id and j.booking_id=b.id and j.schedule_version=b.schedule_version)
  ) x order by due,organization_id,booking_id limit greatest(1,least(coalesce(p_limit,20),50));
$$;

create function public.claim_booking_reminder(p_organization_id uuid,p_booking_id uuid,p_schedule_version bigint,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; j public.booking_reminder_jobs%rowtype; snapshot jsonb;
begin
  if p_lease_token is null then raise exception 'Lease token required'; end if;
  select * into b from public.bookings where organization_id=p_organization_id and id=p_booking_id for update;
  if not found then return null; end if;
  select * into j from public.booking_reminder_jobs where organization_id=p_organization_id and booking_id=p_booking_id and schedule_version=p_schedule_version for update;
  if j.status='processing' and j.lease_expires_at>now() then return null; end if;
  if j.status in ('completed','skipped','cancelled','dead_letter') then return null; end if;
  if b.schedule_version<>p_schedule_version or b.status not in ('requested','confirmed') or b.scheduled_at is null or b.scheduled_at<=now() then
    update public.booking_reminder_jobs set status=case when attempts>0 then 'dead_letter' else 'cancelled' end,
      completed_at=now(),error_code='reminder_schedule_obsolete',lease_token=null,lease_expires_at=null where id=j.id;
    return null;
  end if;
  if b.scheduled_at>now()+interval '24 hours' then return null; end if;
  if j.id is null and b.reminder_sent_at is not null then return null; end if;
  select jsonb_build_object('scheduled_at',b.scheduled_at,'street_address',p.street_address,'city',p.city,
    'email',r.email,'contact_name',coalesce(r.full_name,r.email),'company_name',o.name,
    'from_name',coalesce(o.email_from_name,o.name),'reply_to',o.reply_to_email,
    'suppress_realtor_notifications',b.suppress_realtor_notifications)
  into snapshot from public.properties p join public.profiles r on r.id=b.owner_id and r.organization_id=b.organization_id and r.archived_at is null
    join public.organizations o on o.id=b.organization_id
  where p.id=b.property_id and p.organization_id=b.organization_id;
  if snapshot is null then
    update public.booking_reminder_jobs set status='dead_letter',completed_at=now(),error_code='reminder_snapshot_unavailable',lease_token=null,lease_expires_at=null where id=j.id;
    return null;
  end if;
  if j.id is null then
    insert into public.booking_reminder_jobs(organization_id,booking_id,schedule_version,payload)
    values(p_organization_id,p_booking_id,p_schedule_version,snapshot) returning * into j;
  end if;
  if j.payload is distinct from snapshot or j.attempts>=8 or j.first_attempt_at<=now()-interval '23 hours' then
    update public.booking_reminder_jobs set status='dead_letter',completed_at=now(),error_code='reminder_reconciliation_required',lease_token=null,lease_expires_at=null where id=j.id;
    return null;
  end if;
  if j.next_attempt_at>now() then return null; end if;
  update public.booking_reminder_jobs set status='processing',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),
    lease_token=p_lease_token,lease_expires_at=now()+interval '2 minutes' where id=j.id returning * into j;
  return to_jsonb(j)||jsonb_build_object('idempotency_key','reminder:'||j.id);
end $$;

-- Bind rendered provider bytes (including transient signed link) without storing
-- the capability. Template/secret/origin drift on retry is manual, never re-keyed.
create function public.authorize_booking_reminder(p_organization_id uuid,p_job_id uuid,p_lease_token uuid,p_request_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.booking_reminder_jobs%rowtype; b public.bookings%rowtype;
begin
  if p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  select b0.* into b from public.bookings b0 join public.booking_reminder_jobs j0 on j0.booking_id=b0.id and j0.organization_id=b0.organization_id
    where j0.id=p_job_id and j0.organization_id=p_organization_id for update of b0;
  select * into j from public.booking_reminder_jobs where id=p_job_id and organization_id=p_organization_id for update;
  if not found or j.status<>'processing' or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=now() then return false; end if;
  if b.schedule_version<>j.schedule_version or b.status not in ('requested','confirmed') or b.scheduled_at<=now()
    or (j.request_hash is not null and j.request_hash<>p_request_hash) then
    update public.booking_reminder_jobs set status='dead_letter',completed_at=now(),error_code='reminder_request_changed',lease_token=null,lease_expires_at=null where id=j.id;
    return false;
  end if;
  update public.booking_reminder_jobs set request_hash=p_request_hash where id=j.id;
  return true;
end $$;

create function public.finish_booking_reminder(p_organization_id uuid,p_job_id uuid,p_lease_token uuid,p_outcome text,p_provider_id text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.booking_reminder_jobs%rowtype;
begin
  if p_outcome is null or p_outcome not in ('completed','retryable','skipped','dead_letter') then return false; end if;
  -- Parent-first lock ordering matches claim, authorization and schedule edits.
  perform 1 from public.bookings b join public.booking_reminder_jobs r on r.booking_id=b.id and r.organization_id=b.organization_id
    where r.id=p_job_id and r.organization_id=p_organization_id for update of b;
  select * into j from public.booking_reminder_jobs where id=p_job_id and organization_id=p_organization_id for update;
  if not found or j.status<>'processing' or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=now() then return false; end if;
  if p_outcome='completed' and nullif(p_provider_id,'') is null then return false; end if;
  if p_outcome='retryable' and (j.attempts>=8 or j.first_attempt_at<=now()-interval '23 hours') then p_outcome:='dead_letter'; end if;
  update public.booking_reminder_jobs set status=p_outcome,provider_id=p_provider_id,lease_token=null,lease_expires_at=null,
    next_attempt_at=now()+interval '5 minutes',completed_at=case when p_outcome='retryable' then null else now() end,
    error_code=case when p_outcome in ('retryable','dead_letter') then 'reminder_send_unconfirmed' else null end where id=j.id;
  if p_outcome='completed' then
    update public.bookings set reminder_sent_at=now() where organization_id=p_organization_id and id=j.booking_id and schedule_version=j.schedule_version;
  end if;
  return true;
end $$;
revoke all on function public.list_due_booking_reminders(integer),public.claim_booking_reminder(uuid,uuid,bigint,uuid),public.authorize_booking_reminder(uuid,uuid,uuid,text),public.finish_booking_reminder(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.list_due_booking_reminders(integer),public.claim_booking_reminder(uuid,uuid,bigint,uuid),public.authorize_booking_reminder(uuid,uuid,uuid,text),public.finish_booking_reminder(uuid,uuid,uuid,text,text) to service_role;
