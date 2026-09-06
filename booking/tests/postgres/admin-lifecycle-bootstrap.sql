insert into public.organizations(id,name,slug) values ('00000000-0000-4000-8000-000000000001','Admin fixture','admin-fixture');
alter table public.bookings add column suppress_realtor_notifications boolean not null default false;
insert into public.profiles(id,organization_id,role,email) values
('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','admin','admin@example.com'),
('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','realtor','owner@example.com');
insert into public.organization_members values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','admin'),('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012','member');
insert into public.catalog_items(id,organization_id,slug,name,kind,duration_minutes,price_cents,sqft_pricing_enabled,included_sqft,overage_increment_sqft,overage_price_cents) values
('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','test_bundle','Original','bundle',90,35000,true,2500,500,4000);
create function public.test_admin_save(p_request uuid, p_booking uuid default null,p_version bigint default null,p_extra jsonb default '{}') returns jsonb language plpgsql as $$
begin return public.save_admin_booking_aggregate('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011',p_request,p_booking,p_version,
'{"owner_id":"00000000-0000-4000-8000-000000000012","street_address":"Test Street","city":"Test City","province":"ON","postal_code":"T1T 1T1","scheduled_at":"2030-01-01T15:00:00Z","square_footage":3000,"catalog_item_ids":["00000000-0000-4000-8000-000000000021"],"client_notes":"Customer notes","suppress_realtor_notifications":true}'::jsonb || p_extra); end $$;
