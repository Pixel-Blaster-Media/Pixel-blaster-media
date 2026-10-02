import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const pg = process.env.POSTGRES_BIN || (existsSync('/opt/homebrew/opt/postgresql@17/bin/initdb')
  ? '/opt/homebrew/opt/postgresql@17/bin' : '');
const org = '00000000-0000-0000-0000-000000000001';
const owner = '93000000-0000-4000-8000-000000000001';
const actor = '93000000-0000-4000-8000-000000000002';
const historicalAdminRequest = '93000000-0000-4000-8000-000000000003';
const historicalPublicRequest = '93000000-0000-4000-8000-000000000004';
const guard = '20260930202500_booking_quote_policy_guard.sql';
const policy = '20260930203055_booking_size_and_basement_policy.sql';
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('real in-flight old admin/public requests cannot cross the quote-policy write boundary', { timeout: 180000 }, async t => {
  const temp = mkdtempSync('/tmp/pb-quote-race-');
  const sessions = new Set();
  let started = false;
  let database = 'postgres';
  let counter = 0;
  // Explicit socket and a minimal environment prevent use of any live DB config.
  const env = { PATH: process.env.PATH, LC_ALL: 'C', PGCONNECT_TIMEOUT: '5' };
  const args = () => ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '-h', join(temp, 'socket'), '-U', 'postgres', '-d', database];
  function command(name, argv, required = true) {
    const result = spawnSync(pg ? join(pg, name) : name, argv, { encoding: 'utf8', timeout: 30000, env });
    if (required) assert.equal(result.status, 0, `${name}: ${result.error ?? ''}\n${result.stderr}\n${result.stdout}`);
    return result;
  }
  function sql(query) { return command('psql', [...args(), '-c', query]).stdout.trim(); }
  function file(path, required = true) { return command('psql', [...args(), '-f', path], required); }
  function migration(name, required = true) {
    const path = join(temp, 'migration.sql');
    writeFileSync(path, `begin;\n${readFileSync(join(root, 'supabase/migrations', name), 'utf8')}\ncommit;\n`);
    return file(path, required);
  }
  function session(label) {
    const name = `quote-race-${counter++}-${label}`;
    const child = spawn(pg ? join(pg, 'psql') : 'psql', args(), {
      env: { ...env, PGAPPNAME: name, PGOPTIONS: '-c statement_timeout=20000 -c idle_in_transaction_session_timeout=20000' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', code => { sessions.delete(child); resolve(code); });
    });
    sessions.add(child);
    return { child, name, done, output: () => output };
  }
  async function until(check, message) {
    for (let i = 0; i < 150; i++) {
      if (check()) return;
      await pause(20);
    }
    assert.fail(message());
  }
  const adminInput = (item, changes = {}) => ({ owner_id: owner, street_address: 'In-flight admin fixture',
    city: 'Toronto', province: 'ON', postal_code: 'M1M1M1', scheduled_at: '2090-01-05T15:00:00Z',
    square_footage: 2501, catalog_item_ids: [item], ...changes });
  function adminCall(request, input, booking = null, version = null) {
    return `select public.save_admin_booking_aggregate(${literal(org)},${literal(actor)},${literal(request)},` +
      `${booking ? literal(booking) : 'null'},${version ?? 'null'},${literal(JSON.stringify(input))}::jsonb);`;
  }
  function publicCall(request, item, replay = false, core = false) {
    return `select public.${core ? 'create_public_booking_with_jobs_catalog_v1' : 'create_public_booking_with_jobs'}(` +
      `${literal(request)},${literal(org)},${literal(owner)},'Public in-flight fixture','Toronto','M1M1M1','',` +
      `${literal(replay ? '2090-01-03T15:00:00Z' : '2090-01-07T15:00:00Z')}::timestamptz,2501,'vacant',true,'',` +
      `array[${literal(item)}::uuid],'{}'::uuid[]);`;
  }
  function state() {
    // Schema activation adds a zero-default field, not a historical data edit.
    return JSON.parse(sql(`select jsonb_build_object(
      'bookings',(select jsonb_agg(to_jsonb(x)-'basement_duration_minutes' order by id) from public.bookings x),
      'lines',(select jsonb_agg(to_jsonb(x) order by id) from public.booking_line_items x),
      'properties',(select jsonb_agg(to_jsonb(x) order by id) from public.properties x),
      'requests',(select jsonb_agg(to_jsonb(x) order by request_id) from public.admin_booking_requests x),
      'jobs',(select jsonb_agg(to_jsonb(x) order by id) from public.integration_jobs x),
      'notices',(select jsonb_agg(to_jsonb(x) order by id) from public.booking_lifecycle_notices x),
      'profiles',(select jsonb_agg(to_jsonb(x) order by id) from public.profiles x));`));
  }
  async function isolated(run) {
    database = 'postgres';
    const name = `quote_case_${counter++}`;
    sql(`create database ${name} template quote_base;`);
    database = name;
    try { await run(); }
    finally {
      for (const child of sessions) child.kill('SIGKILL');
      database = 'postgres';
      sql(`drop database ${name} with (force);`);
    }
  }
  try {
    assert.match(command('postgres', ['--version']).stdout, /\) 17\./);
    mkdirSync(join(temp, 'socket'));
    command('initdb', ['-D', join(temp, 'data'), '-A', 'trust', '-U', 'postgres', '--no-locale']);
    command('pg_ctl', ['-D', join(temp, 'data'), '-l', join(temp, 'server.log'), '-o',
      `-F -k ${join(temp, 'socket')} -c listen_addresses=''`, '-w', 'start']);
    started = true;
    sql('create database quote_base;');
    database = 'quote_base';
    file(join(root, 'tests/postgres/supabase-platform.sql'));
    const before = readFileSync(join(root, 'supabase/setup.sql'), 'utf8')
      .split(`-- Begin supabase/migrations/${guard}`)[0];
    writeFileSync(join(temp, 'before.sql'), `begin;\n${before}\ncommit;`);
    file(join(temp, 'before.sql'));
    sql(`insert into auth.users(id,email,raw_app_meta_data) values
      (${literal(owner)},'race-realtor@example.invalid','{"realtor_organization_id":"${org}"}'),
      (${literal(actor)},'race-admin@example.invalid','{"realtor_organization_id":"${org}"}');
      update public.profiles set role='admin' where id=${literal(actor)};
      update public.organization_members set role='admin' where profile_id=${literal(actor)};`);
    // Resolve catalog IDs before starting request sessions, exactly as the app does.
    const video = sql(`select id from public.catalog_items where organization_id=${literal(org)} and slug='video_tour';`);
    const photo = sql(`select id from public.catalog_items where organization_id=${literal(org)} and slug='residential_photography';`);
    const historicalInput = adminInput(photo, { scheduled_at: '2090-01-01T15:00:00Z' });
    const receipt = JSON.parse(sql(`set role service_role;${adminCall(historicalAdminRequest, historicalInput)}`));
    sql(`set role service_role;${publicCall(historicalPublicRequest, video, true)}`);

    for (const isolation of ['read committed', 'repeatable read']) {
      for (const phase of ['paused', 'active']) {
        for (const kind of ['admin-create', 'admin-basement', 'admin-edit', 'admin-retained-edit',
          'public-wrapper', 'public-core', 'admin-replay', 'public-replay']) {
          await t.test(`${isolation}: old ${kind} across ${phase} cutover`, () => isolated(async () => {
            const isPublic = kind.startsWith('public');
            const isReplay = kind.endsWith('replay');
            const request = isReplay ? (isPublic ? historicalPublicRequest : historicalAdminRequest) : randomUUID();
            const lock = isPublic
              ? `hashtextextended('public-booking-request:${org}:${request}',0)`
              : `hashtextextended('${org}:${request}',2)`;
            const snapshot = state();
            const blocker = session('request-blocker');
            blocker.child.stdin.write(`begin;select pg_advisory_xact_lock(${lock});select 'BLOCKER_READY';\n`);
            await until(() => blocker.output().includes('BLOCKER_READY'), () => blocker.output());
            const worker = session('old-request');
            const input = isReplay ? historicalInput : adminInput(kind === 'admin-retained-edit' ? photo : video,
              kind === 'admin-basement' ? { include_basement: true } : { client_notes: 'Uncommitted edit' });
            const call = isPublic ? publicCall(request, video, isReplay, kind === 'public-core')
              : adminCall(request, input, kind.includes('edit') ? receipt.booking_id : null,
                kind.includes('edit') ? receipt.lifecycle_version : null);
            worker.child.stdin.end(`begin isolation level ${isolation};set role service_role;${call}commit;\n`);
            await until(() => sql(`select count(*) from pg_stat_activity where application_name=${literal(worker.name)} and wait_event='advisory';`) === '1',
              () => `Old request did not enter its original body: ${worker.output()}`);

            migration(guard);
            assert.equal(sql('select public.current_booking_quote_policy();'), 'paused');
            let activation;
            if (phase === 'active') {
              activation = session('activation');
              activation.child.stdin.end(`begin;${readFileSync(join(root, 'supabase/migrations', policy), 'utf8')}commit;\n`);
              await until(() => activation.child.exitCode !== null ||
                sql(`select count(*) from pg_stat_activity where application_name=${literal(activation.name)} and wait_event='relation';`) === '1',
              () => `Activation did not finish or reach its real relation-lock barrier: ${activation.output()}`);
              // Real old wrappers retain a catalog read lock. Activation must
              // wait for them; it must not silently skip the DDL or its guard.
              if (activation.child.exitCode === null) assert.equal(sql('select public.current_booking_quote_policy();'), 'paused');
              else {
                assert.equal(await activation.done, 0, activation.output());
                assert.equal(sql('select public.current_booking_quote_policy();'), '2026-09-30-v1');
              }
            }
            blocker.child.stdin.end('commit;\n');
            assert.equal(await blocker.done, 0, blocker.output());
            const exit = await worker.done;
            if (isReplay) {
              assert.equal(exit, 0, worker.output());
              assert.match(worker.output(), /"replayed": true/);
            } else {
              assert.notEqual(exit, 0, `Stale request committed: ${worker.output()}`);
              assert.match(worker.output(), /PB005/, worker.output());
            }
            if (activation) assert.equal(await activation.done, 0, activation.output());
            else migration(policy);
            assert.equal(sql('select public.current_booking_quote_policy();'), '2026-09-30-v1');
            assert.deepEqual(state(), snapshot, 'Rejected/replayed old request changed bookings, identities, snapshots, contacts or effects');
            assert.equal(sql('select count(*) from public.bookings where basement_duration_minutes<>0;'), '0');
          }));
        }
      }
    }

    for (const kind of ['admin', 'public']) {
      await t.test(`guard installation times out atomically behind an admitted ${kind} writer`, () => isolated(async () => {
        const writer = session('admitted-writer');
        const request = randomUUID();
        writer.child.stdin.write(`begin;set role service_role;${kind === 'admin'
          ? adminCall(request, adminInput(video)) : publicCall(request, video)}select 'OLD_WRITE_PENDING';\n`);
        await until(() => writer.output().includes('OLD_WRITE_PENDING'), () => writer.output());
        const result = migration(guard, false);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /55P03.*lock timeout/);
        assert.equal(sql("select to_regprocedure('public.current_booking_quote_policy()') is null;"), 't',
          'Partial guard became visible after timeout');
        writer.child.stdin.end('commit;\n');
        assert.equal(await writer.done, 0, writer.output());
        const snapshot = state();
        migration(guard);
        migration(policy);
        assert.deepEqual(state(), snapshot, 'Cutover rewrote a transaction committed before the pause');
      }));
    }
  } finally {
    for (const child of sessions) child.kill('SIGKILL');
    if (started) command('pg_ctl', ['-D', join(temp, 'data'), '-m', 'immediate', '-w', 'stop']);
    rmSync(temp, { recursive: true, force: true });
  }
});
