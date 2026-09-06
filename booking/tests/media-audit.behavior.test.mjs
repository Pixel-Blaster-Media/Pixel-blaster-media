import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
function load(file, mocks = {}) {
  const filename = path.resolve(root, file);
  const source = fs.readFileSync(filename, 'utf8') + (file === 'lib/integrations/autoenhance/workflow.ts' ? '\nexport { claimIGuideUpload, pushFinishedImagesToIGuide };' : file === 'app/api/iguide/download/route.ts' ? '\nexport { fetchIGuideDownload };' : '');
  const text = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', text)((id) => {
    if (id === 'server-only') return {};
    if (id in mocks) return mocks[id];
    if (id.startsWith('@/')) return load(id.slice(2) + '.ts', mocks);
    if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), id)) + '.ts', mocks);
    return require(id);
  }, mod, mod.exports);
  return mod.exports;
}
function workflowHarness(existing, portal = {}) {
  let updates = 0;
  const service = { from() {
    let operation;
    const q = { insert() { operation = 'insert'; return q; }, update() { updates++; operation = 'update'; return q; },
      select() { return q; }, eq() { return q; },
      async maybeSingle() { return operation === 'insert' ? { error: { code: '23505' } } : { data: operation === 'update' ? { id: 'receipt' } : existing }; } };
    return q;
  } };
  const workflow = load('lib/integrations/autoenhance/workflow.ts', {
    '@/lib/supabase/server': { getServiceSupabase: () => service },
    '@/lib/integrations/autoenhance/client': {},
    '@/lib/integrations/iguide/portal-client': portal,
    '@/lib/integrations/provider-enablement': {},
  });
  return { workflow, updates: () => updates };
}
const claimInput = { admin: { organizationId: 'tenant' }, batch: { id: 'batch', booking_id: 'booking' }, iguidePortalId: 'tour', imageId: 'image', filename: 'image.jpg' };
test('accepted processing receipt is reconciled read-only, never reallocated', async () => {
  let checked = 0;
  const h = workflowHarness({ id: 'receipt', status: 'pending', updated_at: '2020-01-01T00:00:00Z', warning: 'media:claim:fixture', iguide_asset_name: 'asset-1', iguide_job_id: 'job-1' }, {
    getUploadProcessingStatus: async (tour, asset, scope) => { assert.equal(tour, 'tour'); assert.equal(asset, 'asset-1'); assert.equal(scope.organizationId, 'tenant'); checked++; return { ok: true, status: 204 }; },
  });
  assert.equal(await h.workflow.claimIGuideUpload(claimInput), false);
  assert.equal(checked, 1); assert.equal(h.updates(), 2);
});
for (const status of ['pending', 'failed']) test(`historical ${status} cannot be replayed without affirmative safe-retry evidence`, async () => {
  const h = workflowHarness({ id: 'receipt', status, updated_at: '2020-01-01T00:00:00Z', warning: null });
  assert.ok(!(await h.workflow.claimIGuideUpload(claimInput)));
  assert.equal(h.updates(), 0);
});
test('workflow fences before permit and retains accepted identity when final receipt fails', async () => {
  const writes = []; let stored = {}; let effects = 0;
  const service = { from() {
    let op; let payload;
    const q = { select() { return q; }, eq() { return q; }, order() { return q; },
      insert(p) { op = 'insert'; payload = p; return q; }, update(p) { op = 'update'; payload = p; return q; }, upsert(p) { op = 'update'; payload = p; return q; },
      async returns() { return { data: [] }; },
      then(resolve) { return q.maybeSingle().then(resolve); },
      async maybeSingle() { writes.push(payload); if (payload?.status === 'uploaded') return { error: { message: 'receipt down' } }; stored = { ...stored, ...payload }; return { data: { id: 'receipt' } }; } };
    return q;
  } };
  const workflow = load('lib/integrations/autoenhance/workflow.ts', {
    '@/lib/supabase/server': { getServiceSupabase: () => service },
    '@/lib/integrations/provider-enablement': {},
    '@/lib/integrations/autoenhance/client': { fetchEnhancedImage: async () => new Response(jpeg), AutoenhanceError: class extends Error {} },
    '@/lib/integrations/iguide/portal-client': { uploadAssetToIGuide: async (input) => {
      assert.equal(typeof input.checkpoint, 'function');
      await input.checkpoint({ phase: 'allocating' }); effects++;
      await input.checkpoint({ phase: 'accepted', assetName: 'asset-1' });
      await input.checkpoint({ phase: 'processing', assetName: 'asset-1', jid: 'job-1' });
      return { ok: true, outcome: 'completed', data: { assetName: 'asset-1', jid: 'job-1', processComplete: true } };
    } },
  });
  await workflow.pushFinishedImagesToIGuide({ ...claimInput, batch: { ...claimInput.batch, iguide_uploaded_image_ids: [] }, images: [{ imageId: 'image', imageName: 'image.jpg' }] });
  assert.equal(effects, 1);
  assert.equal(stored.iguide_asset_name, 'asset-1');
  assert.equal(stored.iguide_job_id, 'job-1');
  assert.equal(stored.status, 'pending');
  assert.ok(!writes.some(w => w?.status === 'failed'));
});
test('iGUIDE download rejects HTML disguised as a PDF and disables automatic redirects', async () => {
  const route = load('app/api/iguide/download/route.ts', {
    '@/lib/auth/require-user': {}, '@/lib/supabase/server': {}, '@/lib/integrations/iguide/portal-client': {},
    'next/server': { NextResponse: Response },
  });
  const original = globalThis.fetch; let init;
  globalThis.fetch = async (_, options) => { init = options; return new Response('<html>error</html>', { headers: { 'content-type': 'application/pdf' } }); };
  try { const response = await route.fetchIGuideDownload(new URL('https://youriguide.com/tour/doc/test.pdf')); assert.equal(response.status, 502); assert.equal(init.redirect, 'manual'); }
  finally { globalThis.fetch = original; }
});
test('recovery selects attention, caps adapter overflow, and rejects invalid limits', async () => {
  const selected = []; let checks = 0; let rotations = 0;
  const q = { select() { return q; }, in(_, statuses) { selected.push(...statuses); return q; }, order() { return q; }, limit(n) { assert.equal(n, 1); return q; },
    update(p) { assert.equal(p.id, '0'); rotations++; return q; }, eq() { return q; },
    async maybeSingle() { return { data: { id: '0' } }; },
    async returns() { return { data: Array.from({ length: 3 }, (_, n) => ({ id: String(n), organization_id: 'tenant', updated_at: '2020-01-01T00:00:00Z' })) }; } };
  // A disabled oldest tenant must not monopolize every scheduler invocation.
  test.after(() => assert.equal(rotations, 1));
  const workflow = load('lib/integrations/autoenhance/workflow.ts', {
    '@/lib/supabase/server': { getServiceSupabase: () => ({ from: () => q }) },
    '@/lib/integrations/autoenhance/client': {}, '@/lib/integrations/iguide/portal-client': {},
    '@/lib/integrations/provider-enablement': { isPhotoEditingProviderEnabled: async () => { checks++; return false; } },
  });
  await assert.rejects(workflow.syncPendingAutoenhanceBatches({ limit: 0 }), /limit/i);
  await workflow.syncPendingAutoenhanceBatches({ limit: 99 });
  assert.ok(selected.includes('attention')); assert.equal(checks, 1);
});
for (const phase of ['allocating', 'accepted', 'processing']) test(`checkpoint failure at ${phase} stops the next external effect`, async () => {
  const h = portalHarness({ checkpointFailure: phase });
  try {
    if (phase === 'allocating') await assert.rejects(h.client.uploadAssetToIGuide(h.input, { organizationId: 'tenant' }));
    else { const result = await h.client.uploadAssetToIGuide(h.input, { organizationId: 'tenant' }); assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.data.assetName, 'asset-1'); }
    assert.equal(h.events.includes(phase === 'allocating' ? 'permit' : phase === 'accepted' ? 'put' : 'wait'), false);
  } finally { h.restore(); }
});
for (const [warning, age, expected] of [['media:retryable:1', 16, 2], ['media:retryable:2', 16, 3], ['media:retryable:3', 16, false], ['media:retryable:1', 1, false]]) test(`safe retry ${warning} at ${age} minutes is bounded`, async () => {
  const h = workflowHarness({ id: 'receipt', status: 'failed', warning, updated_at: new Date(Date.now() - age * 60000).toISOString() });
  const result = await h.workflow.claimIGuideUpload(claimInput);
  assert.equal(result && result.attempt, expected);
});
test('body timeout cancels a stalled stream; empty, encoding and declared size fail closed', async () => {
  const { readProviderBytes } = load('lib/integrations/iguide/bounded-media.ts');
  const controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({ pull() {}, cancel() { cancelled = true; } }));
  const pending = readProviderBytes(response, { maxBytes: 100, signal: controller.signal });
  controller.abort(); await assert.rejects(pending, /deadline/i); assert.equal(cancelled, true);
  for (const r of [new Response(''), new Response('a', { headers: { 'content-length': '1000' } }), new Response('a', { headers: { 'content-encoding': 'gzip' } })]) {
    await assert.rejects(readProviderBytes(r, { maxBytes: 100, signal: new AbortController().signal }));
  }
});
test('lost wait response body retains accepted asset and job', async () => {
  const h = portalHarness(); const fetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).endsWith('/waitForProcess') ? new Response(new ReadableStream({ start(c) { c.error(new Error('broken body')); } })) : fetch(url, init);
  try { const result = await h.client.uploadAssetToIGuide(h.input, { organizationId: 'tenant' }); assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.data.jid, 'job-1'); }
  finally { h.restore(); }
});
test('an enclosing media deadline aborts later stages instead of resetting the budget', async () => {
  const { withMediaDeadline, mediaSignal } = load('lib/integrations/iguide/bounded-media.ts');
  await withMediaDeadline(5, async () => {
    const first = mediaSignal(1000);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(first.aborted, true);
    assert.throws(() => mediaSignal(1000), /abort|timeout/i);
  });
});
// A complete 1x1 JPEG; no live paid provider requests.
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==', 'base64');
function portalHarness({ waitStatus = 503, checkpointFailure, permitStatus = 200 } = {}) {
  const events = [];
  const client = load('lib/integrations/iguide/portal-client.ts', {
    '@/lib/integrations/credentials': { getCredential: async () => 'fixture' },
    '@aws-sdk/client-s3': { S3Client: class { async send() { events.push('put'); } destroy() {} }, PutObjectCommand: class {} },
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/assets')) { events.push('permit'); return Response.json({ name: 'asset-1', uploadToken: 'secret', uploadPermit: { region: 'ca-central-1' } }, { status: permitStatus }); }
    if (String(url).includes('/process?')) { events.push('process'); return Response.json({ jid: 'job-1' }); }
    events.push('wait'); return waitStatus === 204 ? new Response(null, { status: 204 }) : Response.json({}, { status: waitStatus });
  };
  const input = { iguideId: 'tour-1', filename: 'photo.jpg', bytes: Uint8Array.from(jpeg).buffer, contentType: 'image/jpeg', waitForProcess: true,
    checkpoint: async (receipt) => { events.push(receipt.phase); if (receipt.phase === checkpointFailure) throw new Error('receipt unavailable'); },
  };
  return { client, events, input, restore: () => { globalThis.fetch = original; } };
}
test('nonterminal 200 wait never reports a completed upload', async () => {
  const h = portalHarness({ waitStatus: 200 });
  try {
    const result = await h.client.uploadAssetToIGuide(h.input, { organizationId: 'tenant' });
    assert.notEqual(result.outcome, 'completed');
    assert.notEqual(result.data?.processComplete, true);
  } finally { h.restore(); }
});

test('enhanced image rejects disguised HTML before a handoff can consume it', async () => {
  const client = load('lib/integrations/autoenhance/client.ts', {
    '@/lib/integrations/provider-enablement': { requirePhotoEditingProviderEnabled: async () => {} },
    '@/lib/integrations/credentials': { getCredential: async () => 'fixture' },
  });
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>not a photo</html>', { headers: { 'content-type': 'image/jpeg' } });
  try { await assert.rejects(client.fetchEnhancedImage('image-1', { organizationId: 'tenant' }), /media|signature/i); }
  finally { globalThis.fetch = original; }
});

test('bounded provider bodies reject unknown-length overflow and cancel transport', async () => {
  const { readProviderBytes } = load('lib/integrations/iguide/bounded-media.ts');
  let cancelled = false;
  const response = new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } }));
  await assert.rejects(readProviderBytes(response, { maxBytes: 12, signal: AbortSignal.timeout(1000) }), /size/i);
  assert.equal(cancelled, true);
});

test('accepted asset/job are checkpointed before wait; wait failure retains identities', async () => {
  const h = portalHarness();
  try {
    const result = await h.client.uploadAssetToIGuide(h.input, { organizationId: 'tenant' });
    assert.equal(result.data?.assetName, 'asset-1');
    assert.equal(result.data?.jid, 'job-1');
    assert.equal(result.outcome, 'reconciliation_required');
    assert.deepEqual(h.events, ['allocating', 'permit', 'accepted', 'put', 'process', 'processing', 'wait']);
  } finally { h.restore(); }
});
