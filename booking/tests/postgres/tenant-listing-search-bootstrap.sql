-- Minimal disposable schema; never connect this suite to a linked database.
\ir canonical-media-bootstrap.sql
alter table profiles add full_name text, add phone text, add alternate_phones text[] default '{}',
  add brokerage text, add profile_photo_url text, add brokerage_logo_url text,
  add website_url text, add instagram_url text, add delivery_cc_emails text[] default '{}',
  add internal_notes text, add ai_memory jsonb default '{}', add created_at timestamptz default now();
alter table properties add city text;
alter table bookings add scheduled_at timestamptz, add services text[] not null default '{}';
drop table listing_websites;
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create function public.is_admin() returns boolean language sql as $$ select false $$;
\ir ../../supabase/bootstrap-migrations/0019_listing_websites.sql
alter table listing_websites add organization_id uuid not null references organizations(id);
-- Supabase public-schema API grants: explicitly exercise authenticated DML,
-- rather than a superuser-only simulation or an accidental permission denial.
grant usage on schema public, auth to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant select on listing_websites to anon;
insert into organizations values
 ('11111111-1111-4111-8111-111111111111','Tenant A','tenant-a'),
 ('22222222-2222-4222-8222-222222222222','Tenant B','tenant-b');
insert into profiles(id,organization_id,role,email,full_name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','realtor','a@example.test','Agent A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','realtor','b@example.test','Agent B'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','admin','admin@example.test','Admin A'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','realtor','d@example.test','Agent D');
insert into organization_members values ('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','admin');
insert into properties(id,organization_id,owner_id,street_address) values
 ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Local address'),
 ('20000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','FOREIGN PRIVATE ADDRESS'),
 ('20000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Existing foreign listing');
insert into listing_websites(organization_id,owner_id,property_id,slug,is_published) values
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','20000000-0000-4000-8000-000000000002','existing-foreign',true);
insert into bookings(id,organization_id,owner_id,property_id,status) values
 ('30000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','confirmed'),
 ('30000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','20000000-0000-4000-8000-000000000001','delivered');
