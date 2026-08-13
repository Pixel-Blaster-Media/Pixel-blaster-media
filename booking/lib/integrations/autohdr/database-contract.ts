import type { AutoHDRNormalizedStatus } from "./contract.ts";
import type { AutoHDRJobState } from "./workflow-core.ts";

type Scope = {
  organizationId: string;
  bookingId: string;
  propertyId: string;
};

export type AutoHDRClaimFile = Readonly<{
  position: number;
  sourceMediaVersionId: string;
  filename: string;
}>;

export type AutoHDRSourceManifestEntry = Readonly<{
  position: number;
  filename: string;
  byteSize: number;
  lastModified: number;
  contentType: "image/jpeg" | "image/png";
  sha256: string;
}>;

export type AutoHDRCanonicalSource = AutoHDRSourceManifestEntry & Readonly<{
  mediaBatchId: string;
  mediaAssetId: string;
  sourceMediaVersionId: string;
  ingestJobId: string;
  quarantineObjectKey: string;
  objectKey: string;
  ingestState: "discovered" | "accepted";
  quarantineEtag: string | null;
}>;

function bytea(hex: string): string {
  return `\\x${hex}`;
}

function sourceFile(file: AutoHDRSourceManifestEntry) {
  return {
    filename: file.filename,
    byte_size: file.byteSize,
    mime_type: file.contentType,
    sha256: file.sha256,
  };
}

export const AUTOHDR_DATABASE_CONTRACT = Object.freeze({
  jobsTable: "autohdr_jobs",
  rpc: Object.freeze({
    prepareSourceUpload: "prepare_autohdr_source_batch",
    acceptSourceUpload: "accept_autohdr_source_version",
    claim: "claim_autohdr_job",
    list: "list_autohdr_jobs",
    transition: "transition_autohdr_job",
    activateProviderJob: "activate_autohdr_provider_job",
    reconcileProviderJob: "reconcile_autohdr_provider_job",
    abandonProviderJob: "abandon_autohdr_provider_job",
    claimRetrieval: "claim_autohdr_retrieval",
  }),
  args: Object.freeze({
    prepareSourceUpload(input: Scope & {
      requestId: string;
      createdBy: string;
      files: AutoHDRSourceManifestEntry[];
    }) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_request_id: input.requestId,
        p_created_by: input.createdBy,
        p_files: input.files.map(sourceFile),
      };
    },
    acceptSourceUpload(input: Scope & AutoHDRCanonicalSource & {
      quarantineEtag: string;
      verifiedWidthPx: number;
      verifiedHeightPx: number;
    }) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_batch_id: input.mediaBatchId,
        p_asset_id: input.mediaAssetId,
        p_version_id: input.sourceMediaVersionId,
        p_ingest_job_id: input.ingestJobId,
        p_bucket_name: "pixel-blaster-private-media",
        p_quarantine_object_key: input.quarantineObjectKey,
        p_quarantine_etag: input.quarantineEtag,
        p_object_key: input.objectKey,
        p_sha256: bytea(input.sha256),
        p_byte_size: input.byteSize,
        p_mime_type: input.contentType,
        p_verified_width_px: input.verifiedWidthPx,
        p_verified_height_px: input.verifiedHeightPx,
      };
    },
    claim(input: Scope & {
      idempotencyKey: string;
      manifestSha256: string;
      files: AutoHDRClaimFile[];
    }) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_property_id: input.propertyId,
        p_idempotency_key: input.idempotencyKey,
        p_manifest_sha256: bytea(input.manifestSha256),
        p_files: input.files.map((file) => ({
          position: file.position,
          source_media_version_id: file.sourceMediaVersionId,
          filename: file.filename,
        })),
      };
    },
    transition(input: Scope & {
      jobId: string;
      expectedState: AutoHDRJobState;
      newState: AutoHDRJobState;
      providerStatus?: AutoHDRNormalizedStatus | null;
      errorCode?: string | null;
      retrievalClaimToken?: string | null;
    }) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_property_id: input.propertyId,
        p_job_id: input.jobId,
        p_expected_state: input.expectedState,
        p_new_state: input.newState,
        p_provider_status: input.providerStatus ?? null,
        p_error_code: input.errorCode ?? null,
        p_retrieval_claim_token: input.retrievalClaimToken ?? null,
      };
    },
    activateProviderJob(input: Scope & {
      jobId: string;
      providerUid: string;
    }) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_property_id: input.propertyId,
        p_job_id: input.jobId,
        p_provider_uid: input.providerUid,
      };
    },
    reconcileProviderJob(input: Scope & {
      jobId: string;
      expectedState: "preparing" | "awaiting_upload" | "finalizing";
      errorCode: string;
      errorEvidence: string;
      providerUid?: string | null;
    }) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_property_id: input.propertyId,
        p_job_id: input.jobId,
        p_expected_state: input.expectedState,
        p_error_code: input.errorCode,
        p_error_evidence: input.errorEvidence,
        p_provider_uid: input.providerUid ?? null,
      };
    },
    abandonProviderJob(input: Scope & { jobId: string; adminUserId: string; reason: string }) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_property_id: input.propertyId,
        p_job_id: input.jobId,
        p_admin_user_id: input.adminUserId,
        p_reason: input.reason,
      };
    },
    claimRetrieval(input: Scope & { jobId: string }) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_property_id: input.propertyId,
        p_job_id: input.jobId,
      };
    },
  }),
});
