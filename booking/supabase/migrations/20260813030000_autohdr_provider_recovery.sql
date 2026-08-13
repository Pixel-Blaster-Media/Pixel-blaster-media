-- Recover AutoHDR provider jobs without persisting one-use upload capabilities.
-- This migration is additive to the canonical source and provider state-machine
-- migrations. Durable evidence is limited to identities, phases, timestamps,
-- bounded operator/error context, and audit identities.

alter table public.autohdr_jobs
  add column upload_started_at timestamptz,
  add column finalize_started_at timestamptz,
  add column reconciliation_required_at timestamptz,
  add column reconciliation_source_state text,
  add column last_error_evidence text,
  add column abandoned_at timestamptz,
  add column abandoned_by uuid references public.profiles (id) on delete restrict,
  add column abandon_reason text;

alter table public.autohdr_jobs
  add constraint autohdr_jobs_reconciliation_source_check check (
    reconciliation_source_state is null
    or reconciliation_source_state in ('preparing', 'awaiting_upload', 'finalizing')
  ),
  add constraint autohdr_jobs_error_evidence_check check (
    last_error_evidence is null
    or (
      last_error_evidence = pg_catalog.btrim(last_error_evidence)
      and pg_catalog.char_length(last_error_evidence) between 1 and 500
      and last_error_evidence !~ '[[:cntrl:]]'
    )
  ),
  add constraint autohdr_jobs_abandon_audit_check check (
    (abandoned_at is null and abandoned_by is null and abandon_reason is null)
    or (
      abandoned_at is not null
      and abandoned_by is not null
      and state = 'rejected'
      and abandon_reason = pg_catalog.btrim(abandon_reason)
      and pg_catalog.char_length(abandon_reason) between 1 and 500
      and abandon_reason !~ '[[:cntrl:]]'
    )
  );

-- Repair the only legacy partial state that the split assignment RPC could
-- have persisted. Its upload capability cannot be reconstructed after reload.
update public.autohdr_jobs
   set state = 'reconciliation_required',
       provider_status = coalesce(provider_status, 'unknown'),
       last_error_code = 'legacy_partial_provider_assignment',
       last_error_at = pg_catalog.now(),
       last_error_evidence = 'Provider identity was stored before upload phase activation.',
       reconciliation_required_at = pg_catalog.now(),
       reconciliation_source_state = 'preparing'
 where state = 'preparing'
   and provider_uid is not null;

update public.autohdr_jobs
   set upload_started_at = coalesce(provider_uid_assigned_at, state_changed_at, created_at)
 where state in ('awaiting_upload', 'finalizing', 'processing', 'ready', 'retrieving', 'review_pending')
   and upload_started_at is null;

update public.autohdr_jobs
   set finalize_started_at = coalesce(state_changed_at, provider_uid_assigned_at, created_at)
 where state in ('finalizing', 'processing', 'ready', 'retrieving', 'review_pending')
   and finalize_started_at is null;

alter table public.autohdr_jobs
  add constraint autohdr_jobs_no_preparing_provider_uid_check check (
    state <> 'preparing' or provider_uid is null
  ),
  add constraint autohdr_jobs_upload_phase_check check (
    state not in ('awaiting_upload', 'finalizing', 'processing', 'ready', 'retrieving', 'review_pending')
    or upload_started_at is not null
  ),
  add constraint autohdr_jobs_finalize_phase_check check (
    state not in ('finalizing', 'processing', 'ready', 'retrieving', 'review_pending')
    or finalize_started_at is not null
  );

create or replace function public.is_valid_autohdr_job_transition(
  p_old_state text,
  p_new_state text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_old_state
    when 'claimed' then p_new_state in (
      'preparing', 'retryable', 'reconciliation_required', 'rejected'
    )
    when 'preparing' then p_new_state in (
      'awaiting_upload', 'retryable', 'reconciliation_required', 'rejected'
    )
    when 'awaiting_upload' then p_new_state in (
      'finalizing', 'retryable', 'reconciliation_required', 'rejected'
    )
    when 'finalizing' then p_new_state in (
      'processing', 'retryable', 'reconciliation_required', 'rejected'
    )
    when 'processing' then p_new_state in (
      'ready', 'retryable', 'reconciliation_required', 'rejected'
    )
    when 'ready' then p_new_state in (
      'retrieving', 'reconciliation_required', 'rejected'
    )
    when 'retrieving' then p_new_state in (
      'review_pending', 'reconciliation_required', 'rejected'
    )
    when 'retryable' then p_new_state in (
      'preparing', 'reconciliation_required', 'rejected'
    )
    when 'reconciliation_required' then p_new_state = 'rejected'
    else false
  end;
$$;

create or replace function public.enforce_autohdr_job_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'claimed'
       or new.provider_uid is not null
       or new.provider_status is not null
       or new.provider_uid_assigned_at is not null
       or new.upload_started_at is not null
       or new.finalize_started_at is not null
       or new.reconciliation_required_at is not null
       or new.reconciliation_source_state is not null
       or new.last_error_code is not null
       or new.last_error_at is not null
       or new.last_error_evidence is not null
       or new.abandoned_at is not null
       or new.abandoned_by is not null
       or new.abandon_reason is not null
       or new.retrieval_claimed_at is not null
       or new.retrieval_claim_token is not null then
      raise exception 'AutoHDR jobs must start in the claimed state'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if (
    new.id, new.organization_id, new.booking_id, new.property_id,
    new.idempotency_key, new.manifest_sha256, new.file_count, new.created_at
  ) is distinct from (
    old.id, old.organization_id, old.booking_id, old.property_id,
    old.idempotency_key, old.manifest_sha256, old.file_count, old.created_at
  ) then
    raise exception 'AutoHDR job identity is immutable' using errcode = '23514';
  end if;

  if new.provider_uid is distinct from old.provider_uid then
    if old.provider_uid is not null
       or new.provider_uid is null
       or old.state <> 'preparing'
       or new.state not in ('awaiting_upload', 'reconciliation_required')
       or new.provider_uid_assigned_at is null then
      raise exception 'AutoHDR provider activation is invalid' using errcode = '23514';
    end if;
  elsif new.provider_uid_assigned_at is distinct from old.provider_uid_assigned_at then
    raise exception 'AutoHDR provider assignment timestamp is immutable'
      using errcode = '23514';
  end if;

  if new.upload_started_at is distinct from old.upload_started_at then
    if old.upload_started_at is not null
       or old.state <> 'preparing'
       or new.state <> 'awaiting_upload'
       or new.upload_started_at is null then
      raise exception 'AutoHDR upload phase evidence is invalid' using errcode = '23514';
    end if;
  end if;
  if new.finalize_started_at is distinct from old.finalize_started_at then
    if old.finalize_started_at is not null
       or old.state <> 'awaiting_upload'
       or new.state <> 'finalizing'
       or new.finalize_started_at is null then
      raise exception 'AutoHDR finalize phase evidence is invalid' using errcode = '23514';
    end if;
  end if;

  if (new.reconciliation_required_at, new.reconciliation_source_state)
     is distinct from (old.reconciliation_required_at, old.reconciliation_source_state) then
    if old.reconciliation_required_at is not null
       or old.reconciliation_source_state is not null
       or old.state not in ('preparing', 'awaiting_upload', 'finalizing')
       or new.state <> 'reconciliation_required'
       or new.reconciliation_required_at is null
       or new.reconciliation_source_state <> old.state then
      raise exception 'AutoHDR reconciliation evidence is invalid' using errcode = '23514';
    end if;
  end if;

  if (new.abandoned_at, new.abandoned_by, new.abandon_reason)
     is distinct from (old.abandoned_at, old.abandoned_by, old.abandon_reason) then
    if old.abandoned_at is not null
       or old.abandoned_by is not null
       or old.abandon_reason is not null
       or new.state <> 'rejected'
       or old.state not in ('preparing', 'awaiting_upload', 'reconciliation_required')
       or new.abandoned_at is null
       or new.abandoned_by is null
       or new.abandon_reason is null then
      raise exception 'AutoHDR abandonment audit is invalid' using errcode = '23514';
    end if;
  end if;

  if (new.retrieval_claimed_at, new.retrieval_claim_token)
     is distinct from (old.retrieval_claimed_at, old.retrieval_claim_token) then
    if old.state <> 'ready'
       or new.state <> 'retrieving'
       or old.retrieval_claimed_at is not null
       or old.retrieval_claim_token is not null
       or new.retrieval_claimed_at is null
       or new.retrieval_claim_token is null then
      raise exception 'AutoHDR retrieval claim is invalid' using errcode = '23514';
    end if;
  end if;

  if new.state is distinct from old.state then
    if not public.is_valid_autohdr_job_transition(old.state, new.state) then
      raise exception 'Invalid AutoHDR job transition' using errcode = '23514';
    end if;
    new.state_changed_at := pg_catalog.now();
  elsif new.state_changed_at is distinct from old.state_changed_at then
    raise exception 'AutoHDR state timestamp is immutable without a transition'
      using errcode = '23514';
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function public.transition_autohdr_job(
  p_organization_id uuid,
  p_booking_id uuid,
  p_property_id uuid,
  p_job_id uuid,
  p_expected_state text,
  p_new_state text,
  p_provider_status text,
  p_error_code text,
  p_retrieval_claim_token uuid
)
returns setof public.autohdr_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.autohdr_jobs;
begin
  if p_organization_id is null or p_booking_id is null or p_property_id is null
     or p_job_id is null or p_expected_state is null or p_new_state is null
     or (p_provider_status is not null and p_provider_status not in (
       'created', 'uploading', 'processing', 'ready', 'failed', 'unknown'
     ))
     or (p_error_code is not null and p_error_code !~ '^[a-z0-9][a-z0-9._-]{0,95}$')
     or (p_new_state in ('retryable', 'reconciliation_required', 'rejected') and p_error_code is null) then
    raise exception 'Invalid AutoHDR transition input' using errcode = '22023';
  end if;
  if p_new_state = 'retrieving'
     or (p_new_state = 'rejected' and p_expected_state in (
       'preparing', 'awaiting_upload', 'reconciliation_required'
     ))
     or (p_expected_state in ('preparing', 'awaiting_upload', 'finalizing') and p_new_state = 'reconciliation_required')
     or not public.is_valid_autohdr_job_transition(p_expected_state, p_new_state) then
    raise exception 'Invalid AutoHDR job transition' using errcode = '23514';
  end if;

  if p_expected_state = 'claimed' and p_new_state = 'preparing' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_organization_id::text || ':' || p_booking_id::text, 0)
    );
    if exists (
      select 1 from public.autohdr_jobs job
       where job.organization_id = p_organization_id
         and job.booking_id = p_booking_id
         and job.id <> p_job_id
         and job.state in ('preparing', 'awaiting_upload', 'finalizing', 'reconciliation_required')
    ) then
      raise exception 'An unresolved AutoHDR provider job blocks new provider preparation'
        using errcode = '23514';
    end if;
  end if;

  update public.autohdr_jobs job
     set state = p_new_state,
         provider_status = coalesce(p_provider_status, job.provider_status),
         finalize_started_at = case
           when p_expected_state = 'awaiting_upload' and p_new_state = 'finalizing'
             then pg_catalog.now()
           else job.finalize_started_at
         end,
         last_error_code = coalesce(p_error_code, job.last_error_code),
         last_error_at = case when p_error_code is not null then pg_catalog.now() else job.last_error_at end
   where job.organization_id = p_organization_id
     and job.booking_id = p_booking_id
     and job.property_id = p_property_id
     and job.id = p_job_id
     and job.state = p_expected_state
     and (p_expected_state <> 'retrieving' or (
       p_retrieval_claim_token is not null and job.retrieval_claim_token = p_retrieval_claim_token
     ))
  returning * into v_job;

  if v_job.id is null then
    if not exists (
      select 1 from public.autohdr_jobs job
       where job.organization_id = p_organization_id and job.booking_id = p_booking_id
         and job.property_id = p_property_id and job.id = p_job_id
    ) then
      raise no_data_found using message = 'AutoHDR job scope was not found';
    end if;
    raise exception 'AutoHDR job state or retrieval token did not match' using errcode = '23514';
  end if;
  return next v_job;
end;
$$;

drop function public.assign_autohdr_provider_uid(uuid, uuid, uuid, uuid, text, text);

create function public.activate_autohdr_provider_job(
  p_organization_id uuid,
  p_booking_id uuid,
  p_property_id uuid,
  p_job_id uuid,
  p_provider_uid text
)
returns setof public.autohdr_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.autohdr_jobs;
begin
  if p_organization_id is null or p_booking_id is null or p_property_id is null
     or p_job_id is null or p_provider_uid is null
     or p_provider_uid !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$' then
    raise exception 'Invalid AutoHDR provider activation input' using errcode = '22023';
  end if;

  update public.autohdr_jobs job
     set state = 'awaiting_upload',
         provider_uid = p_provider_uid,
         provider_status = 'uploading',
         provider_uid_assigned_at = pg_catalog.now(),
         upload_started_at = pg_catalog.now()
   where job.organization_id = p_organization_id and job.booking_id = p_booking_id
     and job.property_id = p_property_id and job.id = p_job_id
     and job.state = 'preparing' and job.provider_uid is null
  returning * into v_job;

  if v_job.id is null then
    select * into v_job from public.autohdr_jobs job
     where job.organization_id = p_organization_id and job.booking_id = p_booking_id
       and job.property_id = p_property_id and job.id = p_job_id
     for update;
    if v_job.id is null then
      raise no_data_found using message = 'AutoHDR job scope was not found';
    end if;
    if v_job.state = 'awaiting_upload' and v_job.provider_uid = p_provider_uid then
      return next v_job;
      return;
    end if;
    raise exception 'AutoHDR provider activation conflicts with durable state' using errcode = '23514';
  end if;
  return next v_job;
end;
$$;

create function public.reconcile_autohdr_provider_job(
  p_organization_id uuid,
  p_booking_id uuid,
  p_property_id uuid,
  p_job_id uuid,
  p_expected_state text,
  p_error_code text,
  p_error_evidence text,
  p_provider_uid text default null
)
returns setof public.autohdr_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.autohdr_jobs;
begin
  if p_organization_id is null or p_booking_id is null or p_property_id is null
     or p_job_id is null or p_expected_state not in ('preparing', 'awaiting_upload', 'finalizing')
     or p_error_code is null or p_error_code !~ '^[a-z0-9][a-z0-9._-]{0,95}$'
     or p_error_evidence is null or p_error_evidence <> pg_catalog.btrim(p_error_evidence)
     or pg_catalog.char_length(p_error_evidence) not between 1 and 500
     or p_error_evidence ~ '[[:cntrl:]]'
     or (p_provider_uid is not null and p_provider_uid !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$') then
    raise exception 'Invalid AutoHDR reconciliation input' using errcode = '22023';
  end if;

  select * into v_job from public.autohdr_jobs job
   where job.organization_id = p_organization_id and job.booking_id = p_booking_id
     and job.property_id = p_property_id and job.id = p_job_id
   for update;
  if v_job.id is null then
    raise no_data_found using message = 'AutoHDR job scope was not found';
  end if;
  if v_job.state = 'reconciliation_required' then
    return next v_job;
    return;
  end if;
  if v_job.state <> p_expected_state
     or (p_expected_state <> 'preparing' and p_provider_uid is not null and p_provider_uid <> v_job.provider_uid)
     or (p_expected_state = 'preparing' and v_job.provider_uid is not null) then
    raise exception 'AutoHDR reconciliation conflicts with durable state' using errcode = '23514';
  end if;

  update public.autohdr_jobs job
     set state = 'reconciliation_required',
         provider_uid = coalesce(job.provider_uid, p_provider_uid),
         provider_uid_assigned_at = case
           when job.provider_uid is null and p_provider_uid is not null then pg_catalog.now()
           else job.provider_uid_assigned_at
         end,
         provider_status = coalesce(job.provider_status, case when p_provider_uid is null then 'unknown' else 'created' end),
         last_error_code = p_error_code,
         last_error_evidence = p_error_evidence,
         last_error_at = pg_catalog.now(),
         reconciliation_required_at = pg_catalog.now(),
         reconciliation_source_state = p_expected_state
   where job.organization_id = p_organization_id and job.booking_id = p_booking_id
     and job.property_id = p_property_id and job.id = p_job_id
  returning * into v_job;
  return next v_job;
end;
$$;

create function public.abandon_autohdr_provider_job(
  p_organization_id uuid,
  p_booking_id uuid,
  p_property_id uuid,
  p_job_id uuid,
  p_admin_user_id uuid,
  p_reason text
)
returns setof public.autohdr_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.autohdr_jobs;
begin
  if p_organization_id is null or p_booking_id is null or p_property_id is null
     or p_job_id is null or p_admin_user_id is null or p_reason is null
     or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception 'Invalid AutoHDR abandonment input' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles profile
    join public.organization_members membership
      on membership.profile_id = profile.id
     and membership.organization_id = profile.organization_id
    where profile.id = p_admin_user_id
      and profile.organization_id = p_organization_id
      and profile.archived_at is null
      and profile.role::text = 'admin'
      and membership.role in ('owner', 'admin')
  ) then
    raise exception 'AutoHDR abandonment requires an active organization admin' using errcode = '42501';
  end if;

  select * into v_job from public.autohdr_jobs job
   where job.organization_id = p_organization_id and job.booking_id = p_booking_id
     and job.property_id = p_property_id and job.id = p_job_id
   for update;
  if v_job.id is null then
    raise no_data_found using message = 'AutoHDR job scope was not found';
  end if;
  if v_job.state not in ('preparing', 'awaiting_upload', 'reconciliation_required')
     or v_job.finalize_started_at is not null
     or (v_job.state = 'reconciliation_required' and v_job.reconciliation_source_state not in ('preparing', 'awaiting_upload')) then
    raise exception 'Only pre-processing stranded AutoHDR jobs may be abandoned' using errcode = '23514';
  end if;

  update public.autohdr_jobs job
     set state = 'rejected',
         last_error_code = 'operator_abandoned',
         last_error_at = pg_catalog.now(),
         abandoned_at = pg_catalog.now(),
         abandoned_by = p_admin_user_id,
         abandon_reason = p_reason
   where job.organization_id = p_organization_id and job.booking_id = p_booking_id
     and job.property_id = p_property_id and job.id = p_job_id
  returning * into v_job;
  return next v_job;
end;
$$;

drop function public.list_autohdr_jobs(uuid, uuid);

create function public.list_autohdr_jobs(
  p_organization_id uuid,
  p_booking_id uuid
)
returns table (
  id uuid, organization_id uuid, booking_id uuid, property_id uuid,
  state text, provider_uid text, provider_status text,
  provider_uid_assigned_at timestamptz, upload_started_at timestamptz,
  finalize_started_at timestamptz, reconciliation_required_at timestamptz,
  reconciliation_source_state text, last_error_code text,
  last_error_evidence text, last_error_at timestamptz,
  abandoned_at timestamptz, abandoned_by uuid, abandon_reason text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_booking_id is null then
    raise exception 'Invalid AutoHDR read scope' using errcode = '22023';
  end if;
  if pg_catalog.current_setting('role', true) <> 'service_role'
     and not public.is_organization_admin(p_organization_id) then
    raise exception 'AutoHDR jobs are outside the active admin tenant' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.bookings booking
     where booking.organization_id = p_organization_id and booking.id = p_booking_id
  ) then
    raise no_data_found using message = 'AutoHDR booking scope was not found';
  end if;

  return query select
    job.id, job.organization_id, job.booking_id, job.property_id,
    job.state, job.provider_uid, job.provider_status,
    job.provider_uid_assigned_at, job.upload_started_at, job.finalize_started_at,
    job.reconciliation_required_at, job.reconciliation_source_state,
    job.last_error_code, job.last_error_evidence, job.last_error_at,
    job.abandoned_at, job.abandoned_by, job.abandon_reason,
    job.created_at, job.updated_at
  from public.autohdr_jobs job
  where job.organization_id = p_organization_id and job.booking_id = p_booking_id
  order by job.created_at desc
  limit 20;
end;
$$;

revoke all on function public.activate_autohdr_provider_job(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.reconcile_autohdr_provider_job(uuid, uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.abandon_autohdr_provider_job(uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.activate_autohdr_provider_job(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.reconcile_autohdr_provider_job(uuid, uuid, uuid, uuid, text, text, text, text)
  to service_role;
grant execute on function public.abandon_autohdr_provider_job(uuid, uuid, uuid, uuid, uuid, text)
  to service_role;

revoke all on function public.list_autohdr_jobs(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_autohdr_jobs(uuid, uuid)
  to authenticated, service_role;
