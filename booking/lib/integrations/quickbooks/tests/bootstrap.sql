create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.bookings (
 id uuid primary key, organization_id uuid not null, status text default 'confirmed',
 quickbooks_invoice_id text, quickbooks_invoice_number text, quickbooks_invoice_url text,
 quickbooks_invoice_status text, quickbooks_invoice_total_cents integer, quickbooks_invoice_synced_at timestamptz,
 unique(organization_id,id)
);
create table public.quickbooks_connection (organization_id uuid primary key, realm_id text, environment text);
create table public.profiles (id uuid primary key, archived_at timestamptz);
create table public.organization_members (organization_id uuid, profile_id uuid, role text);
grant usage on schema public to service_role, authenticated, anon;
grant all on all tables in schema public to service_role;
insert into bookings(id,organization_id) values ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into quickbooks_connection values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','123','sandbox');
insert into profiles values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',null);
insert into organization_members values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc','admin');
