import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { buildMasterKey } from '../lib/media/storage/keys.ts';

const moduleUrl = new URL('../lib/media/finals/manifest.ts', import.meta.url);
const uuid = (n) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const scope = { organizationId: uuid(1), bookingId: uuid(2), propertyId: uuid(3), batchId: uuid(4), releaseId: uuid(5), revisionNumber: 1 };
const batch = { id: scope.batchId, organization_id: scope.organizationId, booking_id: scope.bookingId, property_id: scope.propertyId };
const now = Date.parse('2026-09-12T12:00:00Z');
function version(n = 10) {
  const digest = createHash('sha256').update(`synthetic-evidence-${n}`).digest('hex');
  return { id: uuid(n), asset_id: uuid(n + 100), organization_id: scope.organizationId, property_id: scope.propertyId, batch_id: scope.batchId,
    version_number: 1, ingest_state: 'accepted', object_tier: 'master', bucket_name: 'isolated-synthetic-test-only',
    sha256: `\\x${digest}`, byte_size: 1024, mime_type: 'image/jpeg', width_px: 100, height_px: 100,
    object_key: buildMasterKey(scope.organizationId, uuid(n + 100), uuid(n), digest, 'jpg'),
    accepted_at: '2026-09-12T11:00:00Z', rights_effective_at: null, rights_expires_at: null,
    edit_class: 'corrective', disclosure_class: 'none' };
}
function input(rows = [version(), version(11)]) {
  return { scope, batch, selectedVersionIds: rows.map((r) => r.id), versions: rows, now };
}

test('selection manifest snapshots ordered canonical JPEG identities without granting approval', async () => {
  const { preparePhotoFinalsManifest } = await import(moduleUrl);
  const request = input();
  const result = preparePhotoFinalsManifest(request);
  assert.equal(result.sha256, createHash('sha256').update(result.canonicalJson).digest('hex'));
  assert.deepEqual(JSON.parse(result.canonicalJson), result.manifest);
  assert.deepEqual(result.manifest.items.map((i) => i.media_version_id), request.selectedVersionIds);
  assert.deepEqual(result.manifest.items.map((i) => i.display_filename), ['001.jpg', '002.jpg']);
  assert.equal(result.manifest.items[0].sha256, request.versions[0].sha256.slice(2));
  assert.equal('approved_at' in result.manifest, false);
  assert.equal('url' in result.manifest.items[0], false);
  assert.equal(Object.isFrozen(result.manifest.items[0]), true);
  request.versions[0].byte_size = 2000;
  assert.equal(result.manifest.items[0].byte_size, 1024);
  const reordered = input();
  reordered.selectedVersionIds.reverse();
  assert.notEqual(preparePhotoFinalsManifest(reordered).sha256, result.sha256);
  const shuffledRead = input();
  shuffledRead.versions.reverse();
  assert.equal(preparePhotoFinalsManifest(shuffledRead).sha256, result.sha256);
});

test('manifest rejects wrong scope, missing/duplicate identities and unaccepted evidence', async () => {
  const { preparePhotoFinalsManifest } = await import(moduleUrl);
  const bad = (mutate) => { const request = input(); mutate(request); assert.throws(() => preparePhotoFinalsManifest(request)); };
  for (const field of ['organization_id', 'property_id', 'batch_id', 'asset_id', 'id']) {
    bad((r) => { r.versions[0][field] = uuid(999); });
  }
  for (const field of ['organization_id', 'property_id', 'booking_id', 'id']) {
    bad((r) => { r.batch = { ...batch, [field]: uuid(999) }; });
  }
  bad((r) => { r.selectedVersionIds = []; });
  bad((r) => { r.selectedVersionIds = [uuid(10), uuid(10)]; });
  bad((r) => { r.versions.push(r.versions[0]); });
  bad((r) => { r.versions.pop(); });
  bad((r) => { r.versions[0].ingest_state = 'reconciliation_required'; });
  for (const field of ['accepted_at', 'object_key', 'sha256', 'byte_size', 'width_px', 'height_px', 'bucket_name']) {
    bad((r) => { r.versions[0][field] = null; });
  }
  for (const change of [
    { mime_type: 'image/png' }, { byte_size: 33554433 }, { width_px: 1000000 }, { byte_size: NaN },
    { width_px: 0 }, { width_px: 1.5 }, { object_tier: 'quarantine' }, { sha256: `\\x${'z'.repeat(64)}` },
    { rights_expires_at: '2026-09-12T12:00:00Z' }, { rights_effective_at: '2026-09-13T00:00:00Z' },
    { rights_expires_at: 'not-a-date' }, { accepted_at: '2026-09-13T00:00:00Z' },
    { edit_class: 'unknown' }, { disclosure_class: 'unknown' },
  ]) bad((r) => Object.assign(r.versions[0], change));
  bad((r) => { r.now = NaN; });
  bad((r) => { r.scope = { ...scope, revisionNumber: 0 }; });
  bad((r) => { r.versions[1].asset_id = r.versions[0].asset_id; });
  bad((r) => { r.selectedVersionIds = Array.from({ length: 101 }, (_, i) => uuid(i + 10)); });
});
