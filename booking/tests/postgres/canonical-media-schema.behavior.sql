begin;

insert into public.organizations (id, name, slug) values
  ('11111111-1111-4111-8111-111111111111', 'Media Tenant A', 'media-tenant-a'),
  ('22222222-2222-4222-8222-222222222222', 'Media Tenant B', 'media-tenant-b');
insert into public.profiles (id, organization_id, role, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'admin', 'a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'admin', 'b@example.com');
insert into public.organization_members (organization_id, profile_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'admin');
insert into public.properties (id, organization_id, owner_id, street_address) values
  ('11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '1 Tenant A Street'),
  ('22222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '2 Tenant B Street');
insert into public.bookings (id, organization_id, property_id, owner_id, status) values
  ('11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'confirmed'),
  ('22222222-2222-4222-8222-222222222203', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222202', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'confirmed');
insert into public.listing_websites (id, organization_id, property_id, owner_id, booking_id, slug) values
  ('11111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111102', 'tenant-a-listing'),
  ('22222222-2222-4222-8222-222222222204', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222202', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222203', 'tenant-b-listing');

set local role service_role;

do $$
begin
  begin
    insert into public.media_batches (
      id, organization_id, property_id, booking_id, source_provider,
      provider_connection_key, provider_job_id, provider_revision
    ) values (
      '31111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222202',
      '22222222-2222-4222-8222-222222222203',
      'fixture', 'connection-a', 'cross-tenant', 0
    );
    raise exception 'cross-tenant property reference should fail';
  exception when foreign_key_violation then null;
  end;
end;
$$;

insert into public.media_batches (
  id, organization_id, property_id, booking_id, source_provider,
  provider_connection_key, provider_job_id, provider_revision, created_by
) values (
  '31111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111102',
  'fixture', 'connection-a', 'job-a', 0,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
);

insert into public.media_assets (
  id, organization_id, property_id, batch_id, source_provider,
  provider_connection_key, provider_job_id, provider_output_id, provider_revision,
  media_kind, original_filename
) values (
  '41111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  'fixture', 'connection-a', 'job-a', 'output-a', 0, 'image', 'front.jpg'
);

do $$
begin
  begin
    insert into public.media_assets (
      organization_id, property_id, batch_id, source_provider,
      provider_connection_key, provider_job_id, provider_output_id, provider_revision
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111101',
      '31111111-1111-4111-8111-111111111101',
      'fixture', 'connection-a', 'job-a', 'output-a', 0
    );
    raise exception 'duplicate provider output should fail';
  exception when unique_violation then null;
  end;
end;
$$;

insert into public.media_assets (
  id, organization_id, property_id, batch_id, source_provider,
  provider_connection_key, provider_job_id, provider_output_id, provider_revision
) values (
  '41111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  'fixture', 'connection-a', 'job-a', 'output-b', 0
);
insert into public.media_versions (
  id, organization_id, property_id, batch_id, asset_id, version_number
) values (
  '51111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  '41111111-1111-4111-8111-111111111102', 1
);
update public.media_versions set ingest_state = 'url_ready'
 where id = '51111111-1111-4111-8111-111111111102';
update public.media_versions set ingest_state = 'fetching'
 where id = '51111111-1111-4111-8111-111111111102';
update public.media_versions set ingest_state = 'quarantined'
 where id = '51111111-1111-4111-8111-111111111102';
update public.media_versions set ingest_state = 'validating'
 where id = '51111111-1111-4111-8111-111111111102';
update public.media_versions set ingest_state = 'scanning'
 where id = '51111111-1111-4111-8111-111111111102';
do $$
begin
  begin
    update public.media_versions set ingest_state = 'accepted'
     where id = '51111111-1111-4111-8111-111111111102';
    raise exception 'incomplete accepted media version should fail';
  exception when check_violation then null;
  end;
end;
$$;
update public.media_versions
   set ingest_state = 'accepted', object_tier = 'master', bucket_name = 'masters-test',
       object_key = 'masters/11111111-1111-4111-8111-111111111111/asset/version/back.jpg',
       sha256 = decode(repeat('12', 32), 'hex'), byte_size = 1900,
       mime_type = 'image/jpeg', width_px = 1800, height_px = 1200, accepted_at = now()
 where id = '51111111-1111-4111-8111-111111111102';

insert into public.media_versions (
  id, organization_id, property_id, batch_id, asset_id, version_number,
  ingest_state
) values (
  '51111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  '41111111-1111-4111-8111-111111111101', 1, 'discovered'
);

update public.media_versions set ingest_state = 'url_ready'
 where id = '51111111-1111-4111-8111-111111111101';
update public.media_versions set ingest_state = 'fetching'
 where id = '51111111-1111-4111-8111-111111111101';
update public.media_versions set ingest_state = 'quarantined'
 where id = '51111111-1111-4111-8111-111111111101';
update public.media_versions set ingest_state = 'validating'
 where id = '51111111-1111-4111-8111-111111111101';
update public.media_versions set ingest_state = 'scanning'
 where id = '51111111-1111-4111-8111-111111111101';
update public.media_versions
   set ingest_state = 'accepted', object_tier = 'master', bucket_name = 'masters-test',
       object_key = 'masters/11111111-1111-4111-8111-111111111111/asset/version/front.jpg',
       sha256 = decode(repeat('11', 32), 'hex'), byte_size = 2048,
       mime_type = 'image/jpeg', width_px = 2000, height_px = 1333, accepted_at = now()
 where id = '51111111-1111-4111-8111-111111111101';

do $$
begin
  begin
    update public.media_versions
       set object_key = 'masters/changed.jpg'
     where id = '51111111-1111-4111-8111-111111111101';
    raise exception 'accepted object identity update should fail';
  exception when check_violation then null;
  end;
end;
$$;

insert into public.media_derivatives (
  id, organization_id, property_id, batch_id, source_version_id,
  profile_id, profile_version, derivative_class, profile_status, status
) values (
  '61111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  '51111111-1111-4111-8111-111111111101',
  'web.listing.2048.v1', 1, 'web', 'defined', 'queued'
);
update public.media_derivatives set status = 'processing'
 where id = '61111111-1111-4111-8111-111111111101';
update public.media_derivatives
   set status = 'ready', bucket_name = 'derivatives-test',
       object_key = 'derivatives/tenant/version/v1/front.jpg',
       sha256 = decode(repeat('22', 32), 'hex'), byte_size = 1024,
       mime_type = 'image/jpeg', width_px = 2048, height_px = 1365, ready_at = now()
 where id = '61111111-1111-4111-8111-111111111101';

insert into public.media_derivatives (
  id, organization_id, property_id, batch_id, source_version_id,
  profile_id, profile_version, derivative_class, profile_status
) values (
  '61111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  '51111111-1111-4111-8111-111111111102',
  'thumbnail.admin.320.v1', 1, 'thumbnail', 'defined'
);
update public.media_derivatives set status = 'processing'
 where id = '61111111-1111-4111-8111-111111111102';
do $$
begin
  begin
    update public.media_derivatives set status = 'ready'
     where id = '61111111-1111-4111-8111-111111111102';
    raise exception 'incomplete ready derivative should fail';
  exception when check_violation then null;
  end;
end;
$$;
update public.media_derivatives
   set status = 'ready', bucket_name = 'derivatives-test',
       object_key = 'derivatives/tenant/version/v1/back.jpg',
       sha256 = decode(repeat('23', 32), 'hex'), byte_size = 512,
       mime_type = 'image/jpeg', width_px = 320, height_px = 213, ready_at = now()
 where id = '61111111-1111-4111-8111-111111111102';

insert into public.gallery_releases (
  id, organization_id, property_id, batch_id, revision_number, state, created_by
) values (
  '71111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101', 1, 'draft',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
);

insert into public.gallery_release_items (
  id, organization_id, property_id, batch_id, release_id, media_version_id,
  display_derivative_id, position, display_filename, approval_state
) values (
  '81111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  '71111111-1111-4111-8111-111111111101',
  '51111111-1111-4111-8111-111111111101',
  '61111111-1111-4111-8111-111111111101',
  0, 'front.jpg', 'pending'
);

do $$
begin
  begin
    insert into public.listing_gallery_items (
      organization_id, listing_website_id, property_id, batch_id, release_id,
      release_item_id, media_version_id, derivative_id, position
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111103',
      '11111111-1111-4111-8111-111111111101',
      '31111111-1111-4111-8111-111111111101',
      '71111111-1111-4111-8111-111111111101',
      '81111111-1111-4111-8111-111111111101',
      '51111111-1111-4111-8111-111111111101',
      '61111111-1111-4111-8111-111111111101', 0
    );
    raise exception 'unapproved listing item should fail';
  exception when check_violation then null;
  end;
end;
$$;

update public.gallery_release_items
   set approval_state = 'approved',
       approved_by = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
       approved_at = now()
 where id = '81111111-1111-4111-8111-111111111101';
do $$
begin
  begin
    update public.gallery_release_items set display_filename = 'substituted.jpg'
     where id = '81111111-1111-4111-8111-111111111101';
    raise exception 'approved release item substitution should fail';
  exception when check_violation then null;
  end;
end;
$$;
update public.gallery_releases
   set state = 'review_pending',
       manifest = '{"version":1,"items":["81111111-1111-4111-8111-111111111101"]}'::jsonb,
       manifest_sha256 = decode(repeat('33', 32), 'hex')
 where id = '71111111-1111-4111-8111-111111111101';
update public.gallery_releases
   set state = 'approved',
       approved_by = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
       approved_at = now()
 where id = '71111111-1111-4111-8111-111111111101';

insert into public.gallery_releases (
  id, organization_id, property_id, batch_id, revision_number, created_by
) values (
  '71111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101', 2,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
);
insert into public.gallery_release_items (
  id, organization_id, property_id, batch_id, release_id, media_version_id,
  display_derivative_id, position, display_filename, approval_state, approved_by, approved_at
) values (
  '81111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  '71111111-1111-4111-8111-111111111102',
  '51111111-1111-4111-8111-111111111101',
  '61111111-1111-4111-8111-111111111101', 0, 'front.jpg', 'approved',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', now()
);
update public.gallery_releases
   set state = 'review_pending',
       manifest = '{"version":1,"items":["81111111-1111-4111-8111-111111111102"]}'::jsonb,
       manifest_sha256 = decode(repeat('34', 32), 'hex')
 where id = '71111111-1111-4111-8111-111111111102';

insert into public.listing_gallery_items (
  id, organization_id, listing_website_id, property_id, batch_id, release_id,
  release_item_id, media_version_id, derivative_id, position
) values (
  '91111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111103',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  '71111111-1111-4111-8111-111111111101',
  '81111111-1111-4111-8111-111111111101',
  '51111111-1111-4111-8111-111111111101',
  '61111111-1111-4111-8111-111111111101', 0
);

do $$
begin
  begin
    update public.gallery_releases set state = 'withdrawn', withdrawn_at = now()
     where id = '71111111-1111-4111-8111-111111111101';
    raise exception 'active listing release withdrawal should fail';
  exception when check_violation then null;
  end;
  begin
    update public.gallery_releases set created_at = created_at - interval '1 day'
     where id = '71111111-1111-4111-8111-111111111101';
    raise exception 'approved release provenance update should fail';
  exception when check_violation then null;
  end;
  begin
    update public.media_versions set parent_version_id = id
     where id = '51111111-1111-4111-8111-111111111101';
    raise exception 'accepted version provenance update should fail';
  exception when check_violation then null;
  end;
end;
$$;

do $$
begin
  begin
    insert into public.gallery_release_items (
      organization_id, property_id, batch_id, release_id, media_version_id,
      display_derivative_id, position, display_filename
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111101',
      '31111111-1111-4111-8111-111111111101',
      '71111111-1111-4111-8111-111111111101',
      '51111111-1111-4111-8111-111111111101',
      '61111111-1111-4111-8111-111111111101', 1, 'late.jpg'
    );
    raise exception 'cross-release media version should fail';
  exception when check_violation then null;
  end;
end;
$$;

insert into public.media_packages (
  id, organization_id, property_id, batch_id, release_id, package_type,
  manifest_sha256
) values (
  'a1111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  '71111111-1111-4111-8111-111111111101', 'full_res_zip',
  decode(repeat('33', 32), 'hex')
);
update public.media_packages set status = 'building'
 where id = 'a1111111-1111-4111-8111-111111111102';
do $$
begin
  begin
    update public.media_packages set status = 'ready'
     where id = 'a1111111-1111-4111-8111-111111111102';
    raise exception 'incomplete ready package should fail';
  exception when check_violation then null;
  end;
  begin
    insert into public.media_packages (
      organization_id, property_id, batch_id, release_id, package_type, manifest_sha256
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111101',
      '31111111-1111-4111-8111-111111111101',
      '71111111-1111-4111-8111-111111111101', 'mls_zip',
      decode(repeat('99', 32), 'hex')
    );
    raise exception 'mismatched release package manifest should fail';
  exception when foreign_key_violation then null;
  end;
end;
$$;

insert into public.media_packages (
  id, organization_id, property_id, batch_id, release_id, package_type,
  manifest_sha256, status
) values (
  'a1111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  '71111111-1111-4111-8111-111111111101', 'mls_zip',
  decode(repeat('33', 32), 'hex'), 'queued'
);
update public.media_packages set status = 'building'
 where id = 'a1111111-1111-4111-8111-111111111101';
update public.media_packages
   set status = 'ready', bucket_name = 'packages-test',
       object_key = 'packages/tenant/release/mls.zip',
       package_sha256 = decode(repeat('44', 32), 'hex'),
       byte_size = 2048, entry_count = 1, ready_at = now()
 where id = 'a1111111-1111-4111-8111-111111111101';
do $$
begin
  begin
    insert into public.download_grants (
      organization_id, property_id, batch_id, release_id, package_id,
      grantee_email_hash, token_key_id, token_hash, expires_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111101',
      '31111111-1111-4111-8111-111111111101',
      '71111111-1111-4111-8111-111111111101',
      'a1111111-1111-4111-8111-111111111101',
      decode(repeat('54', 32), 'hex'), 'key-v1', decode(repeat('55', 32), 'hex'), now() + interval '1 hour'
    );
    raise exception 'grant before ready release should fail';
  exception when check_violation then null;
  end;
end;
$$;
update public.gallery_releases set state = 'packaging'
 where id = '71111111-1111-4111-8111-111111111101';
update public.gallery_releases set state = 'ready'
 where id = '71111111-1111-4111-8111-111111111101';

insert into public.download_grants (
  id, organization_id, property_id, batch_id, release_id, package_id,
  grantee_profile_id, token_key_id, token_hash, expires_at, max_resolutions, created_by
) values (
  'b1111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  '71111111-1111-4111-8111-111111111101',
  'a1111111-1111-4111-8111-111111111101',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'key-v1',
  decode(repeat('55', 32), 'hex'), now() + interval '1 hour', 2,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
);
update public.listing_gallery_items set removed_at = now()
 where id = '91111111-1111-4111-8111-111111111101';
do $$
begin
  begin
    update public.gallery_releases set state = 'withdrawn', withdrawn_at = now()
     where id = '71111111-1111-4111-8111-111111111101';
    raise exception 'active download grant release withdrawal should fail';
  exception when check_violation then null;
  end;
end;
$$;

do $$
begin
  begin
    update public.download_grants
       set token_hash = decode(repeat('66', 32), 'hex')
     where id = 'b1111111-1111-4111-8111-111111111101';
    raise exception 'download token hash update should fail';
  exception when check_violation then null;
  end;
  begin
    update public.download_grants
       set id = 'b1111111-1111-4111-8111-111111111199'
     where id = 'b1111111-1111-4111-8111-111111111101';
    raise exception 'download grant identity update should fail';
  exception when check_violation then null;
  end;
end;
$$;

insert into public.provider_events (
  id, organization_id, provider, provider_connection_key, provider_event_id,
  event_type, batch_id, payload_sha256, payload_redacted
) values (
  'c1111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111', 'fixture', 'connection-a',
  'event-a', 'output_ready', '31111111-1111-4111-8111-111111111101',
  decode(repeat('77', 32), 'hex'), '{"status":"ready"}'::jsonb
);
insert into public.media_ingest_jobs (
  id, organization_id, property_id, batch_id, provider_event_id,
  job_kind, idempotency_key, state
) values (
  'd1111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  'c1111111-1111-4111-8111-111111111101', 'ingest', 'fixture-ingest-a', 'discovered'
);
insert into public.media_job_attempts (
  id, organization_id, property_id, batch_id, job_id, attempt_number,
  worker_id, outcome, started_at, finished_at
) values (
  'e1111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  'd1111111-1111-4111-8111-111111111101', 1, 'fixture-worker',
  'succeeded', now() - interval '1 second', now()
);
insert into public.download_events (
  id, organization_id, property_id, batch_id, release_id, package_id, grant_id,
  event_type, actor_profile_id, request_id
) values (
  'f1111111-1111-4111-8111-111111111101',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111101',
  '31111111-1111-4111-8111-111111111101',
  '71111111-1111-4111-8111-111111111101',
  'a1111111-1111-4111-8111-111111111101',
  'b1111111-1111-4111-8111-111111111101',
  'grant_resolved', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'f2111111-1111-4111-8111-111111111101'
);

do $$
begin
  begin
    update public.provider_events set event_type = 'changed'
     where id = 'c1111111-1111-4111-8111-111111111101';
    raise exception 'append-only event update should fail';
  exception when check_violation or insufficient_privilege then null;
  end;
  begin
    delete from public.media_versions where id = '51111111-1111-4111-8111-111111111101';
    raise exception 'canonical media delete should fail';
  exception when check_violation or insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
declare leaked bigint;
begin
  begin
    execute 'set local role authenticated';
    select count(*) into leaked from public.media_batches;
    if leaked <> 0 then
      raise exception 'tenant RLS leaked another organization';
    end if;
    execute 'reset role';
  exception when insufficient_privilege then
    execute 'reset role';
  end;
end;
$$;

do $$
declare missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into missing
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in (
       'media_batches','media_assets','media_versions','media_derivatives',
       'provider_events','media_ingest_jobs','media_job_attempts','gallery_releases',
       'gallery_release_items','media_packages','download_grants','download_events',
       'listing_gallery_items'
     )
     and (not c.relrowsecurity or not c.relforcerowsecurity);
  if missing is not null then
    raise exception 'canonical tables missing forced RLS: %', missing;
  end if;
end;
$$;

\if :{?commit_fixture}
commit;
\else
rollback;
\endif
