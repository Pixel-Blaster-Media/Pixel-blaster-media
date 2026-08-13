import assert from "node:assert/strict";
import test from "node:test";

import { AUTOHDR_DATABASE_CONTRACT } from "../lib/integrations/autohdr/database-contract.ts";

const scope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  bookingId: "22222222-2222-4222-8222-222222222222",
  propertyId: "33333333-3333-4333-8333-333333333333",
};
const jobId = "44444444-4444-4444-8444-444444444444";
const sourceMediaVersionId = "55555555-5555-4555-8555-555555555555";

test("claim arguments exactly match final migration 20260813013349", () => {
  assert.deepEqual(AUTOHDR_DATABASE_CONTRACT.args.claim({
    ...scope,
    idempotencyKey: "autohdr:booking:digest",
    manifestSha256: "ab".repeat(32),
    files: [{ position: 0, sourceMediaVersionId, filename: "Kitchen.jpg" }],
  }), {
    p_organization_id: scope.organizationId,
    p_booking_id: scope.bookingId,
    p_property_id: scope.propertyId,
    p_idempotency_key: "autohdr:booking:digest",
    p_manifest_sha256: `\\x${"ab".repeat(32)}`,
    p_files: [{
      position: 0,
      source_media_version_id: sourceMediaVersionId,
      filename: "Kitchen.jpg",
    }],
  });
});

test("state, provider recovery, and retrieval arguments exactly match additive RPCs", () => {
  assert.deepEqual(AUTOHDR_DATABASE_CONTRACT.args.transition({
    ...scope,
    jobId,
    expectedState: "preparing",
    newState: "awaiting_upload",
    providerStatus: "uploading",
  }), {
    p_organization_id: scope.organizationId,
    p_booking_id: scope.bookingId,
    p_property_id: scope.propertyId,
    p_job_id: jobId,
    p_expected_state: "preparing",
    p_new_state: "awaiting_upload",
    p_provider_status: "uploading",
    p_error_code: null,
    p_retrieval_claim_token: null,
  });
  assert.deepEqual(AUTOHDR_DATABASE_CONTRACT.args.activateProviderJob({
    ...scope,
    jobId,
    providerUid: "shoot_7",
  }), {
    p_organization_id: scope.organizationId,
    p_booking_id: scope.bookingId,
    p_property_id: scope.propertyId,
    p_job_id: jobId,
    p_provider_uid: "shoot_7",
  });
  assert.deepEqual(AUTOHDR_DATABASE_CONTRACT.args.reconcileProviderJob({
    ...scope,
    jobId,
    expectedState: "awaiting_upload",
    errorCode: "upload_capability_lost",
    errorEvidence: "Browser upload capability expired.",
  }), {
    p_organization_id: scope.organizationId,
    p_booking_id: scope.bookingId,
    p_property_id: scope.propertyId,
    p_job_id: jobId,
    p_expected_state: "awaiting_upload",
    p_error_code: "upload_capability_lost",
    p_error_evidence: "Browser upload capability expired.",
    p_provider_uid: null,
  });
  assert.deepEqual(AUTOHDR_DATABASE_CONTRACT.args.abandonProviderJob({
    ...scope,
    jobId,
    adminUserId: "66666666-6666-4666-8666-666666666666",
    reason: "Confirmed processing never began.",
  }), {
    p_organization_id: scope.organizationId,
    p_booking_id: scope.bookingId,
    p_property_id: scope.propertyId,
    p_job_id: jobId,
    p_admin_user_id: "66666666-6666-4666-8666-666666666666",
    p_reason: "Confirmed processing never began.",
  });
  assert.deepEqual(AUTOHDR_DATABASE_CONTRACT.args.claimRetrieval({ ...scope, jobId }), {
    p_organization_id: scope.organizationId,
    p_booking_id: scope.bookingId,
    p_property_id: scope.propertyId,
    p_job_id: jobId,
  });
});

test("source RPC arguments exactly match the corrected database functions and never contain URLs", () => {
  const prepared = AUTOHDR_DATABASE_CONTRACT.args.prepareSourceUpload({
    ...scope,
    requestId: "99999999-9999-4999-8999-999999999999",
    createdBy: "66666666-6666-4666-8666-666666666666",
    files: [{
      position: 0,
      filename: "Kitchen.jpg",
      byteSize: 2048,
      lastModified: 1234,
      contentType: "image/jpeg",
      sha256: "ab".repeat(32),
    }],
  });
  assert.deepEqual(Object.keys(prepared), [
    "p_organization_id", "p_booking_id", "p_request_id", "p_created_by", "p_files",
  ]);
  assert.deepEqual(prepared.p_files, [{
    filename: "Kitchen.jpg",
    byte_size: 2048,
    mime_type: "image/jpeg",
    sha256: "ab".repeat(32),
  }]);
  const accepted = AUTOHDR_DATABASE_CONTRACT.args.acceptSourceUpload({
    ...scope,
    mediaBatchId: "77777777-7777-4777-8777-777777777777",
    mediaAssetId: "88888888-8888-4888-8888-888888888888",
    sourceMediaVersionId,
    ingestJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    quarantineObjectKey: `quarantine/${scope.organizationId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
    quarantineEtag: '"q-etag"',
    objectKey: `masters/${scope.organizationId}/88888888-8888-4888-8888-888888888888/${sourceMediaVersionId}/${"ab".repeat(32)}.jpg`,
    ingestState: "discovered",
    byteSize: 2048,
    contentType: "image/jpeg",
    sha256: "ab".repeat(32),
    verifiedWidthPx: 3000,
    verifiedHeightPx: 2000,
  });
  assert.deepEqual(accepted, {
    p_organization_id: scope.organizationId,
    p_booking_id: scope.bookingId,
    p_batch_id: "77777777-7777-4777-8777-777777777777",
    p_asset_id: "88888888-8888-4888-8888-888888888888",
    p_version_id: sourceMediaVersionId,
    p_ingest_job_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    p_bucket_name: "pixel-blaster-private-media",
    p_quarantine_object_key: `quarantine/${scope.organizationId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
    p_quarantine_etag: '"q-etag"',
    p_object_key: `masters/${scope.organizationId}/88888888-8888-4888-8888-888888888888/${sourceMediaVersionId}/${"ab".repeat(32)}.jpg`,
    p_sha256: `\\x${"ab".repeat(32)}`,
    p_byte_size: 2048,
    p_mime_type: "image/jpeg",
    p_verified_width_px: 3000,
    p_verified_height_px: 2000,
  });
  assert.equal(JSON.stringify({ prepared, accepted }).includes("url"), false);
  assert.equal(AUTOHDR_DATABASE_CONTRACT.rpc.prepareSourceUpload, "prepare_autohdr_source_batch");
  assert.equal(AUTOHDR_DATABASE_CONTRACT.rpc.acceptSourceUpload, "accept_autohdr_source_version");
});
