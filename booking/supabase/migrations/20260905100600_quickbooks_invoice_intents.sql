-- LIFE-07: private, one-intent-per-booking invoice control plane.
-- No blind replay of rejected/unknown work; requestid is correlation, not an
-- assumed infinite retention guarantee. Expired attempts require adoption.
create table public.quickbooks_invoice_intents (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 booking_id uuid not null,
 realm_id text,
 environment text check (environment in ('sandbox','production')),
 state text not null check (state in ('pending','processing','rejected','unknown','confirmed')),
 snapshot jsonb,
 invoice_body jsonb,
 lease_token uuid,
 lease_expires_at timestamptz,
 invoice_id text,
 error_code text,
 adopted_by uuid,
 adoption_note text,
 adopted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id,booking_id),
 foreign key (organization_id,booking_id) references public.bookings(organization_id,id),
 unique (environment,realm_id,invoice_id),
 check (state <> 'processing' or (lease_token is not null and lease_expires_at is not null and snapshot is not null and realm_id is not null and environment is not null)),
 check (state <> 'confirmed' or (invoice_id is not null and realm_id is not null and environment is not null)),
 check (adopted_at is null or (adopted_by is not null and adoption_note is not null))
);
alter table public.quickbooks_invoice_intents enable row level security;
revoke all on public.quickbooks_invoice_intents from public, anon, authenticated, service_role;
grant select on public.quickbooks_invoice_intents to service_role;

-- Legacy creating is ambiguous, never a fresh permission to POST. Preserve it
-- for operator investigation; no fabricated lease or retrospective correlation.
insert into public.quickbooks_invoice_intents(organization_id,booking_id,realm_id,environment,state,error_code)
select b.organization_id,b.id,c.realm_id,c.environment,'unknown','legacy_creating'
from public.bookings b left join public.quickbooks_connection c on c.organization_id=b.organization_id
where b.quickbooks_invoice_status='creating' and b.quickbooks_invoice_id is null;

-- Rolling deployments still have legacy writers. Capture their committed start
-- permanently: their later creating -> NULL clear must not permit a fresh POST.
-- New begin inserts its processing intent before updating the booking, so it
-- keeps its lease. Pending requests have not posted and become ambiguous here.
create function public.capture_legacy_quickbooks_invoice()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.quickbooks_invoice_status='creating' and new.quickbooks_invoice_id is null then
  insert into public.quickbooks_invoice_intents(organization_id,booking_id,realm_id,environment,state,error_code)
  select new.organization_id,new.id,c.realm_id,c.environment,'unknown','legacy_creating'
  from (select 1) seed left join public.quickbooks_connection c on c.organization_id=new.organization_id
  on conflict(organization_id,booking_id) do update
   set state='unknown',error_code='legacy_creating',realm_id=excluded.realm_id,environment=excluded.environment,updated_at=now()
   where quickbooks_invoice_intents.state='pending';
 end if;
 return new;
end $$;
revoke all on function public.capture_legacy_quickbooks_invoice() from public,anon,authenticated,service_role;
create trigger capture_legacy_quickbooks_invoice
 after insert or update of quickbooks_invoice_status on public.bookings
 for each row execute function public.capture_legacy_quickbooks_invoice();

create function public.begin_quickbooks_invoice(p_organization_id uuid,p_booking_id uuid,p_realm_id text,p_environment text,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.bookings%rowtype; i public.quickbooks_invoice_intents%rowtype;
begin
 select * into b from public.bookings where id=p_booking_id and organization_id=p_organization_id for update;
 if not found then raise exception 'invoice booking unavailable'; end if;
 if b.quickbooks_invoice_id is not null then
  return jsonb_build_object('state','confirmed','invoice_id',b.quickbooks_invoice_id,'invoice_url',b.quickbooks_invoice_url);
 end if;
 select * into i from public.quickbooks_invoice_intents where organization_id=p_organization_id and booking_id=p_booking_id for update;
 if found and i.state<>'pending' then
  if i.state='processing' and i.lease_expires_at <= clock_timestamp() then
   update public.quickbooks_invoice_intents set state='unknown',error_code='lease_expired',lease_token=null,lease_expires_at=null,updated_at=now() where id=i.id returning * into i;
   update public.bookings set quickbooks_invoice_status='reconciliation_required' where id=b.id and organization_id=p_organization_id;
  end if;
  return jsonb_build_object('id',i.id,'state',i.state,'invoice_id',i.invoice_id);
 end if;
 if b.quickbooks_invoice_status='creating' then raise exception 'legacy invoice requires reconciliation'; end if;
 if b.status='cancelled' then raise exception 'cancelled booking'; end if;
 if not exists(select 1 from public.quickbooks_connection where organization_id=p_organization_id and realm_id=p_realm_id and environment=p_environment) then raise exception 'invoice connection changed'; end if;
 if coalesce(jsonb_typeof(p_snapshot)='object' and p_snapshot ?& array['realtor','property','lineItems','defaultItemId'] and jsonb_typeof(p_snapshot->'lineItems')='array',false) is not true then raise exception 'invoice snapshot invalid'; end if;
 if jsonb_array_length(p_snapshot->'lineItems') not between 1 and 100 then raise exception 'invoice lines missing'; end if;
 if coalesce(jsonb_typeof(p_snapshot->'realtor')='object' and jsonb_typeof(p_snapshot->'realtor'->'email')='string' and (p_snapshot->'realtor'->>'email') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and jsonb_typeof(p_snapshot->'property')='object' and jsonb_typeof(p_snapshot->'property'->'street_address')='string' and length(btrim(p_snapshot->'property'->>'street_address')) between 1 and 1000 and jsonb_typeof(p_snapshot->'defaultItemId')='string' and (p_snapshot->>'defaultItemId') ~ '^[0-9]{1,64}$',false) is not true then raise exception 'invoice snapshot invalid'; end if;
 if exists(select 1 from jsonb_array_elements(p_snapshot->'lineItems') l where coalesce(jsonb_typeof(l)='object' and jsonb_typeof(l->'description')='string' and length(btrim(l->>'description')) between 1 and 1000 and jsonb_typeof(l->'amountCents')='number' and (l->>'amountCents') ~ '^[0-9]{1,10}$',false) is not true) then raise exception 'invoice line invalid'; end if;
 if exists(select 1 from jsonb_array_elements(p_snapshot->'lineItems') l where (l->>'amountCents')::numeric not between 1 and 2147483647) then raise exception 'invoice amount invalid'; end if;
 if p_realm_id is null or p_realm_id !~ '^[0-9]{1,64}$' then raise exception 'invoice realm invalid'; end if;
 insert into public.quickbooks_invoice_intents(organization_id,booking_id,realm_id,environment,state,snapshot,lease_token,lease_expires_at)
 values(p_organization_id,p_booking_id,p_realm_id,p_environment,'processing',p_snapshot,gen_random_uuid(),clock_timestamp()+interval '2 minutes')
 on conflict(organization_id,booking_id) do update set realm_id=excluded.realm_id,environment=excluded.environment,state=excluded.state,snapshot=excluded.snapshot,lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,updated_at=now()
 where quickbooks_invoice_intents.state='pending' returning * into i;
 update public.bookings set quickbooks_invoice_status='creating' where id=b.id and organization_id=p_organization_id;
 return to_jsonb(i);
end $$;
revoke all on function public.begin_quickbooks_invoice(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_quickbooks_invoice(uuid,uuid,text,text,jsonb) to service_role;

-- Receipt and booking link commit together; no caller can clear an ambiguous
-- attempt to authorize a second POST. Consistent booking -> intent lock order.
create function public.finish_quickbooks_invoice(p_organization_id uuid,p_intent_id uuid,p_lease_token uuid,p_state text,p_invoice_id text default null,p_number text default null,p_total integer default null,p_balance integer default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.quickbooks_invoice_intents%rowtype; b public.bookings%rowtype; u text;
begin
 select * into i from public.quickbooks_invoice_intents where id=p_intent_id and organization_id=p_organization_id;
 if not found then return false; end if;
 select * into b from public.bookings where id=i.booking_id and organization_id=p_organization_id for update;
 select * into i from public.quickbooks_invoice_intents where id=p_intent_id and organization_id=p_organization_id for update;
 if i.state <> 'processing' or p_lease_token is null or i.lease_token is distinct from p_lease_token or i.lease_expires_at <= clock_timestamp() then return false; end if;
 if p_state is null or p_state not in ('confirmed','rejected','unknown') then raise exception 'invalid invoice outcome'; end if;
 if p_state='confirmed' then
  if i.invoice_body is null then raise exception 'invoice request evidence missing'; end if;
  if exists(select 1 from public.bookings other join public.quickbooks_connection conn on conn.organization_id=other.organization_id where other.id<>b.id and other.quickbooks_invoice_id=p_invoice_id and conn.realm_id=i.realm_id and conn.environment=i.environment) then raise exception 'invoice already linked'; end if;
  if p_invoice_id is null or p_invoice_id !~ '^[0-9]{1,64}$' or p_total is null or p_balance is null or p_total<0 or p_balance<0 or p_balance>p_total or length(p_number)>128 then raise exception 'invalid invoice receipt'; end if;
  if b.quickbooks_invoice_id is not null and b.quickbooks_invoice_id<>p_invoice_id then raise exception 'invoice already linked'; end if;
  u := 'https://' || case when i.environment='production' then 'app.qbo.intuit.com' else 'app.sandbox.qbo.intuit.com' end || '/app/invoice?txnId=' || p_invoice_id || '&realmId=' || i.realm_id;
  update public.bookings set quickbooks_invoice_id=p_invoice_id,quickbooks_invoice_number=p_number,quickbooks_invoice_url=u,quickbooks_invoice_total_cents=p_total,quickbooks_invoice_status=case when p_balance>0 then 'open' else 'paid' end,quickbooks_invoice_synced_at=now() where id=b.id and organization_id=p_organization_id;
 else
  update public.bookings set quickbooks_invoice_status='reconciliation_required' where id=b.id and organization_id=p_organization_id;
 end if;
 update public.quickbooks_invoice_intents set state=p_state,invoice_id=case when p_state='confirmed' then p_invoice_id else null end,error_code=case when p_state='confirmed' then null else p_state end,lease_token=null,lease_expires_at=null,updated_at=now() where id=i.id;
 return true;
end $$;
revoke all on function public.finish_quickbooks_invoice(uuid,uuid,uuid,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.finish_quickbooks_invoice(uuid,uuid,uuid,text,text,text,integer,integer) to service_role;

create function public.stage_quickbooks_invoice(p_organization_id uuid,p_intent_id uuid,p_lease_token uuid,p_body jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(jsonb_typeof(p_body)='object' and p_body->>'PrivateNote'='pixel-invoice-intent:'||p_intent_id::text and jsonb_typeof(p_body->'Line')='array' and jsonb_typeof(p_body->'CustomerRef'->'value')='string',false) is not true then raise exception 'invalid invoice body'; end if;
 update public.quickbooks_invoice_intents set invoice_body=p_body,updated_at=now() where id=p_intent_id and organization_id=p_organization_id and state='processing' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() and invoice_body is null;
 return found;
end $$;
revoke all on function public.stage_quickbooks_invoice(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.stage_quickbooks_invoice(uuid,uuid,uuid,jsonb) to service_role;

-- Only server-side provider verification may call this service-only RPC.
create function public.request_quickbooks_invoice(p_organization_id uuid,p_booking_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.bookings%rowtype;
begin
 select * into b from public.bookings where organization_id=p_organization_id and id=p_booking_id for update;
 if not found or b.status='cancelled' then return false; end if;
 if b.quickbooks_invoice_id is not null then return true; end if;
 insert into public.quickbooks_invoice_intents(organization_id,booking_id,state,error_code) values(p_organization_id,p_booking_id,'pending','billing_requested') on conflict(organization_id,booking_id) do nothing;
 update public.bookings set quickbooks_invoice_status='billing_pending' where organization_id=p_organization_id and id=p_booking_id and quickbooks_invoice_status is null;
 return true;
end $$;
revoke all on function public.request_quickbooks_invoice(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_quickbooks_invoice(uuid,uuid) to service_role;

-- Only server-side provider verification may call this service-only RPC.
-- Never authorize another POST; adopt an exact GET-verified invoice instead.
create function public.adopt_quickbooks_invoice(p_organization_id uuid,p_booking_id uuid,p_actor uuid,p_note text,p_realm_id text,p_environment text,p_body jsonb,p_invoice_id text,p_number text,p_total integer,p_balance integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.quickbooks_invoice_intents%rowtype; token uuid;
begin
 if p_note is null or length(btrim(p_note)) not between 10 and 500 or not exists(select 1 from public.organization_members m join public.profiles p on p.id=m.profile_id where m.organization_id=p_organization_id and m.profile_id=p_actor and m.role in ('owner','admin') and p.archived_at is null) then raise exception 'invoice adoption unauthorized'; end if;
 perform 1 from public.bookings where organization_id=p_organization_id and id=p_booking_id for update;
 select * into i from public.quickbooks_invoice_intents where organization_id=p_organization_id and booking_id=p_booking_id for update;
 if not found or i.invoice_body is null or i.invoice_body is distinct from p_body or i.realm_id is distinct from p_realm_id or i.environment is distinct from p_environment then return false; end if;
 if not exists(select 1 from public.quickbooks_connection where organization_id=p_organization_id and realm_id=i.realm_id and environment=i.environment) then return false; end if;
 if i.state='confirmed' then return i.invoice_id=p_invoice_id; end if;
 if i.state='processing' and i.lease_expires_at>clock_timestamp() then return false; end if;
 if i.state not in ('unknown','rejected','processing') then return false; end if;
 token:=gen_random_uuid();
 update public.quickbooks_invoice_intents set state='processing',lease_token=token,lease_expires_at=clock_timestamp()+interval '30 seconds' where id=i.id;
 if not public.finish_quickbooks_invoice(p_organization_id,i.id,token,'confirmed',p_invoice_id,p_number,p_total,p_balance) then raise exception 'invoice adoption failed'; end if;
 update public.quickbooks_invoice_intents set adopted_by=p_actor,adoption_note=btrim(p_note),adopted_at=now() where id=i.id;
 return true;
end $$;
revoke all on function public.adopt_quickbooks_invoice(uuid,uuid,uuid,text,text,text,jsonb,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.adopt_quickbooks_invoice(uuid,uuid,uuid,text,text,text,jsonb,text,text,integer,integer) to service_role;
