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
const manifest = [{ name: "Kitchen.CR3", size: 2048, lastModified: 1234 }];
const signedUrl =
  "https://image-upload-autohdr-j.s3.amazonaws.com/org/raw/Kitchen.CR3?" +
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
    state: "claimed",
    providerUid: null,
  };
  const store = {
    async loadBooking() {
      calls.push("load_booking");
      return booking;
    },
    async claim() {
      calls.push("claim");
      return { job, newlyClaimed: true };
    },
    async loadJob() {
      calls.push("load_job");
      return job;
    },
    async transition(input) {
      calls.push(`transition:${input.from}:${input.to}`);
      if (failProcessingTransition && input.to === "processing") {
        throw new Error("database response contained internal details");
      }
      job = { ...job, state: input.to };
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
  return { application, calls, client, getJob: () => job, setJob: (next) => (job = next) };
}

test("prepare validates tenant and enablement, claims locally, then creates exactly once", async () => {
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
    "get_client",
    "claim",
    "transition:claimed:preparing",
    "provider_create",
    "assign_provider_uid",
    "transition:preparing:awaiting_upload",
  ]);
  assert.equal(result.job.state, "awaiting_upload");
  assert.deepEqual(result.uploads, [{
    filename: "Kitchen.CR3",
    url: signedUrl,
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-amz-acl": "private",
    },
  }]);
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
