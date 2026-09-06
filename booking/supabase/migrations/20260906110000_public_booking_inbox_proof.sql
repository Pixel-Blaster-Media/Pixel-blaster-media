-- Public self-registration only. No passwords, contact notes or draft plaintext.
-- Install before the application. Missing RPCs intentionally block new bookings.
create table public.public_booking_inbox_challenges (
  email text primary key check (email = lower(btrim(email)) and length(email) between 3 and 320),
  request_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz
);
alter table public.public_booking_inbox_challenges enable row level security;
revoke all on public.public_booking_inbox_challenges from public, anon, authenticated;
grant select, insert, update, delete on public.public_booking_inbox_challenges to service_role;

create function public.begin_public_booking_verification(
  p_request_id uuid, p_organization_id uuid, p_email text, p_fingerprint text, p_code_hash text
) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare changed integer;
begin
  if p_request_id is null or p_organization_id is null or p_email is null
    or p_fingerprint is null or p_code_hash is null then return false; end if;
  -- One active challenge per normalized email globally: changing request/tenant
  -- cannot reset guesses or generate another email during the cooldown.
  insert into public.public_booking_inbox_challenges as c
    (email, request_id, organization_id, fingerprint, code_hash, expires_at)
  values (p_email, p_request_id, p_organization_id, p_fingerprint, p_code_hash, clock_timestamp()+interval '10 minutes')
  on conflict (email) do update set request_id=excluded.request_id,
    organization_id=excluded.organization_id, fingerprint=excluded.fingerprint,
    code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, consumed_at=null
  where c.expires_at <= clock_timestamp();
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

create function public.verify_public_booking_inbox(
  p_request_id uuid, p_organization_id uuid, p_email text, p_fingerprint text, p_code_hash text
) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare c public.public_booking_inbox_challenges%rowtype;
begin
  select * into c from public.public_booking_inbox_challenges where email=p_email for update;
  if not found or c.expires_at <= clock_timestamp() or c.consumed_at is not null or c.attempts >= 5 then return false; end if;
  -- Count every guess for the email, including scope mismatches.
  update public.public_booking_inbox_challenges set attempts=attempts+1 where email=p_email;
  if c.request_id is distinct from p_request_id or c.organization_id is distinct from p_organization_id
    or c.fingerprint is distinct from p_fingerprint or c.code_hash is distinct from p_code_hash then return false; end if;
  update public.public_booking_inbox_challenges set consumed_at=clock_timestamp() where email=p_email;
  return true;
end $$;
revoke all on function public.begin_public_booking_verification(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.verify_public_booking_inbox(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.begin_public_booking_verification(uuid,uuid,text,text,text) to service_role;
grant execute on function public.verify_public_booking_inbox(uuid,uuid,text,text,text) to service_role;
