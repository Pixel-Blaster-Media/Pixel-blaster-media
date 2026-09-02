\set ON_ERROR_STOP on

do $$
declare
  v_notes text;
  v_revision bigint;
begin
  select notes, revision
  into v_notes, v_revision
  from public.booking_internal_notes
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and booking_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  if v_notes is distinct from 'Expanded RPC update' or v_revision <> 3 then
    raise exception 'legacy booking note was not preserved exactly';
  end if;

  if exists (select 1 from public.bookings where internal_notes is not null) then
    raise exception 'legacy realtor-readable booking note residue remained';
  end if;

  if has_table_privilege('anon', 'public.booking_internal_notes', 'SELECT')
     or has_table_privilege('authenticated', 'public.booking_internal_notes', 'SELECT')
     or has_table_privilege('authenticated', 'public.booking_internal_notes', 'INSERT')
     or has_table_privilege('authenticated', 'public.booking_internal_notes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.booking_internal_notes', 'DELETE')
     or has_table_privilege('service_role', 'public.booking_internal_notes', 'SELECT')
     or has_table_privilege('service_role', 'public.booking_internal_notes', 'INSERT')
     or has_table_privilege('service_role', 'public.booking_internal_notes', 'UPDATE')
     or has_table_privilege('service_role', 'public.booking_internal_notes', 'DELETE') then
    raise exception 'browser roles retained private-note table privileges';
  end if;

  if has_function_privilege(
       'anon',
       'public.get_booking_internal_notes(uuid,uuid[],uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.get_booking_internal_notes(uuid,uuid[],uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.get_booking_internal_notes(uuid,uuid[],uuid)',
       'EXECUTE'
     ) then
    raise exception 'private-note read RPC grants are unsafe';
  end if;

  if has_function_privilege(
       'anon',
       'public.update_booking_internal_notes(uuid,uuid,bigint,text,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.update_booking_internal_notes(uuid,uuid,bigint,text,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.update_booking_internal_notes(uuid,uuid,bigint,text,uuid)',
       'EXECUTE'
     ) then
    raise exception 'private-note mutation RPC grants are unsafe';
  end if;
end;
$$;

do $$
declare
  v_status text;
  v_notes text;
  v_revision bigint;
  v_read_count integer;
begin
  select result_status, result_notes, result_revision
  into v_status, v_notes, v_revision
  from public.update_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    '12121212-1212-4212-8212-121212121212',
    1,
    'Owner contract note',
    '99999999-9999-4999-8999-999999999999'
  );
  if v_status <> 'saved' or v_notes <> 'Owner contract note' or v_revision <> 2 then
    raise exception 'owner membership could not mutate private notes after contract';
  end if;

  select count(*), min(notes), min(revision)
  into v_read_count, v_notes, v_revision
  from public.get_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    array['12121212-1212-4212-8212-121212121212']::uuid[],
    '99999999-9999-4999-8999-999999999999'
  );
  if v_read_count <> 1 or v_notes <> 'Owner contract note' or v_revision <> 2 then
    raise exception 'owner membership could not read private notes after contract';
  end if;
end;
$$;

do $$
declare
  v_status text;
  v_notes text;
  v_revision bigint;
  v_read_count integer;
begin
  select count(*), min(notes), min(revision)
  into v_read_count, v_notes, v_revision
  from public.get_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    array['dddddddd-dddd-4ddd-8ddd-dddddddddddd']::uuid[],
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if v_read_count <> 1 or v_notes is distinct from 'Expanded RPC update' or v_revision <> 3 then
    raise exception 'private-note read RPC returned the wrong tenant snapshot';
  end if;
  begin
    perform public.get_booking_internal_notes(
      '11111111-1111-4111-8111-111111111111',
      array['dddddddd-dddd-4ddd-8ddd-dddddddddddd']::uuid[],
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    );
    raise exception 'realtor actor read private notes';
  exception when sqlstate '42501' then
    null;
  end;

  select result_status, result_notes, result_revision
  into v_status, v_notes, v_revision
  from public.update_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    3,
    repeat('x', 2000),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if v_status <> 'saved' or v_notes <> repeat('x', 2000) or v_revision <> 4 then
    raise exception 'exact 2000-character private note did not save';
  end if;

  select result_status, result_notes, result_revision
  into v_status, v_notes, v_revision
  from public.update_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    4,
    repeat('x', 2000),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if v_status <> 'saved' or v_revision <> 4 then
    raise exception 'unchanged private note advanced its revision';
  end if;

  select result_status, result_notes, result_revision
  into v_status, v_notes, v_revision
  from public.update_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    3,
    'stale overwrite',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if v_status <> 'conflict' or v_notes <> repeat('x', 2000) or v_revision <> 4 then
    raise exception 'stale private-note update was not rejected with canonical state';
  end if;

  begin
    perform public.update_booking_internal_notes(
      '11111111-1111-4111-8111-111111111111',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      4,
      repeat('y', 2001),
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
    raise exception 'over-limit private note was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.update_booking_internal_notes(
      '11111111-1111-4111-8111-111111111111',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      4,
      'unauthorized actor',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    );
    raise exception 'realtor actor mutated private notes';
  exception when sqlstate '42501' then
    null;
  end;

  select result_status, result_notes, result_revision
  into v_status, v_notes, v_revision
  from public.update_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    0,
    'cross tenant',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if v_status <> 'not_found' or v_notes is not null or v_revision is not null then
    raise exception 'cross-tenant booking did not fail closed as not found';
  end if;

  select result_status, result_notes, result_revision
  into v_status, v_notes, v_revision
  from public.update_booking_internal_notes(
    '11111111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    4,
    null,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if v_status <> 'saved' or v_notes is not null or v_revision <> 5 then
    raise exception 'private note clear did not preserve monotonic revision';
  end if;
end;
$$;
