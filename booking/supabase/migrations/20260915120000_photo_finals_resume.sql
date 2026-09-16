-- Code-dark resumable verified downloads. Historical six migrations stay sealed.
-- Canonical binary: PFCHIDX1, three UUIDs, two SHA256s, int64 size,
-- int32 chunk size, int32 count, raw ordered SHA256 vector; all integers big endian.
create function public.photo_finals_index_hash(p_index jsonb) returns text language plpgsql immutable set search_path='' as $$
declare n bigint; c integer; b bytea;
begin
 if not coalesce(jsonb_typeof(p_index)='object' and p_index->'version'='1'::jsonb and p_index->'chunk_size'='131072'::jsonb
 and jsonb_typeof(p_index->'byte_size')='number' and (p_index->>'byte_size')::numeric=trunc((p_index->>'byte_size')::numeric)
 and (p_index->>'byte_size')::bigint between 1 and 1100000000
 and p_index->>'manifest_sha256' ~ '^[0-9a-f]{64}$' and p_index->>'package_sha256' ~ '^[0-9a-f]{64}$'
 and p_index->>'digests' ~ '^[0-9a-f]+$',false) then raise exception 'finals_index_invalid' using errcode='23514';end if;
 perform public.photo_finals_identifiers(p_index->>'organization_id',p_index->>'package_id',p_index->>'release_id');
 n:=(p_index->>'byte_size')::bigint;c:=((n+131071)/131072)::integer;
 if p_index->'chunk_count' is distinct from to_jsonb(c) or length(p_index->>'digests')<>c*64 then raise exception 'finals_index_geometry' using errcode='23514';end if;
 b:=convert_to('PFCHIDX1','UTF8')||uuid_send((p_index->>'organization_id')::uuid)||uuid_send((p_index->>'package_id')::uuid)||uuid_send((p_index->>'release_id')::uuid)
 ||decode(p_index->>'manifest_sha256','hex')||decode(p_index->>'package_sha256','hex')||int8send(n)||int4send(131072)||int4send(c)||decode(p_index->>'digests','hex');
 return encode(sha256(b),'hex');
end $$;
revoke all on function public.photo_finals_index_hash(jsonb) from public,anon,authenticated;
grant execute on function public.photo_finals_index_hash(jsonb) to service_role;

create table public.media_package_chunk_indexes(
 organization_id uuid not null,package_id uuid not null,release_id uuid not null,
 version integer not null check(version=1),manifest_sha256 bytea not null check(octet_length(manifest_sha256)=32),
 package_sha256 bytea not null check(octet_length(package_sha256)=32),byte_size bigint not null check(byte_size between 1 and 1100000000),
 chunk_size integer not null check(chunk_size=131072),chunk_count integer not null check(chunk_count=(byte_size+131071)/131072),
 digests bytea not null check(octet_length(digests)=chunk_count*32),index_sha256 bytea not null check(octet_length(index_sha256)=32),
 primary key(organization_id,package_id),foreign key(organization_id,package_id) references public.media_packages(organization_id,id),
 foreign key(organization_id,release_id) references public.gallery_releases(organization_id,id)
);
alter table public.media_package_chunk_indexes enable row level security;
alter table public.media_package_chunk_indexes force row level security;
revoke all on public.media_package_chunk_indexes from public,anon,authenticated;
grant select,insert on public.media_package_chunk_indexes to service_role;
create function public.photo_finals_index_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'finals_index_immutable' using errcode='23514';end $$;
create trigger finals_index_immutable before update or delete on public.media_package_chunk_indexes for each row execute function public.photo_finals_index_immutable();
create function public.photo_finals_package_index_targets(p_org uuid,p_job uuid,p_lease uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; result jsonb;
begin
 j:=public.photo_finals_package_fence(p_org,p_job,p_lease);
 select jsonb_agg(to_jsonb(p) order by package_type) into result from public.media_packages p where organization_id=p_org and release_id=j.finals_release_id;
 return result;
end $$;
create function public.photo_finals_package_finish_indexed(p_org uuid,p_job uuid,p_lease uuid,p_evidence jsonb,p_indexes jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare j public.media_ingest_jobs; p public.media_packages; i jsonb;
begin
 j:=public.photo_finals_package_fence(p_org,p_job,p_lease);
 if jsonb_typeof(p_indexes) is distinct from 'array' or jsonb_array_length(p_indexes)<>2 then raise exception 'finals_index_pair_required' using errcode='23514';end if;
 -- Calling legacy finish within this transaction keeps all readiness invisible until
 -- both verified indexes are validated and inserted. Any error rolls everything back.
 perform public.photo_finals_package_finish(p_org,p_job,p_lease,p_evidence);
 for i in select value from jsonb_array_elements(p_indexes) loop
  if public.photo_finals_index_hash(i) is distinct from i->>'index_sha256' then raise exception 'finals_index_digest' using errcode='23514';end if;
  select * into p from public.media_packages where organization_id=p_org and id=(i->>'package_id')::uuid and release_id=j.finals_release_id;
  if p.id is null or i->>'organization_id' is distinct from p_org::text or i->>'release_id' is distinct from p.release_id::text
  or i->>'manifest_sha256' is distinct from encode(p.manifest_sha256,'hex') or i->>'package_sha256' is distinct from encode(p.package_sha256,'hex')
  or (i->>'byte_size')::bigint is distinct from p.byte_size then raise exception 'finals_index_binding' using errcode='23514';end if;
  insert into public.media_package_chunk_indexes values(p_org,p.id,p.release_id,1,p.manifest_sha256,p.package_sha256,p.byte_size,131072,(i->>'chunk_count')::integer,decode(i->>'digests','hex'),decode(i->>'index_sha256','hex'));
 end loop;
end $$;
revoke all on function public.photo_finals_index_immutable(),public.photo_finals_package_index_targets(uuid,uuid,uuid),public.photo_finals_package_finish_indexed(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.photo_finals_index_immutable(),public.photo_finals_package_index_targets(uuid,uuid,uuid),public.photo_finals_package_finish_indexed(uuid,uuid,uuid,jsonb,jsonb) to service_role;

create table public.media_download_transfers(
 organization_id uuid not null,id uuid not null,actor_id uuid not null,booking_id uuid not null,property_id uuid not null,
 package_id uuid not null,session_hash text not null check(session_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null,expires_at timestamptz not null,revoked_at timestamptz,
 primary key(organization_id,id),foreign key(organization_id,package_id) references public.media_package_chunk_indexes(organization_id,package_id),
 check(expires_at=created_at+interval '7 days')
);
alter table public.media_download_transfers enable row level security;
alter table public.media_download_transfers force row level security;
revoke all on public.media_download_transfers from public,anon,authenticated;
grant select,insert,update on public.media_download_transfers to service_role;

-- Every admission and successful handoff uses the same global/batch/release order
-- as creation/withdrawal. SHARE locks fence ordinary authority/rights updates too.
create function public.photo_finals_resume_authority(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_operator boolean,p_package uuid) returns public.media_packages language plpgsql security invoker set search_path='' as $$
declare p public.media_packages;s jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('finals:'||p_org,0));
 select * into p from public.media_packages where organization_id=p_org and id=p_package and property_id=p_property;
 if p.id is null then raise exception 'finals_transfer_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finals-release:'||p_org||':'||p.batch_id,0));
 perform 1 from public.gallery_releases where organization_id=p_org and id=p.release_id for update;
 perform 1 from public.profiles where organization_id=p_org and id=p_actor for share;
 perform 1 from public.organization_members where organization_id=p_org and profile_id=p_actor for share;
 perform 1 from public.bookings where organization_id=p_org and id=p_booking for share;
 perform 1 from public.properties where organization_id=p_org and id=p_property for share;
 perform 1 from public.media_versions v join public.gallery_release_items i on i.organization_id=v.organization_id and i.media_version_id=v.id where i.organization_id=p_org and i.release_id=p.release_id order by v.id for share of v;
 s:=public.photo_finals_current(p_org,p_actor,p_booking,p_property,p_operator);
 if s->>'complete' is distinct from 'true' or not exists(select 1 from jsonb_array_elements(s->'packages') x where x->>'id'=p_package::text)
 or not exists(select 1 from public.media_package_chunk_indexes where organization_id=p_org and package_id=p_package)
 then raise exception 'finals_transfer_denied' using errcode='42501';end if;
 return p;
end $$;
create function public.photo_finals_resume_index(p_org uuid,p_package uuid) returns jsonb language sql security invoker set search_path='' as $$
 select to_jsonb(i)||jsonb_build_object('manifest_sha256',encode(i.manifest_sha256,'hex'),'package_sha256',encode(i.package_sha256,'hex'),'digests',encode(i.digests,'hex'),'index_sha256',encode(i.index_sha256,'hex')) from public.media_package_chunk_indexes i where organization_id=p_org and package_id=p_package;
$$;
create function public.photo_finals_transfer_status(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_operator boolean,p_session text,p_transfer uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.media_download_transfers;p public.media_packages;
begin
 perform pg_advisory_xact_lock(hashtextextended('finals:'||p_org,0));
 select * into t from public.media_download_transfers where organization_id=p_org and id=p_transfer;
 if t.id is null or t.actor_id is distinct from p_actor or t.booking_id is distinct from p_booking or t.property_id is distinct from p_property
 or t.session_hash is distinct from p_session or t.expires_at<=clock_timestamp() or t.revoked_at is not null then raise exception 'finals_transfer_denied' using errcode='42501';end if;
 p:=public.photo_finals_resume_authority(p_org,p_actor,p_booking,p_property,p_operator,t.package_id);
 return jsonb_build_object('transfer',to_jsonb(t),'package',to_jsonb(p),'index',public.photo_finals_resume_index(p_org,t.package_id),'coverage',(select coalesce(jsonb_agg(chunk_index order by chunk_index),'[]') from (select distinct chunk_index from public.media_download_attempts where organization_id=p_org and transfer_id=p_transfer and completed) covered));
end $$;
create function public.photo_finals_transfer_begin(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_operator boolean,p_session text,p_package uuid,p_transfer uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.media_download_transfers;stamp timestamptz:=clock_timestamp();
begin
 if p_session is null or p_session !~ '^[0-9a-f]{64}$' or p_transfer is null then raise exception 'finals_transfer_denied' using errcode='42501';end if;
 perform public.photo_finals_resume_authority(p_org,p_actor,p_booking,p_property,p_operator,p_package);
 select * into t from public.media_download_transfers where organization_id=p_org and id=p_transfer;
 if t.id is not null then
  if t.package_id is distinct from p_package then raise exception 'finals_transfer_denied' using errcode='42501';end if;
  return public.photo_finals_transfer_status(p_org,p_actor,p_booking,p_property,p_operator,p_session,p_transfer);
 end if;
 if (select count(*) from public.media_download_transfers where organization_id=p_org and actor_id=p_actor and package_id=p_package)>=8 then raise exception 'finals_transfer_limit' using errcode='54000';end if;
 insert into public.media_download_transfers values(p_org,p_transfer,p_actor,p_booking,p_property,p_package,p_session,stamp,stamp+interval '7 days',null);
 return public.photo_finals_transfer_status(p_org,p_actor,p_booking,p_property,p_operator,p_session,p_transfer);
end $$;
create function public.photo_finals_transfer_resume(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_operator boolean,p_session text,p_transfer uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.media_download_transfers;
begin
 perform pg_advisory_xact_lock(hashtextextended('finals:'||p_org,0));
 select * into t from public.media_download_transfers where organization_id=p_org and id=p_transfer;
 if t.id is null or t.actor_id is distinct from p_actor or t.booking_id is distinct from p_booking or t.property_id is distinct from p_property
 or p_session is null or p_session !~ '^[0-9a-f]{64}$' or t.expires_at<=clock_timestamp() or t.revoked_at is not null then raise exception 'finals_transfer_denied' using errcode='42501';end if;
 perform public.photo_finals_resume_authority(p_org,p_actor,p_booking,p_property,p_operator,t.package_id);
 update public.media_download_transfers set session_hash=p_session where organization_id=p_org and id=p_transfer;
 return public.photo_finals_transfer_status(p_org,p_actor,p_booking,p_property,p_operator,p_session,p_transfer);
end $$;
create table public.media_download_attempts(
 organization_id uuid not null,id uuid not null default gen_random_uuid(),transfer_id uuid not null,actor_id uuid not null,package_id uuid not null,
 session_hash text not null,request_id uuid not null,chunk_index integer not null check(chunk_index>=0),
 reserved_bytes integer not null check(reserved_bytes between 1 and 131072),emitted_bytes integer not null default 0 check(emitted_bytes between 0 and reserved_bytes),
 created_at timestamptz not null,expires_at timestamptz not null,settled_at timestamptz,completed boolean,
 primary key(organization_id,id),unique(organization_id,request_id),foreign key(organization_id,transfer_id) references public.media_download_transfers(organization_id,id),
 foreign key(organization_id,package_id) references public.media_package_chunk_indexes(organization_id,package_id),check(expires_at=created_at+interval '90 seconds'),
 check((settled_at is null)=(completed is null))
);
create index finals_attempt_budget_lookup on public.media_download_attempts(organization_id,actor_id,package_id,chunk_index);
alter table public.media_download_attempts enable row level security;
alter table public.media_download_attempts force row level security;
revoke all on public.media_download_attempts from public,anon,authenticated;
grant select,insert,update on public.media_download_attempts to service_role;
create function public.photo_finals_chunk_begin(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_operator boolean,p_session text,p_transfer uuid,p_chunk integer,p_request uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb;t public.media_download_transfers;i public.media_package_chunk_indexes;a public.media_download_attempts;n integer;stamp timestamptz;
begin
 s:=public.photo_finals_transfer_status(p_org,p_actor,p_booking,p_property,p_operator,p_session,p_transfer);
 select * into t from public.media_download_transfers where organization_id=p_org and id=p_transfer;
 select * into i from public.media_package_chunk_indexes where organization_id=p_org and package_id=t.package_id;
 if p_chunk is null or p_chunk<0 or p_chunk>=i.chunk_count or p_request is null then raise exception 'finals_attempt_invalid' using errcode='22023';end if;
 if exists(select 1 from public.media_download_attempts where organization_id=p_org and request_id=p_request)
 or exists(select 1 from public.media_download_attempts where organization_id=p_org and transfer_id=p_transfer and settled_at is null and expires_at>clock_timestamp()) then raise exception 'finals_attempt_already_started' using errcode='42501';end if;
 n:=least(131072,i.byte_size-p_chunk::bigint*131072)::integer;
 if (select count(*) from public.media_download_attempts where organization_id=p_org and actor_id=p_actor and package_id=t.package_id and chunk_index=p_chunk)>=4
 or (select coalesce(sum(reserved_bytes),0) from public.media_download_attempts where organization_id=p_org and actor_id=p_actor and package_id=t.package_id)+n>i.byte_size*4
 then raise exception 'finals_attempt_budget' using errcode='54000';end if;
 stamp:=clock_timestamp();
 insert into public.media_download_attempts(organization_id,transfer_id,actor_id,package_id,session_hash,request_id,chunk_index,reserved_bytes,created_at,expires_at)
 values(p_org,p_transfer,p_actor,t.package_id,p_session,p_request,p_chunk,n,stamp,stamp+interval '90 seconds') returning * into a;
 return jsonb_build_object('attempt',to_jsonb(a),'package',s->'package','index',s->'index','chunkSha256',encode(substring(i.digests from p_chunk*32+1 for 32),'hex'),'offset',p_chunk::bigint*131072,'length',n);
end $$;
create function public.photo_finals_chunk_finish(p_org uuid,p_actor uuid,p_booking uuid,p_property uuid,p_operator boolean,p_session text,p_transfer uuid,p_attempt uuid,p_completed boolean,p_emitted_bytes integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.media_download_attempts;t public.media_download_transfers;ok boolean:=false;
begin
 perform pg_advisory_xact_lock(hashtextextended('finals:'||p_org,0));
 select * into t from public.media_download_transfers where organization_id=p_org and id=p_transfer;
 select * into a from public.media_download_attempts where organization_id=p_org and id=p_attempt and transfer_id=p_transfer for update;
 if a.id is null or t.id is null or t.actor_id is distinct from p_actor or t.booking_id is distinct from p_booking or t.property_id is distinct from p_property
 or t.session_hash is distinct from p_session or a.session_hash is distinct from p_session or p_completed is null
 or p_emitted_bytes is null or p_emitted_bytes<0 or p_emitted_bytes>a.reserved_bytes then raise exception 'finals_attempt_denied' using errcode='42501';end if;
 if p_completed then
  -- Replayed true is not an enduring dispatch grant. It requires fresh authority
  -- and original expiry, even though the committed ledger remains immutable.
  perform public.photo_finals_transfer_status(p_org,p_actor,p_booking,p_property,p_operator,p_session,p_transfer);
  ok:=a.expires_at>clock_timestamp();
 end if;
 if a.settled_at is not null then return a.completed and ok;end if;
 update public.media_download_attempts set settled_at=clock_timestamp(),completed=ok,emitted_bytes=p_emitted_bytes where organization_id=p_org and id=p_attempt;
 return ok;
end $$;

do $$ declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in('photo_finals_chunk_begin','photo_finals_chunk_finish','photo_finals_resume_authority','photo_finals_resume_index','photo_finals_transfer_begin','photo_finals_transfer_status','photo_finals_transfer_resume') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);execute format('alter function %s set lock_timeout=%L',f.signature,'5s');end loop;end $$;
