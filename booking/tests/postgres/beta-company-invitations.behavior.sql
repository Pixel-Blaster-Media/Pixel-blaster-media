do $test$
declare
  actor_id uuid := '81000000-0000-4000-8000-000000000001';
  owner_id uuid := '81000000-0000-4000-8000-000000000002';
  other_id uuid := '81000000-0000-4000-8000-000000000003';
  platform_org uuid := '00000000-0000-0000-0000-000000000001';
  first_id uuid;
  second_id uuid;
  expired_id uuid;
  stale_id uuid;
  issue_result jsonb;
  duplicate_result jsonb;
  begin_result jsonb;
  resumed_result jsonb;
  invited_org uuid;
  rejected boolean := false;
  lifecycle_blocked boolean := false;
begin
  insert into public.organizations (id, name, slug)
  values (platform_org, 'Pixel Blaster Media', 'pixel-blaster-media');
  insert into public.profiles (id, organization_id, role, email, full_name)
  values (actor_id, platform_org, 'admin', 'platform@example.com', 'Platform Owner');
  insert into public.organization_members (organization_id, profile_id, role)
  values (platform_org, actor_id, 'owner');

  issue_result := public.issue_beta_company_invite(
    ' Owner@Example.COM ', repeat('a', 64), actor_id,
    pg_catalog.now() + interval '7 days'
  );
  first_id := (issue_result->>'id')::uuid;
  if issue_result->>'created' <> 'true' then
    raise exception 'first issuance was not created';
  end if;

  duplicate_result := public.issue_beta_company_invite(
    'owner@example.com', repeat('b', 64), actor_id,
    pg_catalog.now() + interval '7 days'
  );
  if duplicate_result->>'created' <> 'false'
     or (duplicate_result->>'id')::uuid <> first_id then
    raise exception 'ambiguous retry did not preserve the first invitation';
  end if;
  if exists (
    select 1 from public.beta_company_invites
    where id = first_id and status <> 'issued'
  ) then
    raise exception 'ambiguous retry revoked a possibly delivered link';
  end if;

  if not public.revoke_beta_company_invite(first_id, actor_id) then
    raise exception 'explicit revocation failed';
  end if;
  issue_result := public.issue_beta_company_invite(
    'owner@example.com', repeat('b', 64), actor_id,
    pg_catalog.now() + interval '7 days'
  );
  second_id := (issue_result->>'id')::uuid;
  if issue_result->>'created' <> 'true' or second_id = first_id then
    raise exception 'explicit replacement was not created';
  end if;
  if not public.mark_beta_company_invite_delivery(second_id, 'confirmed') then
    raise exception 'delivery state was not recorded';
  end if;

  issue_result := public.issue_beta_company_invite(
    'expired@example.com', repeat('c', 64), actor_id,
    pg_catalog.now() + interval '7 days'
  );
  expired_id := (issue_result->>'id')::uuid;
  update public.beta_company_invites
  set created_at = pg_catalog.now() - interval '2 days',
      expires_at = pg_catalog.now() - interval '1 minute'
  where id = expired_id;
  begin
    perform public.begin_beta_company_onboarding(
      repeat('c', 64), 'Expired Owner', 'Expired Company', 'expired-company',
      '#3f7f5f', '#c9a35b', false, platform_org
    );
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'expired beta invite was accepted'; end if;

  rejected := false;
  begin
    insert into auth.users (id, email, raw_app_meta_data)
    values (owner_id, 'owner@example.com', '{}'::jsonb);
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'issued beta email was not reserved from external Auth creation';
  end if;

  begin_result := public.begin_beta_company_onboarding(
    repeat('b', 64), 'Beta Owner', 'Beta Company', 'beta-company',
    '#3f7f5f', '#c9a35b', false, platform_org
  );
  invited_org := (begin_result->>'organization_id')::uuid;
  if begin_result->>'state' <> 'started' then
    raise exception 'beta onboarding did not start';
  end if;
  if octet_length(decode(begin_result->>'auth_provisioning_key', 'hex')) <> 32 then
    raise exception 'beta provisioning key was not 32 random bytes';
  end if;
  if public.resume_beta_company_onboarding(second_id, actor_id) then
    raise exception 'active provisioning window was reconciled early';
  end if;
  resumed_result := public.begin_beta_company_onboarding(
    repeat('b', 64), 'Beta Owner', 'Beta Company', 'beta-company',
    '#3f7f5f', '#c9a35b', false, platform_org
  );
  if resumed_result->>'state' <> 'resumed'
     or (resumed_result->>'organization_id')::uuid <> invited_org then
    raise exception 'identical retry did not resume the same organization';
  end if;
  rejected := false;
  begin
    perform public.begin_beta_company_onboarding(
      repeat('b', 64), 'Changed Owner', 'Beta Company', 'beta-company',
      '#3f7f5f', '#c9a35b', false, platform_org
    );
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'changed retry inputs were accepted'; end if;

  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
  values (
    owner_id, 'owner@example.com',
    pg_catalog.jsonb_build_object('company_invitation_id', second_id::text),
    pg_catalog.jsonb_build_object(
      'beta_provisioning_key', begin_result->>'auth_provisioning_key'
    )
  );
  if public.find_beta_auth_user_by_email(' OWNER@example.com ')->>'user_id' <> owner_id::text then
    raise exception 'authoritative Auth lookup failed';
  end if;
  insert into auth.users (id, email, raw_app_meta_data)
  values (
    other_id, 'reserved@example.com',
    pg_catalog.jsonb_build_object('company_invitation_id', gen_random_uuid()::text)
  );
  rejected := false;
  begin
    perform public.issue_beta_company_invite(
      'reserved@example.com', repeat('d', 64), actor_id,
      pg_catalog.now() + interval '7 days'
    );
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'profileless Auth identity received a second invitation';
  end if;
  insert into public.profiles (id, organization_id, role, email, full_name)
  values (owner_id, invited_org, 'admin', 'owner@example.com', 'Beta Owner');
  insert into public.organization_members (organization_id, profile_id, role)
  values (invited_org, owner_id, 'owner');

  perform pg_catalog.set_config('request.jwt.claim.sub', owner_id::text, true);
  begin
    update public.organizations set lifecycle_status = 'active' where id = invited_org;
  exception when others then
    lifecycle_blocked := true;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  if not lifecycle_blocked then
    raise exception 'tenant owner bypassed platform lifecycle activation';
  end if;

  rejected := false;
  begin
    perform public.complete_beta_company_onboarding(repeat('b', 64), other_id);
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'owner mismatch was accepted'; end if;
  if not public.complete_beta_company_onboarding(repeat('b', 64), owner_id) then
    raise exception 'owner-bound completion failed';
  end if;
  if exists (
    select 1 from auth.users
    where id = owner_id and raw_user_meta_data ? 'beta_provisioning_key'
  ) then
    raise exception 'completed owner retained beta provisioning capability';
  end if;
  if not public.complete_beta_company_onboarding(repeat('b', 64), owner_id) then
    raise exception 'same-owner replay was not idempotent';
  end if;

  if not public.activate_beta_company(invited_org, actor_id) then
    raise exception 'platform activation failed';
  end if;
  if not exists (
    select 1 from public.organizations
    where id = invited_org and lifecycle_status = 'active'
  ) then
    raise exception 'activation did not publish the company';
  end if;

  issue_result := public.issue_beta_company_invite(
    'stale@example.com', repeat('e', 64), actor_id,
    pg_catalog.now() + interval '7 days'
  );
  stale_id := (issue_result->>'id')::uuid;
  perform public.begin_beta_company_onboarding(
    repeat('e', 64), 'Stale Owner', 'Stale Company', 'stale-company',
    '#3f7f5f', '#c9a35b', false, platform_org
  );
  update public.beta_company_invites
  set provisioning_deadline = pg_catalog.now() - interval '1 minute'
  where id = stale_id;
  perform public.begin_beta_company_onboarding(
    repeat('e', 64), 'Stale Owner', 'Stale Company', 'stale-company',
    '#3f7f5f', '#c9a35b', false, platform_org
  );
  if not exists (
    select 1 from public.beta_company_invites
    where id = stale_id and status = 'reconciliation_required'
  ) then
    raise exception 'expired provisioning did not become reconciliation-visible';
  end if;
  if not public.resume_beta_company_onboarding(stale_id, actor_id) then
    raise exception 'operator reconciliation did not resume provisioning';
  end if;
  if not exists (
    select 1 from public.beta_company_invites
    where id = stale_id and status = 'provisioning'
      and provisioning_deadline > pg_catalog.now()
  ) then
    raise exception 'reconciliation did not create a retry window';
  end if;
end
$test$;
