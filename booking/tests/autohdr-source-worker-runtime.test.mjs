import assert from "node:assert/strict";
import test from "node:test";

import {
  runOneAutoHDRSourceFile,
  runAutoHDRQuarantineCleanup,
} from "../lib/integrations/autohdr/source-worker-core.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const bookingId = "22222222-2222-4222-8222-222222222222";
const propertyId = "33333333-3333-4333-8333-333333333333";
const batchId = "44444444-4444-4444-8444-444444444444";
const assetId = "55555555-5555-4555-8555-555555555555";
const versionId = "66666666-6666-4666-8666-666666666666";
const ingestJobId = "77777777-7777-4777-8777-777777777777";
const requestId = "88888888-8888-4888-8888-888888888888";
const leaseToken = "99999999-9999-4999-8999-999999999999";
const sha256 = "ab".repeat(32);
const quarantineObjectKey = `quarantine/${organizationId}/${ingestJobId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const masterObjectKey = `masters/${organizationId}/${assetId}/${versionId}/${sha256}.jpg`;

function claim(overrides = {}) {
  return {
    organizationId, bookingId, propertyId, batchId, assetId, versionId,
    ingestJobId, requestId, position: 0,
    quarantineBucketName: "pixel-blaster-private-media", quarantineObjectKey,
    quarantineEtag: '"q-etag"', masterBucketName: "pixel-blaster-private-media",
    masterObjectKey, sha256, byteSize: 4, mimeType: "image/jpeg",
    workerId: "worker-1", leaseToken, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function sourceFixture({ reservation = { newlyReserved: true, reusedAccepted: false } } = {}) {
  const calls = [];
  const c = claim();
  const store = {
    async claimSourceFile() { calls.push("claim"); return c; },
    async reserveSourceMaster() { calls.push("reserve"); return { versionId, assetId, batchId, bucketName: "pixel-blaster-private-media", objectKey: masterObjectKey, ...reservation }; },
    async completeSourceFile(input) { calls.push(`complete:${input.outcome}`); return { outcome: input.outcome }; },
    async settleSourceFile(input) { calls.push(`settle:${input.outcome}:${input.errorCode}`); },
  };
  const storage = {
    async head(key) { calls.push(`head:${key}`); return { bytes: 4, contentType: "image/jpeg", sha256, etag: '"q-etag"' }; },
    async getVerified(key) { calls.push(`get:${key}`); return { body: (async function* () { yield Buffer.from([1, 2, 3, 4]); })(), bytes: 4, contentType: "image/jpeg", sha256 }; },
    async promoteQuarantineCreateOnly() { calls.push("promote"); },
  };
  return { calls, c, store, storage };
}

test("one-file source worker fully verifies then reserves before permanent promotion and durable completion", async () => {
  const f = sourceFixture();
  const result = await runOneAutoHDRSourceFile({
    organizationId, workerId: "worker-1", leaseSeconds: 60, timeoutMs: 1000,
    store: f.store, storage: f.storage,
    verifyImage: async (body) => { for await (const _ of body) {} f.calls.push("decode"); return { widthPx: 2, heightPx: 2 }; },
  });
  assert.deepEqual(result, { status: "accepted", ingestJobId, reused: false });
  assert.deepEqual(f.calls, [
    "claim", `head:${quarantineObjectKey}`, `get:${quarantineObjectKey}`, "decode",
    "reserve", "promote", "complete:accepted",
  ]);
});

test("accepted master reuse never performs a second permanent promotion", async () => {
  const f = sourceFixture({ reservation: {
    versionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    batchId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    bucketName: "pixel-blaster-private-media",
    objectKey: `masters/${organizationId}/cccccccc-cccc-4ccc-8ccc-cccccccccccc/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/${sha256}.jpg`,
    newlyReserved: false,
    reusedAccepted: true,
  } });
  f.storage.promoteQuarantineCreateOnly = async () => assert.fail("reuse must not promote");
  const result = await runOneAutoHDRSourceFile({
    organizationId, workerId: "worker-1", leaseSeconds: 60, timeoutMs: 1000,
    store: f.store, storage: f.storage,
    verifyImage: async (body) => { for await (const _ of body) {} return { widthPx: 2, heightPx: 2 }; },
  });
  assert.equal(result.reused, true);
  assert.ok(f.calls.indexOf("reserve") < f.calls.indexOf("complete:reused_accepted"));
  assert.equal(f.calls.includes("promote"), false);
});

test("source worker clears or durably reconciles its lease after failures", async () => {
  const f = sourceFixture();
  f.storage.getVerified = async () => { throw Object.assign(new Error("missing"), { name: "NoSuchKey" }); };
  const result = await runOneAutoHDRSourceFile({
    organizationId, workerId: "worker-1", leaseSeconds: 60, timeoutMs: 1000,
    store: f.store, storage: f.storage, verifyImage: async () => assert.fail("must not decode"),
  });
  assert.deepEqual(result, { status: "reconciliation_required", ingestJobId, code: "source_object_not_found" });
  assert.ok(f.calls.includes("settle:reconciliation_required:source_object_not_found"));
});

function cleanupClaim(overrides = {}) {
  return {
    organizationId, bookingId, propertyId, ingestJobId,
    quarantineObjectKey, quarantineEtag: '"q-etag"', cleanupObjectEtag: null,
    cleanupAttempts: 1, cleanupLeaseToken: leaseToken,
    cleanupLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    lifecycleState: "accepted",
    ...overrides,
  };
}

test("cleanup dispatcher settles accepted cleanup, 404, ETag drift, transient retry, and exhaustion", async () => {
  const scenarios = [
    { claim: cleanupClaim(), head: { etag: '"q-etag"' }, expected: ["cleaned", null] },
    { claim: cleanupClaim(), error: Object.assign(new Error("missing"), { name: "NotFound" }), expected: ["not_found", null] },
    { claim: cleanupClaim(), head: { etag: '"different"' }, expected: ["reconciliation_required", "quarantine_cleanup_etag_drift"] },
    { claim: cleanupClaim({ cleanupAttempts: 2 }), deleteError: new Error("network"), expected: ["retryable", "quarantine_cleanup_delete_failed"] },
    { claim: cleanupClaim({ cleanupAttempts: 5 }), deleteError: new Error("network"), expected: ["reconciliation_required", "quarantine_cleanup_retry_exhausted"] },
  ];
  for (const scenario of scenarios) {
    const settlements = [];
    const store = {
      async claimQuarantineCleanup() { return [scenario.claim]; },
      async settleQuarantineCleanup(input) { settlements.push(input); },
    };
    const storage = {
      async head() { if (scenario.error) throw scenario.error; return scenario.head; },
      async deleteQuarantine() { if (scenario.deleteError) throw scenario.deleteError; },
    };
    await runAutoHDRQuarantineCleanup({ limit: 1, leaseSeconds: 60, maxAttempts: 5, timeoutMs: 1000, store, storageFor: () => storage });
    assert.deepEqual([settlements[0].outcome, settlements[0].errorCode], scenario.expected);
  }
});
