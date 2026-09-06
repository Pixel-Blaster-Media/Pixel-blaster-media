// Actual Supabase query builder -> local SQL transport -> disposable PostgreSQL.
// This proves application predicates against real row locks, not PostgREST/RLS.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadWorkflow } from '../tests/helpers/media-workflow.mjs';
const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const dir = fs.mkdtempSync(path.join(root, '.media-pg-'));
const server = net.createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise(r => server.close(r));
let sequence = 0; let started = false;
const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres'];
async function sql(text) {
  const file = path.join(dir, `${sequence++}.sql`); fs.writeFileSync(file, text);
  return (await exec('psql', [...args, '-f', file])).stdout.trim();
}
const lit = v => `'${String(v).replaceAll("'", "''")}'`;
const ident = v => { assert.match(v, /^[a-z_]+$/); return `"${v}"`; };
try {
  execFileSync('initdb', ['-D', path.join(dir, 'data'), '-A', 'trust', '-U', 'postgres', '--no-locale'], { stdio: 'ignore' });
  execFileSync('pg_ctl', ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'postgres.log'), '-o', `-F -p ${port} -k '' -h 127.0.0.1`, '-w', 'start'], { stdio: 'ignore' }); started = true;
  await sql(`create table organizations(id uuid primary key); create table properties(id uuid primary key); create table profiles(id uuid primary key); create table bookings(id uuid primary key, organization_id uuid, property_id uuid, iguide_portal_id text); create function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$; create function is_organization_admin(uuid) returns boolean language sql as $$ select true $$;`);
  await sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260611235145_autoenhance_booking_workflow.sql'), 'utf8'));
  const id = '11111111-1111-4111-8111-111111111111';
  await sql(`insert into organizations values('${id}'); insert into properties values('${id}'); insert into bookings values('${id}','${id}','${id}','tour'); insert into autoenhance_batches(id,organization_id,booking_id,property_id,order_id,order_name) values('${id}','${id}','${id}','${id}','order','order');`);
  const service = createClient('http://local.invalid', 'fixture', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (url, init) => {
    const u = new URL(url); const table = ident(u.pathname.split('/').pop());
    const predicates = [...u.searchParams].filter(([k]) => !['select','order','limit'].includes(k)).map(([k,v]) => { assert.ok(v.startsWith('eq.')); return `${ident(k)}=${lit(v.slice(3))}`; });
    const where = predicates.length ? ` where ${predicates.join(' and ')}` : '';
    const payload = init.body ? JSON.parse(init.body) : null;
    let statement = `select * from ${table}${where}`;
    if (init.method === 'PATCH') statement = `update ${table} set ${Object.keys(payload).map(k => `${ident(k)}=(json_populate_record(null::${table},${lit(JSON.stringify(payload))})).${ident(k)}`).join(',')}${where} returning *`;
    if (init.method === 'POST') statement = `insert into ${table} (${Object.keys(payload).map(ident).join(',')}) select ${Object.keys(payload).map(k => `(json_populate_record(null::${table},${lit(JSON.stringify(payload))})).${ident(k)}`).join(',')} returning *`;
    try {
      const text = init.method === 'GET' ? `select coalesce(json_agg(r),'[]') from (${statement}) r` : `with r as (${statement}) select coalesce(json_agg(r),'[]') from r`;
      const rows = JSON.parse(await sql(text));
      const single = new Headers(init.headers).get('accept')?.includes('vnd.pgrst.object');
      if (single && rows.length !== 1) return Response.json({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'No rows' }, { status: 406 });
      return Response.json(single ? rows[0] : rows);
    } catch (error) { return Response.json({ code: error.stderr?.includes('duplicate key') ? '23505' : 'SQL', message: error.stderr }, { status: 400 }); }
  } } });
  const input = { admin: { organizationId: id }, batch: { id, booking_id: id }, iguidePortalId: 'tour', imageId: 'image', filename: 'image.jpg' };
  const workflow = loadWorkflow(service);
  const claims = await Promise.all([workflow.claimIGuideUpload(input), workflow.claimIGuideUpload(input)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const token = claims.find(Boolean).token;
  for (const patch of [{ claimToken: 'stale' }, { admin: { organizationId: '22222222-2222-4222-8222-222222222222' } }, { iguidePortalId: 'other' }, { imageId: 'other' }, { batch: { id: '22222222-2222-4222-8222-222222222222' } }]) await assert.rejects(workflow.upsertIGuideUpload({ ...input, claimToken: token, status: 'uploaded', ...patch }), /fenced/);
  const receipts = await Promise.allSettled(['uploaded', 'failed'].map(status => workflow.upsertIGuideUpload({ ...input, claimToken: token, status })));
  assert.equal(receipts.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(workflow.upsertIGuideUpload({ ...input, claimToken: token, status: 'pending' }), /fenced/);
  console.log('PASS real PostgreSQL concurrent claim, receipt CAS, tenant/batch/portal/image/token/status fences');
  await sql(`update autoenhance_iguide_uploads set status='failed',warning='media:retryable:1' where autoenhance_image_id='image'; alter table autoenhance_iguide_uploads disable trigger autoenhance_iguide_uploads_set_updated_at; update autoenhance_iguide_uploads set updated_at='2020-01-01' where autoenhance_image_id='image'; alter table autoenhance_iguide_uploads enable trigger autoenhance_iguide_uploads_set_updated_at;`);
  const retries = await Promise.all([workflow.claimIGuideUpload(input), workflow.claimIGuideUpload(input)]);
  assert.equal(retries.filter(Boolean).length, 1);
  assert.equal(retries.find(Boolean).attempt, 2);
  await workflow.upsertIGuideUpload({ ...input, claimToken: retries.find(Boolean).token, status: 'pending', assetName: 'accepted', jobId: 'job' });
  const beforePoll = await service.from('autoenhance_iguide_uploads').select('*').eq('autoenhance_image_id', 'image').single();
  const pendingCheck = loadWorkflow(service, { getUploadProcessingStatus: async () => ({ ok: false }) });
  assert.equal(await pendingCheck.claimIGuideUpload(input), false);
  const afterPoll = await service.from('autoenhance_iguide_uploads').select('*').eq('autoenhance_image_id', 'image').single();
  assert.notEqual(afterPoll.data.updated_at, beforePoll.data.updated_at, 'pending poll must rotate before network wait');
  let polls = 0;
  const reconcile = loadWorkflow(service, { getUploadProcessingStatus: async () => { polls++; return { ok: true, status: 204 }; }, uploadAssetToIGuide: async () => { throw new Error('must not allocate'); } });
  const reconciled = await reconcile.pushFinishedImagesToIGuide({ ...input, batch: { ...input.batch, iguide_portal_id: 'tour', iguide_uploaded_image_ids: [] }, images: [{ imageId: 'image', imageName: 'image.jpg' }] });
  assert.equal(polls, 1);
  assert.deepEqual(reconciled.uploadedImageIds, ['image']);
  assert.deepEqual(reconciled.failedImageIds, []);
  console.log('PASS real PostgreSQL single retry winner and same-invocation reconciled aggregate');

  let release; let entered;
  const waiting = new Promise(r => { entered = r; });
  const barrier = new Promise(r => { release = r; });
  const refresher = loadWorkflow(service, { getOrder: async () => { entered(); await barrier; return {}; }, getOrderBrackets: async () => ({ brackets: [] }) });
  const stale = refresher.refreshBookingAutoenhanceBatch({ admin: input.admin, batchId: id });
  await waiting;
  const winner = await service.from('autoenhance_batches').update({ status: 'iguide_uploaded', finished_image_ids: ['winner'], iguide_uploaded_image_ids: ['winner'] }).eq('id', id).select('*').single();
  assert.ifError(winner.error); release(); await stale;
  const final = await service.from('autoenhance_batches').select('*').eq('id', id).single();
  assert.deepEqual(final.data.finished_image_ids, ['winner'], 'stale refresh must not overwrite newer aggregate');
  assert.equal(final.data.status, 'iguide_uploaded');
  console.log('PASS real PostgreSQL stale batch summary cannot overwrite concurrent winner');
} finally {
  if (started) execFileSync('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
  fs.rmSync(dir, { recursive: true, force: true });
}
