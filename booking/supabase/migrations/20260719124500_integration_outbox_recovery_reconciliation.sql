-- Add scheduled recovery discovery and operator reconciliation without changing
-- immutable job identity, lease fencing, provider idempotency, or ambiguity rules.

alter table public.integration_jobs
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciled_by uuid,
  add column if not exists reconciliation_category text,
  add column if not exists reconciliation_note text;

alter table public.integration_jobs
  add constraint integration_jobs_reconciliation_audit_check check (
    (reconciled_at is null
      and reconciled_by is null
      and reconciliation_category is null
      and reconciliation_note is null)
    or
    (reconciled_at is not null
      and reconciled_by is not null
      and reconciliation_category in (
        'provider_confirmed_completed',
        'provider_confirmed_absent',
        'duplicate_resolved',
        'accepted_manual_resolution'
      )
      and pg_catalog.char_length(reconciliation_note) between 10 and 2000)
  );

create or replace function public.preserve_integration_job_reconciliation_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.reconciled_at is not null
    and (
      new.reconciled_at,
      new.reconciled_by,
      new.reconciliation_category,
      new.reconciliation_note
    ) is distinct from (
      old.reconciled_at,
      old.reconciled_by,
      old.reconciliation_category,
      old.reconciliation_note
    )
  then
    raise exception 'Completed integration reconciliation audit is immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger preserve_integration_job_reconciliation_audit_trigger
before update on public.integration_jobs
for each row execute function public.preserve_integration_job_reconciliation_audit();

-- A retryable state means a mutation can be attempted again automatically.
-- Only Resend jobs have a durable provider idempotency key and bounded window.
update public.integration_jobs job
set status = 'dead_letter',
    completed_at = pg_catalog.now(),
    last_error_code = 'unsafe_retryable_status',
    last_error_message = 'Non-email provider work cannot be automatically retried',
    last_error_at = pg_catalog.now(),
    lease_token = null,
    locked_by = null,
    locked_at = null,
    lease_expires_at = null,
    updated_at = pg_catalog.now()
where job.status = 'retryable'
  and job.job_type not in (
    'email.booking.confirmation',
    'email.admin.new_booking'
  );

alter table public.integration_jobs
  add constraint integration_jobs_retryable_email_only_check check (
    status <> 'retryable'
    or job_type in (
      'email.booking.confirmation',
      'email.admin.new_booking'
    )
  );

create index integration_jobs_unresolved_exceptions_idx
  on public.integration_jobs(organization_id, updated_at desc, id)
  where reconciled_at is null
    and status in ('retryable', 'dead_letter', 'processing');

create or replace function public.list_due_integration_jobs(
  p_limit integer,
  p_dispatch_not_before timestamptz
)
returns table (
  organization_id uuid,
  booking_id uuid,
  job_type text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Integration dispatch limit must be between 1 and 50'
      using errcode = 'PB003';
  end if;
  if p_dispatch_not_before is null
    or not pg_catalog.isfinite(p_dispatch_not_before)
  then
    raise exception 'Integration dispatch watermark is required'
      using errcode = 'PB003';
  end if;

  return query
  with eligible as (
    select
      job.organization_id,
      job.booking_id,
      job.job_type,
      job.id,
      job.created_at,
      case
        when job.status = 'processing' then job.lease_expires_at
        else job.next_attempt_at
      end as due_at,
      case job.job_type
        when 'quickbooks.invoice.create' then 1
        when 'google_calendar.event.create' then 2
        when 'email.booking.confirmation' then 3
        when 'email.admin.new_booking' then 4
        when 'push.admin.new_booking' then 5
        else 99
      end as job_priority
    from public.integration_jobs job
    join public.bookings booking
      on booking.organization_id = job.organization_id
     and booking.id = job.booking_id
    where job.created_at >= p_dispatch_not_before
      and (
        (
          job.status = 'pending'
          and job.attempts < job.max_attempts
          and job.next_attempt_at <= pg_catalog.now()
        )
        or (
          job.status = 'retryable'
          and job.attempts < job.max_attempts
          and job.job_type in (
            'email.booking.confirmation',
            'email.admin.new_booking'
          )
          and job.next_attempt_at <= pg_catalog.now()
        )
        or (
          job.status = 'processing'
          and job.lease_expires_at <= pg_catalog.now()
        )
      )
  ), booking_heads as (
    select eligible.*,
      pg_catalog.row_number() over (
        partition by eligible.organization_id, eligible.booking_id
        order by eligible.job_priority, eligible.due_at, eligible.created_at, eligible.id
      ) as booking_position
    from eligible
  ), tenant_ranked as (
    select booking_heads.*,
      pg_catalog.row_number() over (
        partition by booking_heads.organization_id
        order by booking_heads.booking_position, booking_heads.due_at,
          booking_heads.job_priority, booking_heads.created_at,
          booking_heads.booking_id, booking_heads.id
      ) as tenant_position
    from booking_heads
  )
  select
    tenant_ranked.organization_id,
    tenant_ranked.booking_id,
    tenant_ranked.job_type
  from tenant_ranked
  order by
    tenant_ranked.tenant_position,
    tenant_ranked.due_at,
    tenant_ranked.job_priority,
    tenant_ranked.organization_id,
    tenant_ranked.booking_id
  limit p_limit;
end;
$$;

create or replace function public.reconcile_integration_job(
  p_organization_id uuid,
  p_job_id uuid,
  p_category text,
  p_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  changed_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;
  if pg_catalog.btrim(coalesce(p_category, '')) not in (
    'provider_confirmed_completed',
    'provider_confirmed_absent',
    'duplicate_resolved',
    'accepted_manual_resolution'
  ) then
    raise exception 'A valid reconciliation category is required'
      using errcode = 'PB003';
  end if;
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_note, ''))) not between 10 and 2000 then
    raise exception 'Reconciliation note must be between 10 and 2000 characters'
      using errcode = 'PB003';
  end if;
  if not exists (
    select 1
    from public.organization_members membership
    join public.profiles profile
      on profile.id = membership.profile_id
     and profile.organization_id = membership.organization_id
     and profile.archived_at is null
    where membership.organization_id = p_organization_id
      and membership.profile_id = actor_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception 'Organization admin access is required'
      using errcode = '42501';
  end if;

  update public.integration_jobs job
  set reconciled_at = pg_catalog.now(),
      reconciled_by = actor_id,
      reconciliation_category = pg_catalog.btrim(p_category),
      reconciliation_note = pg_catalog.btrim(p_note),
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.id = p_job_id
    and job.status = 'dead_letter'
    and job.reconciled_at is null
  returning job.id into changed_id;

  return changed_id is not null;
end;
$$;

-- Preserve the existing claim behavior while bounding stored worker identity.
create or replace function public.claim_integration_job(
  p_organization_id uuid,
  p_booking_id uuid,
  p_job_type text,
  p_worker_id text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed record;
begin
  if p_lease_token is null
    or nullif(pg_catalog.btrim(p_worker_id), '') is null
    or pg_catalog.char_length(p_worker_id) > 96
  then
    raise exception 'Integration job lease identity is required and bounded'
      using errcode = 'PB003';
  end if;

  -- Cancellation is authoritative at claim time. Unleased work is terminalized
  -- without a provider call; an expired processing lease remains ambiguous.
  update public.integration_jobs job
  set status = 'cancelled',
      completed_at = pg_catalog.now(),
      last_error_code = 'booking_cancelled',
      last_error_message = 'Booking was cancelled before integration dispatch',
      last_error_at = pg_catalog.now(),
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  from public.bookings booking
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and booking.organization_id = job.organization_id
    and booking.id = job.booking_id
    and booking.status = 'cancelled'
    and job.status in ('pending', 'retryable');

  update public.integration_jobs job
  set status = 'dead_letter',
      completed_at = pg_catalog.now(),
      last_error_code = 'lease_expired_ambiguous',
      last_error_message = 'Provider attempt lease expired after booking cancellation; reconciliation required',
      last_error_at = pg_catalog.now(),
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  from public.bookings booking
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and booking.organization_id = job.organization_id
    and booking.id = job.booking_id
    and booking.status = 'cancelled'
    and job.status = 'processing'
    and job.lease_expires_at <= pg_catalog.now();

  update public.integration_jobs job
  set status = 'dead_letter',
      completed_at = pg_catalog.now(),
      last_error_code = 'lease_expired_ambiguous',
      last_error_message = 'Provider attempt lease expired; manual reconciliation required',
      last_error_at = pg_catalog.now(),
      lease_token = null,
      locked_by = null,
      locked_at = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.status = 'processing'
    and job.lease_expires_at <= pg_catalog.now()
    and (
      job.job_type not in (
        'email.booking.confirmation',
        'email.admin.new_booking'
      )
      or job.attempts >= job.max_attempts
      or job.created_at <= pg_catalog.now() - interval '23 hours'
    );

  update public.integration_jobs job
  set status = 'dead_letter',
      completed_at = pg_catalog.now(),
      last_error_code = 'provider_idempotency_window_expired',
      last_error_message = 'Email retry exceeded the safe provider idempotency window',
      last_error_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.status = 'retryable'
    and job.job_type in ('email.booking.confirmation', 'email.admin.new_booking')
    and job.created_at <= pg_catalog.now() - interval '23 hours';

  update public.integration_jobs job
  set status = 'processing',
      attempts = job.attempts + 1,
      lease_token = p_lease_token,
      locked_by = pg_catalog.btrim(p_worker_id),
      locked_at = pg_catalog.now(),
      lease_expires_at = pg_catalog.now() + interval '10 minutes',
      completed_at = null,
      updated_at = pg_catalog.now()
  where job.organization_id = p_organization_id
    and job.booking_id = p_booking_id
    and job.job_type = p_job_type
    and job.attempts < job.max_attempts
    and exists (
      select 1
      from public.bookings booking
      where booking.organization_id = job.organization_id
        and booking.id = job.booking_id
        and booking.status <> 'cancelled'
    )
    and (
      job.job_type <> 'email.booking.confirmation'
      or not exists (
        select 1
        from public.integration_jobs invoice_job
        where invoice_job.organization_id = job.organization_id
          and invoice_job.booking_id = job.booking_id
          and invoice_job.job_type = 'quickbooks.invoice.create'
          and invoice_job.status not in ('completed', 'skipped', 'cancelled', 'dead_letter')
      )
    )
    and (
      (
        (
          job.status = 'pending'
          or (
            job.status = 'retryable'
            and job.job_type in (
              'email.booking.confirmation',
              'email.admin.new_booking'
            )
            and job.created_at > pg_catalog.now() - interval '23 hours'
          )
        )
        and job.next_attempt_at <= pg_catalog.now()
      )
      or (
        job.status = 'processing'
        and job.lease_expires_at <= pg_catalog.now()
        and job.created_at > pg_catalog.now() - interval '23 hours'
        and job.job_type in (
          'email.booking.confirmation',
          'email.admin.new_booking'
        )
      )
    )
  returning job.* into claimed;

  if not found then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', claimed.id,
    'organization_id', claimed.organization_id,
    'booking_id', claimed.booking_id,
    'job_type', claimed.job_type,
    'payload_version', claimed.payload_version,
    'idempotency_key', claimed.idempotency_key,
    'payload', claimed.payload,
    'dependency_result', case
      when claimed.job_type = 'email.booking.confirmation' then (
        select invoice_job.provider_result
        from public.integration_jobs invoice_job
        where invoice_job.organization_id = claimed.organization_id
          and invoice_job.booking_id = claimed.booking_id
          and invoice_job.job_type = 'quickbooks.invoice.create'
          and invoice_job.status = 'completed'
        limit 1
      )
      else null
    end,
    'attempts', claimed.attempts,
    'max_attempts', claimed.max_attempts,
    'lease_token', p_lease_token
  );
end;
$$;

revoke all on function public.list_due_integration_jobs(integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.list_due_integration_jobs(integer, timestamptz)
  to service_role;

revoke all on function public.reconcile_integration_job(uuid, uuid, text, text)
  from public, anon, service_role;
grant execute on function public.reconcile_integration_job(uuid, uuid, text, text)
  to authenticated;

revoke all on function public.claim_integration_job(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_integration_job(uuid, uuid, text, text, uuid)
  to service_role;

comment on function public.list_due_integration_jobs(integer, timestamptz) is
  'Service-only identities list for tenant-fair scheduled recovery, bounded by a rollout cutoff.';
comment on function public.reconcile_integration_job(uuid, uuid, text, text) is
  'Single-use tenant-admin audit acknowledgement for an unresolved dead-letter job; never retries provider work.';
