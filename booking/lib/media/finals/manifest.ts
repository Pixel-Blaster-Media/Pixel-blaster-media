import { createHash } from 'node:crypto';
import type { Database } from '../../supabase/database.types.ts';
import { buildMasterKey } from '../storage/keys.ts';
import type { PhotoFinalsScope } from './config.ts';

// A projection of canonical rows, NOT a second persistence model or acceptance API.
type Version = Pick<Database['public']['Tables']['media_versions']['Row'],
  'id' | 'asset_id' | 'organization_id' | 'property_id' | 'batch_id' | 'version_number'
  | 'ingest_state' | 'object_tier' | 'bucket_name' | 'object_key' | 'sha256' | 'byte_size'
  | 'mime_type' | 'width_px' | 'height_px' | 'accepted_at' | 'rights_effective_at'
  | 'rights_expires_at' | 'edit_class' | 'disclosure_class'>;
type Batch = Pick<Database['public']['Tables']['media_batches']['Row'],
  'id' | 'organization_id' | 'booking_id' | 'property_id'>;

export const PHOTO_FINALS_LIMITS = Object.freeze({ files: 100, fileBytes: 33_554_432, sidePixels: 16_384, pixels: 100_000_000, totalBytes: 1_073_741_824 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EDITS = new Set(['original', 'corrective', 'hdr', 'virtual_staging', 'generative']);
const DISCLOSURES = new Set(['none', 'virtually_staged', 'material_edit']);

function requireTrue(condition: unknown): asserts condition {
  if (condition !== true) throw new Error('Invalid finished-JPEG selection evidence');
}
function positive(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}
function timestamp(value: unknown): number {
  requireTrue(typeof value === 'string' && value.length <= 64);
  const time = Date.parse(value);
  requireTrue(Number.isFinite(time));
  return time;
}

/** Pure draft fingerprint. Caller must authorize then reload these rows INSIDE
 * the future approval transaction. This does not verify bytes, approve a release,
 * enqueue jobs, issue URLs, or prove derivative/package readiness. Keep private:
 * manifests contain storage identities and are not browser DTOs.
 * Canonical hash is SHA256(UTF8(canonicalJson)), not PostgreSQL jsonb::text.
 */
export function preparePhotoFinalsManifest(input: {
  scope: PhotoFinalsScope & { batchId: string; releaseId: string; revisionNumber: number };
  batch: Batch;
  selectedVersionIds: readonly string[];
  versions: readonly Version[];
  now: number;
}) {
  const { scope, batch, selectedVersionIds, versions, now } = input;
  for (const id of [scope.organizationId, scope.bookingId, scope.propertyId, scope.batchId, scope.releaseId]) {
    requireTrue(typeof id === 'string' && UUID.test(id));
  }
  requireTrue(positive(scope.revisionNumber, 2_147_483_647) && Number.isFinite(now));
  requireTrue(batch.id === scope.batchId && batch.organization_id === scope.organizationId
    && batch.booking_id === scope.bookingId && batch.property_id === scope.propertyId);
  requireTrue(Array.isArray(selectedVersionIds) && positive(selectedVersionIds.length, PHOTO_FINALS_LIMITS.files));
  requireTrue(Array.isArray(versions) && versions.length === selectedVersionIds.length);
  requireTrue(selectedVersionIds.every((id) => typeof id === 'string' && UUID.test(id)));
  requireTrue(new Set(selectedVersionIds).size === selectedVersionIds.length);
  const byId = new Map(versions.map((row) => [row.id, row]));
  requireTrue(byId.size === versions.length);
  const assets = new Set<string>();
  let totalBytes = 0;
  const items = selectedVersionIds.map((id, position) => {
    const row = byId.get(id);
    requireTrue(row !== undefined);
    requireTrue(row.organization_id === scope.organizationId && row.property_id === scope.propertyId && row.batch_id === scope.batchId);
    requireTrue(typeof row.asset_id === 'string' && UUID.test(row.asset_id) && !assets.has(row.asset_id));
    assets.add(row.asset_id);
    requireTrue(positive(row.version_number, 2_147_483_647));
    requireTrue(['accepted', 'deriving', 'review_pending'].includes(row.ingest_state) && row.object_tier === 'master');
    requireTrue(row.mime_type === 'image/jpeg');
    requireTrue(positive(row.byte_size, PHOTO_FINALS_LIMITS.fileBytes));
    requireTrue(positive(row.width_px, PHOTO_FINALS_LIMITS.sidePixels) && positive(row.height_px, PHOTO_FINALS_LIMITS.sidePixels));
    requireTrue(row.width_px * row.height_px <= PHOTO_FINALS_LIMITS.pixels);
    requireTrue(typeof row.bucket_name === 'string' && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(row.bucket_name));
    requireTrue(typeof row.sha256 === 'string' && /^\\x[0-9a-f]{64}$/.test(row.sha256));
    const digest = row.sha256.slice(2);
    requireTrue(row.object_key === buildMasterKey(scope.organizationId, row.asset_id, id, digest, 'jpg'));
    requireTrue(timestamp(row.accepted_at) <= now);
    if (row.rights_effective_at !== null) requireTrue(timestamp(row.rights_effective_at) <= now);
    if (row.rights_expires_at !== null) requireTrue(timestamp(row.rights_expires_at) > now);
    requireTrue(EDITS.has(row.edit_class) && DISCLOSURES.has(row.disclosure_class));
    totalBytes += row.byte_size;
    requireTrue(totalBytes <= PHOTO_FINALS_LIMITS.totalBytes);
    return Object.freeze({
      position, media_version_id: id, asset_id: row.asset_id, version_number: row.version_number,
      display_filename: `${String(position + 1).padStart(3, '0')}.jpg`,
      bucket_name: row.bucket_name, object_key: row.object_key, sha256: digest,
      byte_size: row.byte_size, mime_type: row.mime_type, width_px: row.width_px, height_px: row.height_px,
      edit_class: row.edit_class, disclosure_class: row.disclosure_class,
      rights_effective_at: row.rights_effective_at, rights_expires_at: row.rights_expires_at,
    });
  });
  const manifest = Object.freeze({
    manifest_version: 1, kind: 'finished_jpeg_selection.v1',
    organization_id: scope.organizationId, booking_id: scope.bookingId, property_id: scope.propertyId,
    batch_id: scope.batchId, release_id: scope.releaseId, revision_number: scope.revisionNumber,
    items: Object.freeze(items),
  });
  const canonicalJson = JSON.stringify(manifest);
  return Object.freeze({ manifest, canonicalJson, sha256: createHash('sha256').update(canonicalJson, 'utf8').digest('hex') });
}
