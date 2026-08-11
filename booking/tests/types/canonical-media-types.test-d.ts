import type { Database } from "../../lib/supabase/database.types";

type MediaBatchInsert = Database["public"]["Tables"]["media_batches"]["Insert"];
type MediaPackageInsert = Database["public"]["Tables"]["media_packages"]["Insert"];
type DownloadGrantInsert = Database["public"]["Tables"]["download_grants"]["Insert"];

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
void missingBatchIdentity;
void missingPackageManifest;
void missingGrantDigest;
