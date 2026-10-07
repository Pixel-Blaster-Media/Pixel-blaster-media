import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const repository = resolve(root, '..');
const predecessor = '937275278012b3d5466a43b136a3fde4ed0e76e4';
const migrationName = '20261007140933_photo_finals_encoder_security_revision.sql';
const migrationSql = readFileSync(join(root, 'supabase/migrations', migrationName), 'utf8');
const pg = process.env.POSTGRES_BIN || (existsSync('/opt/homebrew/opt/postgresql@17/bin/initdb')
  ? '/opt/homebrew/opt/postgresql@17/bin' : '');
const functions = ['photo_finals_approve_release', 'photo_finals_checkpoint_guard',
  'photo_finals_package_finish', 'photo_finals_prepare_release', 'photo_finals_transform_specs'];
const uid = n => `94000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { org: uid(1), actor: uid(2), property: uid(3), booking: uid(4) };
const literal = value => value === null ? 'null' : typeof value === 'number' ? String(value)
  : `'${(typeof value === 'object' ? JSON.stringify(value) : String(value)).replaceAll("'", "''")}'`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function historicalFile(path) {
  const result = spawnSync('git', ['show', `${predecessor}:${path}`], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}

test('encoder upgrade preserves historical migration bytes', () => {
  const result = spawnSync('git', ['ls-tree', '-r', '--name-only', predecessor, '--',
    'booking/supabase/migrations', 'booking/supabase/bootstrap-migrations'], { cwd: repository, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const paths = result.stdout.trim().split('\n').filter(path => path.endsWith('.sql'));
  assert.equal(paths.filter(path => path.startsWith('booking/supabase/migrations/')).length, 59);
  for (const path of paths) assert.equal(digest(readFileSync(join(repository, path))), digest(historicalFile(path)), path);
});

test('encoder upgrade preserves history, grants and revision-specific package keys on PostgreSQL 17', { timeout: 180000 }, async t => {
  const temp = mkdtempSync('/tmp/pb-encoder-upgrade-');
  const sessions = new Set();
  let started = false;
  let database = 'postgres';
  let caseNumber = 0;
  // Never inherit a live database URL, PG service, password, or remote host.
  const env = { PATH: process.env.PATH, LC_ALL: 'C', PGCONNECT_TIMEOUT: '5' };
  const args = () => ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '-h', join(temp, 'socket'), '-U', 'postgres', '-d', database];
  function command(name, argv, required = true) {
    const result = spawnSync(pg ? join(pg, name) : name, argv,
      { encoding: 'utf8', env, timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    if (required) assert.equal(result.status, 0, `${name}: ${result.error ?? ''}\n${result.stderr}\n${result.stdout}`);
    return result;
  }
  const sql = query => command('psql', [...args(), '-c', query]).stdout.trim();
  const json = query => JSON.parse(sql(query));
  function migrate({ failAfterDdl = false } = {}, required = true) {
    const path = join(temp, 'upgrade.sql');
    writeFileSync(path, `begin;\n${migrationSql}\n${failAfterDdl ? 'select missing_encoder_upgrade_assertion();' : ''}\ncommit;\n`);
    return command('psql', [...args(), '-f', path], required);
  }
  function rpc(name, parameters) {
    assert.match(name, /^photo_finals_[a-z_]+$/);
    const output = sql(`set role service_role;select to_jsonb(public.${name}(${Object.entries(parameters)
      .map(([name, value]) => `${name}=>${literal(value)}`).join(',')}));`);
    return JSON.parse(output || 'null');
  }
  function surface() {
    return json(`select jsonb_agg(jsonb_build_object('name',p.proname,'oid',p.oid,
      'signature',pg_get_function_identity_arguments(p.oid),'returns',pg_get_function_result(p.oid),
      'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'config',p.proconfig,
      'volatility',p.provolatile,'parallel',p.proparallel,'acl',p.proacl,
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service',has_function_privilege('service_role',p.oid,'EXECUTE'),
      'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee=0 and a.privilege_type='EXECUTE'),
      'definition',pg_get_functiondef(p.oid)) order by p.proname)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (${functions.map(literal).join(',')});`);
  }
  function rows() {
    const tables = ['gallery_releases', 'gallery_release_items', 'media_derivatives', 'media_packages',
      'media_ingest_jobs', 'media_job_attempts', 'media_versions'];
    return json(`select jsonb_build_object(${tables.map(table => `${literal(table)},
      (select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.${table} r)`).join(',')});`);
  }
  async function isolated(run) {
    database = 'postgres';
    const name = `encoder_case_${caseNumber++}`;
    sql(`create database ${name} template encoder_base;`);
    database = name;
    try { await run(); }
    finally {
      for (const child of sessions) child.kill('SIGKILL');
      database = 'postgres';
      sql(`drop database ${name} with (force);`);
    }
  }
  function session(label) {
    const name = `encoder-${caseNumber}-${label}`;
    const child = spawn(pg ? join(pg, 'psql') : 'psql', args(), { env: { ...env, PGAPPNAME: name,
      PGOPTIONS: '-c statement_timeout=20000 -c idle_in_transaction_session_timeout=20000' },
    stdio: ['pipe', 'pipe', 'pipe'] });
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
  async function until(check, failure) {
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline) {
      if (check()) return;
      await pause(20);
    }
    assert.fail(failure());
  }
  function acceptedFixture() {
    sql(`insert into public.organizations(id,name,slug) values(${literal(scope.org)},'Encoder fixture','encoder-fixture');
      insert into auth.users(id,email,raw_app_meta_data) values(${literal(scope.actor)},'encoder@example.invalid',
        ${literal({ realtor_organization_id: scope.org })}::jsonb);
      update public.profiles set role='admin' where id=${literal(scope.actor)};
      update public.organization_members set role='admin' where profile_id=${literal(scope.actor)};
      insert into public.properties(id,organization_id,owner_id,street_address)
        values(${literal(scope.property)},${literal(scope.org)},${literal(scope.actor)},'Synthetic encoder fixture');
      insert into public.bookings(id,organization_id,property_id,owner_id)
        values(${literal(scope.booking)},${literal(scope.org)},${literal(scope.property)},${literal(scope.actor)});`);
    const job = rpc('photo_finals_create_intent', { p_org: scope.org, p_actor: scope.actor,
      p_booking: scope.booking, p_property: scope.property, p_request: uid(5), p_intent: uid(6),
      p_sha256: 'a'.repeat(64), p_bytes: 100 });
    const claimed = rpc('photo_finals_claim', { p_org: scope.org, p_booking: scope.booking,
      p_property: scope.property, p_job: job.id, p_worker: 'encoder-fixture' });
    const fence = { p_org: scope.org, p_job: job.id, p_lease: claimed.finals_lease_token };
    for (const stage of ['quarantined', 'validating', 'scanning']) rpc('photo_finals_stage', { ...fence, p_stage: stage });
    rpc('photo_finals_accept', { ...fence, p_bucket: 'synthetic-encoder-masters', p_width: 100, p_height: 80 });
    return job;
  }
  function prepare(job) {
    return rpc('photo_finals_prepare_release', { p_org: scope.org, p_actor: scope.actor,
      p_booking: scope.booking, p_property: scope.property, p_batch: job.batch_id,
      p_release: uid(7), p_expected_revision: 0, p_versions: [job.finals_version_id] });
  }
  function approveAndClaim(draft) {
    const approved = rpc('photo_finals_approve_release', { p_org: scope.org, p_actor: scope.actor,
      p_booking: scope.booking, p_property: scope.property, p_release: draft.id,
      p_revision: draft.revision_number, p_hash: draft.manifest_sha256.slice(2) });
    const claimed = rpc('photo_finals_package_claim', { p_org: scope.org, p_booking: scope.booking,
      p_property: scope.property, p_job: approved.job_id, p_worker: 'encoder-package' });
    return { p_org: scope.org, p_job: approved.job_id, p_lease: claimed.job.finals_lease_token };
  }
  function evidence(draft, job) {
    const derivatives = ['gallery', 'mls'].map((kind, index) => {
      const sha256 = String(index + 1).repeat(64);
      return { kind, version_id: job.finals_version_id, sha256, bytes: 100,
        bucket: 'synthetic-encoder-delivery', width: 100, height: 80,
        key: `derivatives/${scope.org}/${job.finals_version_id}/${draft.manifest.transforms[kind].version}/${sha256}.jpg` };
    });
    const packages = ['full_res_zip', 'mls_zip'].map((kind, index) => {
      const sha256 = String(index + 3).repeat(64);
      return { kind, sha256, bytes: 200, bucket: 'synthetic-encoder-delivery', entries: 1,
        key: `packages/${scope.org}/${draft.id}/${kind}/${sha256}.zip` };
    });
    // SQL-only worker attestations; actual JPEG/ZIP bytes are covered by the native/storage suites.
    return { derivatives, all: [...packages, ...derivatives] };
  }
  function derivativeInsert(job) {
    return `insert into public.media_derivatives(organization_id,property_id,batch_id,source_version_id,
      profile_id,profile_version,derivative_class,profile_status) values(${literal(scope.org)},
      ${literal(scope.property)},${literal(job.batch_id)},${literal(job.finals_version_id)},
      'web.listing.2048.v1',1,'web','defined');`;
  }
  try {
    assert.match(command('postgres', ['--version']).stdout, /\) 17\./);
    mkdirSync(join(temp, 'socket'));
    command('initdb', ['-D', join(temp, 'data'), '-A', 'trust', '-U', 'postgres', '--no-locale']);
    command('pg_ctl', ['-D', join(temp, 'data'), '-l', join(temp, 'server.log'), '-o',
      `-F -k ${join(temp, 'socket')} -c listen_addresses=''`, '-w', 'start']);
    started = true;
    assert.equal(sql('show listen_addresses;'), '');
    sql('create database encoder_base;');
    database = 'encoder_base';
    command('psql', [...args(), '-f', join(root, 'tests/postgres/supabase-platform.sql')]);
    const beforePath = join(temp, 'predecessor.sql');
    writeFileSync(beforePath, historicalFile('booking/supabase/setup.sql'));
    command('psql', [...args(), '--single-transaction', '-f', beforePath]);
    const oldSpecs = rpc('photo_finals_transform_specs', {});
    assert.equal(oldSpecs.gallery.version, 1);
    assert.equal(oldSpecs.gallery.encoder, 'sharp-0.35.4_libvips-8.18.6_mozjpeg-0826579');

    await t.test('empty-state upgrade retains function identity, API grants and bounded runtime configuration', () => isolated(async () => {
      const before = surface(), originalRows = rows();
      migrate();
      const after = surface();
      assert.deepEqual(after.map(({ definition, ...rest }) => rest), before.map(({ definition, ...rest }) => rest));
      assert.deepEqual(rows(), originalRows, 'DDL must not rewrite historical application rows');
      assert.deepEqual(after.map(row => row.name), functions);
      for (const row of after) {
        assert.equal(row.securityDefiner, false, row.name);
        assert.deepEqual([...row.config].sort(), ['lock_timeout=5s', 'search_path=""']);
        assert.equal(row.anon || row.authenticated || row.publicExecute, false, row.name);
        assert.equal(row.service, true, row.name);
      }
      const { TRANSFORMS } = await import('../../lib/media/finals/transforms.ts');
      const spec = rpc('photo_finals_transform_specs', {});
      assert.deepEqual(spec, TRANSFORMS);
      assert.equal(spec.gallery.version, 2); assert.equal(spec.mls.version, 2);
      assert.deepEqual(spec.full_res, oldSpecs.full_res);
      for (const role of ['anon', 'authenticated']) {
        const denied = command('psql', [...args(), '-c', `set role ${role};select public.photo_finals_transform_specs();`], false);
        assert.notEqual(denied.status, 0); assert.match(denied.stderr, /42501.*permission denied/);
      }

      const job = acceptedFixture(), draft = prepare(job);
      assert.deepEqual(draft.manifest.transforms, spec);
      assert.deepEqual(json(`select jsonb_agg(profile_version order by profile_id) from public.media_derivatives;`), [2, 2]);
      const fence = approveAndClaim(draft), proof = evidence(draft, job);
      const state = rows();
      assert.throws(() => rpc('photo_finals_package_checkpoint', { ...fence,
        p_evidence: { ...proof.derivatives[0], key: proof.derivatives[0].key.replace('/2/', '/1/') } }), /finals_checkpoint_invalid/);
      assert.deepEqual(rows(), state, 'a revision-1 checkpoint must not change the revision-2 job');
      for (const item of proof.derivatives) rpc('photo_finals_package_checkpoint', { ...fence, p_evidence: item });
      const checkpointed = rows();
      const badFinish = structuredClone(proof.all);
      badFinish.at(-1).key = badFinish.at(-1).key.replace('/2/', '/1/');
      assert.throws(() => rpc('photo_finals_package_finish', { ...fence, p_evidence: badFinish }), /finals_derivative_evidence_invalid/);
      assert.deepEqual(rows(), checkpointed, 'late bad-key rejection must roll back earlier package/derivative readiness');
      rpc('photo_finals_package_finish', { ...fence, p_evidence: proof.all });
      assert.equal(sql(`select state from public.gallery_releases where id=${literal(draft.id)};`), 'ready');
      assert.equal(sql("select count(*) from public.media_packages where status='ready';"), '2');
      assert.equal(sql("select count(*) from public.media_derivatives where status='ready' and profile_version=2 and object_key like '%/2/%';"), '2');
      assert.equal(sql('select count(*) from public.media_derivatives where profile_version=1;'), '0');
    }));

    await t.test('failure after replacement rolls back all five definitions and data', () => isolated(() => {
      const before = surface(), originalRows = rows();
      const rejected = migrate({ failAfterDdl: true }, false);
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /42883.*missing_encoder_upgrade_assertion/);
      assert.deepEqual(surface(), before);
      assert.deepEqual(rows(), originalRows);
      assert.deepEqual(rpc('photo_finals_transform_specs', {}), oldSpecs);
    }));

    for (const kind of ['unapproved release', 'leased package with checkpoints', 'ready release and packages', 'standalone derivative']) {
      await t.test(`existing ${kind} refuses upgrade without rewriting history`, () => isolated(() => {
        const job = acceptedFixture();
        if (kind === 'standalone derivative') sql(derivativeInsert(job));
        else {
          const draft = prepare(job);
          assert.deepEqual(draft.manifest.transforms, oldSpecs);
          if (kind !== 'unapproved release') {
            const fence = approveAndClaim(draft), proof = evidence(draft, job);
            rpc('photo_finals_package_checkpoint', { ...fence, p_evidence: proof.derivatives[0] });
            if (kind === 'ready release and packages') rpc('photo_finals_package_finish', { ...fence, p_evidence: proof.all });
          }
        }
        const before = surface(), originalRows = rows();
        const rejected = migrate({}, false);
        assert.notEqual(rejected.status, 0);
        assert.match(rejected.stderr, /55000.*finals_encoder_upgrade_existing_state/);
        assert.deepEqual(surface(), before);
        assert.deepEqual(rows(), originalRows, 'old manifests, checkpoints and ready object identities must remain unchanged');
      }));
    }

    await t.test('guard waits for an in-flight writer then rejects its committed historical state', () => isolated(async () => {
      const job = acceptedFixture(), before = surface();
      const writer = session('writer');
      writer.child.stdin.write(`begin;${derivativeInsert(job)}select 'ENCODER_WRITER_READY';\n`);
      await until(() => writer.output().includes('ENCODER_WRITER_READY'), () => writer.output());
      const upgrade = session('upgrade');
      upgrade.child.stdin.end(`begin;${migrationSql}\ncommit;\n`);
      await until(() => sql(`select count(*) from pg_stat_activity where application_name=${literal(upgrade.name)}
        and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`) === '1', () => upgrade.output());
      assert.deepEqual(surface(), before, 'function replacement must wait until the empty-state barrier is held');
      writer.child.stdin.end('commit;\n');
      assert.equal(await writer.done, 0, writer.output());
      assert.notEqual(await upgrade.done, 0, upgrade.output());
      assert.match(upgrade.output(), /55000.*finals_encoder_upgrade_existing_state/);
      assert.deepEqual(surface(), before);
      assert.equal(sql('select count(*) from public.media_derivatives where profile_version=1;'), '1');
      assert.deepEqual(rpc('photo_finals_transform_specs', {}), oldSpecs);
    }));
  } finally {
    for (const child of sessions) child.kill('SIGKILL');
    try { if (started) command('pg_ctl', ['-D', join(temp, 'data'), '-m', 'immediate', '-w', 'stop']); }
    finally { rmSync(temp, { recursive: true, force: true }); }
  }
});
