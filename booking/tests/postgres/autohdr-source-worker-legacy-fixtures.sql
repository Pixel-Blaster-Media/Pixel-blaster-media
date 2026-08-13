\set ON_ERROR_STOP on
insert into public.organizations (id,name,slug) values ('33333333-3333-4333-8333-333333333333','Legacy Worker Tenant','legacy-worker-tenant');
insert into public.profiles (id,organization_id,role,email) values ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3','33333333-3333-4333-8333-333333333333','admin','legacy-worker@example.com');
insert into public.organization_members (organization_id,profile_id,role) values ('33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-ccccccccccc3','admin');
insert into public.properties (id,organization_id,owner_id,street_address) values ('33333333-3333-4333-8333-333333333301','33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-ccccccccccc3','3 Legacy Street');
insert into public.bookings (id,organization_id,property_id,owner_id,status) values ('33333333-3333-4333-8333-333333333302','33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333301','cccccccc-cccc-4ccc-8ccc-ccccccccccc3','confirmed');
insert into public.integration_credentials (organization_id,provider,credentials,updated_by) values ('33333333-3333-4333-8333-333333333333','autohdr','{"api_key":"legacy","enabled":"true"}','cccccccc-cccc-4ccc-8ccc-ccccccccccc3');
set role service_role;
create temporary table legacy_position as
select * from public.prepare_autohdr_source_batch(
 '33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333302',
 '00000000-0000-4000-8000-000000000020','cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
 (select jsonb_agg(jsonb_build_object('filename','legacy-'||n||'.jpg','byte_size',1,'mime_type','image/jpeg','sha256',md5('legacy-'||n)||md5('legacy-'||n)) order by n) from generate_series(0,20) n));
select public.mark_autohdr_source_quarantined(organization_id,booking_id,batch_id,asset_id,version_id,ingest_job_id,quarantine_bucket_name,quarantine_object_key,'legacy-position-etag',sha256,byte_size,mime_type)
from legacy_position where position=20;
create temporary table legacy_size as
select * from public.prepare_autohdr_source_batch(
 '33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333302',
 '00000000-0000-4000-8000-000000000025','cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
 '[{"filename":"legacy-large.jpg","byte_size":26214401,"mime_type":"image/jpeg","sha256":"2525252525252525252525252525252525252525252525252525252525252525"}]');
select public.mark_autohdr_source_quarantined(organization_id,booking_id,batch_id,asset_id,version_id,ingest_job_id,quarantine_bucket_name,quarantine_object_key,'legacy-size-etag',sha256,byte_size,mime_type) from legacy_size;
reset role;
