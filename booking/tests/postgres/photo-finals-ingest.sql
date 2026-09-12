-- Synthetic local-only fixtures. Every assertion runs against actual PostgreSQL.
insert into organizations values ('11111111-1111-4111-8111-111111111111','Synthetic','synthetic');
insert into profiles values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111','admin','synthetic@example.invalid',null);
insert into organization_members values ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','admin');
insert into properties(id,organization_id,owner_id,street_address) values ('11111111-1111-4111-8111-111111111101','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Synthetic');
insert into bookings(id,organization_id,property_id,owner_id) values ('21111111-1111-4111-8111-111111111101','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111101','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
set role service_role;
select public.photo_finals_create_intent('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','21111111-1111-4111-8111-111111111101','11111111-1111-4111-8111-111111111101','31111111-1111-4111-8111-111111111101','41111111-1111-4111-8111-111111111101',repeat('a',64),100);
