import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkflow } from './helpers/media-workflow.mjs';
export const batch = { id: 'batch', organization_id: 'tenant', booking_id: 'booking', iguide_portal_id: 'tour', iguide_uploaded_image_ids: [], iguide_failed_image_ids: [], finished_image_ids: [], updated_at: '2020-01-01T00:00:00Z' };
export const input = { admin: { organizationId: 'tenant' }, batch, iguidePortalId: 'tour' };
for (const status of ['uploaded', 'pending', 'failed']) test(`160-image batch progresses beyond 100 ${status} receipts`, async () => {
  const images = Array.from({ length: 160 }, (_, i) => ({ imageId: `image-${i}`, imageName: `${i}.jpg` }));
  const receipts = images.slice(0, 100).map(i => ({ autoenhance_image_id: i.imageId, status, warning: null }));
  const sent = [];
  const service = { from() {
    let payload; let operation; const filters = {};
    const q = { select() { return q; }, order() { return q; }, eq(k,v) { filters[k]=v; return q; },
      insert(p) { operation='insert'; payload=p; return q; }, update(p) { operation='update'; payload=p; return q; },
      async returns() { return { data: receipts }; },
      async maybeSingle() {
        const row = receipts.find(r => r.autoenhance_image_id === (payload?.autoenhance_image_id ?? filters.autoenhance_image_id));
        if (operation === 'insert') { if (row) return { error: { code: '23505' } }; receipts.push({ ...payload }); return { data: { id: 'new' } }; }
        if (operation === 'update') { Object.assign(row, payload); return { data: { id: 'new' } }; }
        return { data: row };
      },
    }; return q;
  } };
  const workflow = loadWorkflow(service, { fetchEnhancedImage: async () => new Response('fixture'), uploadAssetToIGuide: async p => { sent.push(p.filename); await p.checkpoint({ phase: 'allocating' }); return { ok: true, outcome: 'completed', data: { assetName: 'asset', jid: 'job', processComplete: true } }; } });
  const result = await workflow.pushFinishedImagesToIGuide({ ...input, images });
  assert.equal(sent.length, 1);
  assert.ok(result.uploadedImageIds.includes('image-100'));
});

test('eligible safe retry precedes accepted pending polls in a large batch', async () => {
  const images = Array.from({ length: 160 }, (_, i) => ({ imageId: `image-${i}`, imageName: `${i}.jpg` }));
  const receipts = images.map((i,n) => ({ autoenhance_image_id: i.imageId, status: n === 159 ? 'failed' : 'pending', warning: n === 159 ? 'media:retryable:1' : 'media:claim:old', updated_at: '2020-01-01T00:00:00Z', iguide_asset_name: 'asset', iguide_job_id: 'job' }));
  let polled = 0; let sent = 0;
  const service = { from() {
    let op; let payload; const filters = {};
    const q = { select() { return q; }, order() { return q; }, eq(k,v) { filters[k]=v; return q; },
      insert(p) { op='insert'; payload=p; return q; }, update(p) { op='update'; payload=p; return q; },
      async returns() { return { data: receipts }; },
      async maybeSingle() {
        if (op === 'insert') return { error: { code: '23505' } };
        if (op === 'update') return { data: { id: 'receipt' } };
        return { data: receipts.find(r => r.autoenhance_image_id === filters.autoenhance_image_id) };
      },
    }; return q;
  } };
  const workflow = loadWorkflow(service, { getUploadProcessingStatus: async () => { polled++; return { ok: false }; }, fetchEnhancedImage: async () => new Response('fixture'), uploadAssetToIGuide: async () => { sent++; assert.equal(polled, 0); return { ok: true, outcome: 'completed', data: { assetName: 'asset', jid: 'job' } }; } });
  await workflow.pushFinishedImagesToIGuide({ ...input, images });
  assert.equal(sent, 1); assert.equal(polled, 0);
});
