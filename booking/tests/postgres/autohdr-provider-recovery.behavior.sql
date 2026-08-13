\set ON_ERROR_STOP on

begin;
set local role service_role;

do $$
begin
  perform 1 from public.list_autohdr_jobs(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102'
  );
  begin
    perform 1 from public.list_autohdr_jobs(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222203'
    );
    raise exception 'service listing accepted a cross-tenant booking scope';
  exception when no_data_found then null;
  end;
end;
$$;

do $$
declare
  v_job record;
  v_reconciled public.autohdr_jobs;
  v_abandoned public.autohdr_jobs;
  v_first_evidence text;
begin
  select * into v_job from public.claim_autohdr_job(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101',
    'autohdr-reconcile-preparing', decode(repeat('31', 32), 'hex'),
    '[{"position":0,"source_media_version_id":"51111111-1111-4111-8111-111111111101","filename":"ReconPreparing.jpg"}]'::jsonb
  );
  perform public.transition_autohdr_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'claimed', 'preparing', null, null, null
  );
  select * into v_reconciled from public.reconcile_autohdr_provider_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'preparing', 'provider_create_ambiguous',
    'Provider returned an identity before local activation completed.', 'provider-reconcile-a'
  );
  if v_reconciled.state <> 'reconciliation_required'
     or v_reconciled.provider_uid <> 'provider-reconcile-a'
     or v_reconciled.provider_uid_assigned_at is null
     or v_reconciled.reconciliation_required_at is null
     or v_reconciled.reconciliation_source_state <> 'preparing'
     or v_reconciled.last_error_code <> 'provider_create_ambiguous'
     or v_reconciled.last_error_evidence is null then
    raise exception 'preparing reconciliation did not preserve bounded durable evidence';
  end if;
  v_first_evidence := v_reconciled.last_error_evidence;
  select * into v_reconciled from public.reconcile_autohdr_provider_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'preparing', 'different_retry', 'A later retry must not rewrite first evidence.', null
  );
  if v_reconciled.last_error_evidence <> v_first_evidence
     or v_reconciled.last_error_code <> 'provider_create_ambiguous' then
    raise exception 'reconciliation was not first-write idempotent';
  end if;
  begin
    perform public.abandon_autohdr_provider_job(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Wrong-tenant operator.'
    );
    raise exception 'wrong-tenant admin abandoned an AutoHDR job';
  exception when insufficient_privilege then null;
  end;
  select * into v_abandoned from public.abandon_autohdr_provider_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Confirmed no provider processing began.'
  );
  if v_abandoned.state <> 'rejected'
     or v_abandoned.abandoned_by <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
     or v_abandoned.abandoned_at is null
     or v_abandoned.abandon_reason <> 'Confirmed no provider processing began.'
     or v_abandoned.provider_uid <> 'provider-reconcile-a' then
    raise exception 'operator abandonment did not retain evidence and audit identity';
  end if;

  select * into v_job from public.claim_autohdr_job(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101',
    'autohdr-reconcile-awaiting', decode(repeat('32', 32), 'hex'),
    '[{"position":0,"source_media_version_id":"51111111-1111-4111-8111-111111111101","filename":"ReconAwaiting.jpg"}]'::jsonb
  );
  perform public.transition_autohdr_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'claimed', 'preparing', null, null, null
  );
  select * into v_job from public.activate_autohdr_provider_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id, 'provider-reconcile-b'
  );
  if exists (select 1 from public.autohdr_jobs where state = 'preparing' and provider_uid is not null) then
    raise exception 'a provider uid persisted in preparing';
  end if;
  select * into v_reconciled from public.reconcile_autohdr_provider_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'awaiting_upload', 'upload_capability_lost', 'One-use upload capability is no longer available.', null
  );
  if v_reconciled.reconciliation_source_state <> 'awaiting_upload'
     or v_reconciled.upload_started_at is null then
    raise exception 'awaiting-upload reconciliation lost phase evidence';
  end if;
  perform public.abandon_autohdr_provider_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Expired upload capability; provider never finalized.'
  );

  begin
    perform public.reconcile_autohdr_provider_job(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
      'awaiting_upload', 'oversized_evidence', repeat('x', 501), null
    );
    raise exception 'oversized reconciliation evidence was accepted';
  exception when invalid_parameter_value then null;
  end;

  select * into v_job from public.claim_autohdr_job(
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111101',
    'autohdr-reconcile-finalizing', decode(repeat('33', 32), 'hex'),
    '[{"position":0,"source_media_version_id":"51111111-1111-4111-8111-111111111101","filename":"ReconFinalizing.jpg"}]'::jsonb
  );
  perform public.transition_autohdr_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'claimed', 'preparing', null, null, null
  );
  select * into v_job from public.activate_autohdr_provider_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id, 'provider-reconcile-c'
  );
  select * into v_job from public.transition_autohdr_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'awaiting_upload', 'finalizing', 'uploading', null, null
  );
  select * into v_reconciled from public.reconcile_autohdr_provider_job(
    v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
    'finalizing', 'finalize_ambiguous', 'Finalize response was not authoritative.', null
  );
  if v_reconciled.finalize_started_at is null
     or v_reconciled.reconciliation_source_state <> 'finalizing' then
    raise exception 'finalizing reconciliation lost phase evidence';
  end if;
  begin
    perform public.abandon_autohdr_provider_job(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Unsafe finalizing abandon attempt.'
    );
    raise exception 'finalizing reconciliation was abandoned';
  exception when check_violation then null;
  end;

  select * into v_job from public.autohdr_jobs
   where organization_id = '11111111-1111-4111-8111-111111111111'
     and idempotency_key = 'autohdr-fixture-a';
  begin
    perform public.abandon_autohdr_provider_job(
      v_job.organization_id, v_job.booking_id, v_job.property_id, v_job.id,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Unsafe ready abandon attempt.'
    );
    raise exception 'ready job was abandoned';
  exception when check_violation then null;
  end;
end;
$$;

reset role;
rollback;
