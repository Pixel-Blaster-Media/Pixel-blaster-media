import type { Database } from "../../lib/supabase/database.types";

type MediaBatchInsert = Database["public"]["Tables"]["media_batches"]["Insert"];
type MediaPackageInsert = Database["public"]["Tables"]["media_packages"]["Insert"];
type DownloadGrantInsert = Database["public"]["Tables"]["download_grants"]["Insert"];
type SourceBatchArgs = Database["public"]["Functions"]["prepare_autohdr_source_batch"]["Args"];
type SourceAcceptArgs = Database["public"]["Functions"]["accept_autohdr_source_version"]["Args"];

// @ts-expect-error Canonical media batches require every tenant and provider identity.
const missingBatchIdentity: MediaBatchInsert = {};

const validBatch: MediaBatchInsert = {
  organization_id: "organization-id",
  property_id: "property-id",
  booking_id: "booking-id",
  source_provider: "provider",
  provider_connection_key: "connection",
  provider_job_id: "job",
};

const validSourceBatchArgs: SourceBatchArgs = {
  p_organization_id: "organization-id",
  p_booking_id: "booking-id",
  p_request_id: "request-id",
  p_created_by: "admin-id",
  p_files: [],
};

const validSourceAcceptArgs: SourceAcceptArgs = {
  p_organization_id: "organization-id",
  p_booking_id: "booking-id",
  p_batch_id: "batch-id",
  p_asset_id: "asset-id",
  p_version_id: "version-id",
  p_ingest_job_id: "ingest-job-id",
  p_bucket_name: "bucket",
  p_object_key: "object-key",
  p_sha256: "sha256",
  p_byte_size: 1,
  p_mime_type: "image/jpeg",
  p_verified_width_px: 1,
  p_verified_height_px: 1,
};

// @ts-expect-error Acceptance requires the complete canonical version and HEAD identity.
const missingSourceHeadIdentity: SourceAcceptArgs = {
  p_organization_id: "organization-id",
  p_booking_id: "booking-id",
};

// @ts-expect-error Packages cannot omit the release manifest identity.
const missingPackageManifest: MediaPackageInsert = {
  organization_id: "organization-id",
  property_id: "property-id",
  batch_id: "batch-id",
  release_id: "release-id",
  package_type: "mls_zip",
};

// @ts-expect-error Download grants cannot omit the keyed capability digest.
const missingGrantDigest: DownloadGrantInsert = {
  organization_id: "organization-id",
  property_id: "property-id",
  batch_id: "batch-id",
  release_id: "release-id",
  package_id: "package-id",
  expires_at: new Date().toISOString(),
};

void validBatch;
void validSourceBatchArgs;
void validSourceAcceptArgs;
void missingSourceHeadIdentity;
void missingBatchIdentity;
void missingPackageManifest;
void missingGrantDigest;
