import assert from "node:assert/strict";
import test from "node:test";

import { createAutoHDRApplication } from "../lib/integrations/autohdr/application-core.ts";

const admin = {
  userId: "33333333-3333-4333-8333-333333333333",
  organizationId: "11111111-1111-4111-8111-111111111111",
};
const booking = {
  id: "22222222-2222-4222-8222-222222222222",
  organizationId: admin.organizationId,
  propertyId: "44444444-4444-4444-8444-444444444444",
  address: "10 King Street, Kitchener",
};
const sourceMediaVersionId = "66666666-6666-4666-8666-666666666666";
const mediaBatchId = "77777777-7777-4777-8777-777777777777";
const mediaAssetId = "88888888-8888-4888-8888-888888888888";
const manifest = [{
  position: 0,
  sourceMediaVersionId,
  filename: "Kitchen.jpg",
  byteSize: 2048,
  lastModified: 1234,
  contentType: "image/jpeg",
  sha256: "ab".repeat(32),
  mediaBatchId,
  mediaAssetId,
  ingestJobId: "99999999-9999-4999-8999-999999999999",
  objectKey: `masters/${admin.organizationId}/${mediaAssetId}/${sourceMediaVersionId}/${"ab".repeat(32)}.jpg`,
}];
const signedUrl =
  "https://image-upload-autohdr-j.s3.amazonaws.com/org/raw/Kitchen.jpg?" +
  new URLSearchParams({
    AWSAccessKeyId: "synthetic-access-key",
    Signature: "synthetic-signature",
    "content-type": "application/octet-stream",
    "x-amz-acl": "private",
    Expires: "1786587239",
  });

function fixture(overrides = {}) {
  const { failProcessingTransition = false, ...dependencyOverrides } = overrides;
  const calls = [];
  let job = {
    id: "55555555-5555-4555-8555-555555555555",
    organizationId: admin.organizationId,
    bookingId: booking.id,
    propertyId: booking.propertyId,
    state: "claimed",
    providerUid: null,
  };
  const store = {
    async loadBooking() {
      calls.push("load_booking");
      return booking;
    },
    async claim(input) {
      calls.push("claim");
      calls.push({ claimInput: input });
      return { job, newlyCreated: true };
    },
    async loadJob() {
      calls.push("load_job");
      return job;
    },
    async transition(input) {
      calls.push(`transition:${input.expectedState}:${input.newState}`);
      if (failProcessingTransition && input.newState === "processing") {
        throw new Error("database response contained internal details");
      }
      job = { ...job, state: input.newState };
      return job;
    },
    async assignProviderUid(input) {
      calls.push("assign_provider_uid");
      job = { ...job, providerUid: input.providerUid };
      return job;
    },
    async claimRetrieval() {
      calls.push("claim_retrieval");
      throw new Error("retrieval must remain blocked");
    },
  };
  const client = {
    async createPhotoshoot() {
      calls.push("provider_create");
      return {
        id: 7,
        uid: "shoot_7",
        uploadedFiles: [signedUrl],
        status: "created",
        createdAt: "2026-08-12T20:00:00Z",
      };
    },
    async finalizePhotoshoot() {
      calls.push("provider_finalize");
      return {
        id: 7,
        uid: "shoot_7",
        uploadedFiles: [],
        status: "processing",
        createdAt: "2026-08-12T20:00:00Z",
      };
    },
    async getStatus() {
      calls.push("provider_status");
      return {
        id: 7,
        rawStatus: "completed",
        normalizedStatus: "ready",
        createdAt: "2026-08-12T20:00:00Z",
      };
    },
    async getProcessedPhotos() {
      calls.push("provider_processed_photos");
      throw new Error("processed endpoint must remain blocked");
    },
  };
  const application = createAutoHDRApplication({
    store,
    requireEnabled: async () => calls.push("require_enabled"),
    getClient: async () => {
      calls.push("get_client");
      return client;
    },
    getCallbackUrls: () => ({
      uploadCallbackUrl: "https://pixelblastermedia.com/api/integrations/autohdr/upload",
    }),
    ...dependencyOverrides,
  });
  return {
    application,
    calls,
    client,
    getJob: () => job,
    setJob: (next) => (job = { propertyId: booking.propertyId, ...next }),
  };
}

test("prepare validates accepted canonical sources, claims exact DB manifest, then creates exactly once", async () => {
  const { application, calls } = fixture();
  const result = await application.prepare({
    admin,
    bookingId: booking.id,
    manifest,
    style: { modelSelection: "Classic-V4", perspectiveCorrection: true },
  });

  assert.deepEqual(calls, [
    "load_booking",
    "require_enabled",
    "claim",
    calls[3],
    "transition:claimed:preparing",
    "get_client",
    "provider_create",
    "assign_provider_uid",
    "transition:preparing:awaiting_upload",
  ]);
  assert.deepEqual(calls[3].claimInput.files, [{
    position: 0,
    sourceMediaVersionId,
    filename: "Kitchen.jpg",
  }]);
  assert.match(calls[3].claimInput.manifestSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(calls[3].claimInput.style, undefined);
  assert.equal(result.job.state, "awaiting_upload");
  assert.deepEqual(result.uploads, [{
    filename: "Kitchen.jpg",
    url: signedUrl,
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-amz-acl": "private",
    },
  }]);
});

test("every explicit newly_created=false claim and state fails closed before any provider call", async () => {
  for (const state of ["claimed", "preparing", "processing"]) {
    const { application, calls, setJob } = fixture();
    setJob({
      id: "55555555-5555-4555-8555-555555555555",
      organizationId: admin.organizationId,
      bookingId: booking.id,
      propertyId: booking.propertyId,
      state,
      providerUid: state === "claimed" ? null : "shoot_existing",
    });
    await assert.rejects(
      createAutoHDRApplication({
        store: {
          async loadBooking() { calls.push("load_booking"); return booking; },
          async claim() { calls.push("claim"); return { job: {
            id: "55555555-5555-4555-8555-555555555555",
            organizationId: admin.organizationId,
            bookingId: booking.id,
            propertyId: booking.propertyId,
            state,
            providerUid: state === "claimed" ? null : "shoot_existing",
          }, newlyCreated: false }; },
        },
        requireEnabled: async () => calls.push("require_enabled"),
        getClient: async () => { calls.push("get_client"); return {
          async createPhotoshoot() { calls.push("provider_create"); throw new Error("must not call"); },
        }; },
        getCallbackUrls: () => ({ uploadCallbackUrl: "https://pixelblastermedia.com/callback" }),
      }).prepare({ admin, bookingId: booking.id, manifest, style: {} }),
      (error) => error?.code === "idempotency_conflict",
    );
    assert.equal(calls.includes("provider_create"), false);
    assert.equal(calls.includes("get_client"), false);
  }
});

test("prepare marks an ambiguous provider creation failure for reconciliation and never retries", async () => {
  let attempts = 0;
  const { application, calls } = fixture({
    getClient: async () => ({
      async createPhotoshoot() {
        attempts += 1;
        throw new TypeError("socket closed after request bytes were sent token=secret");
      },
    }),
  });

  await assert.rejects(
    application.prepare({ admin, bookingId: booking.id, manifest, style: {} }),
    (error) => error?.code === "provider_outcome_ambiguous" && !error.message.includes("secret"),
  );
  assert.equal(attempts, 1);
  assert.match(calls.join("\n"), /transition:preparing:reconciliation_required/);
});

test("finalize claims the state transition before calling the provider once", async () => {
  const { application, calls, setJob } = fixture();
  setJob({
    id: "55555555-5555-4555-8555-555555555555",
    organizationId: admin.organizationId,
    bookingId: booking.id,
    state: "awaiting_upload",
    providerUid: "shoot_7",
  });

  const result = await application.finalize({
    admin,
    bookingId: booking.id,
    jobId: "55555555-5555-4555-8555-555555555555",
  });
  assert.equal(result.job.state, "processing");
  assert.ok(
    calls.indexOf("transition:awaiting_upload:finalizing") < calls.indexOf("provider_finalize"),
  );
  assert.equal(calls.filter((call) => call === "provider_finalize").length, 1);
});

test("finalize reconciles when the provider succeeds but local confirmation fails", async () => {
  const { application, calls, setJob } = fixture({ failProcessingTransition: true });
  setJob({
    id: "55555555-5555-4555-8555-555555555555",
    organizationId: admin.organizationId,
    bookingId: booking.id,
    state: "awaiting_upload",
    providerUid: "shoot_7",
  });

  await assert.rejects(
    application.finalize({
      admin,
      bookingId: booking.id,
      jobId: "55555555-5555-4555-8555-555555555555",
    }),
    (error) =>
      error?.code === "provider_outcome_ambiguous" &&
      !error.message.includes("internal details"),
  );
  assert.equal(calls.filter((call) => call === "provider_finalize").length, 1);
  assert.ok(calls.includes("transition:finalizing:reconciliation_required"));
});

test("status maps an unknown provider state fail-closed and never retrieves photos", async () => {
  const { application, calls, setJob } = fixture({
    getClient: async () => ({
      async getStatus() {
        calls.push("provider_status");
        return {
          id: 7,
          rawStatus: "new_unreviewed_state",
          normalizedStatus: "unknown",
          createdAt: "2026-08-12T20:00:00Z",
        };
      },
      async getProcessedPhotos() {
        calls.push("provider_processed_photos");
      },
    }),
  });
  setJob({
    id: "55555555-5555-4555-8555-555555555555",
    organizationId: admin.organizationId,
    bookingId: booking.id,
    state: "processing",
    providerUid: "shoot_7",
  });

  const result = await application.refresh({
    admin,
    bookingId: booking.id,
    jobId: "55555555-5555-4555-8555-555555555555",
  });
  assert.equal(result.job.state, "reconciliation_required");
  assert.equal(calls.includes("provider_processed_photos"), false);
});

test("retrieval is explicit but blocked before claim or processed URL access", async () => {
  const { application, calls, setJob } = fixture();
  setJob({
    id: "55555555-5555-4555-8555-555555555555",
    organizationId: admin.organizationId,
    bookingId: booking.id,
    state: "ready",
    providerUid: "shoot_7",
  });

  const result = await application.retrieve({
    admin,
    bookingId: booking.id,
    jobId: "55555555-5555-4555-8555-555555555555",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "secure_ingestion_prerequisite");
  assert.match(result.error, /streamed downloader/i);
  assert.equal(calls.includes("claim_retrieval"), false);
  assert.equal(calls.includes("provider_processed_photos"), false);
});
