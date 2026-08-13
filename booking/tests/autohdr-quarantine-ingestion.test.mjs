import assert from "node:assert/strict";
import test from "node:test";

import {
  ingestAutoHDRSourceFiles,
} from "../lib/integrations/autohdr/source-ingestion-core.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const bookingId = "22222222-2222-4222-8222-222222222222";
const propertyId = "33333333-3333-4333-8333-333333333333";
const mediaBatchId = "44444444-4444-4444-8444-444444444444";
const mediaAssetId = "55555555-5555-4555-8555-555555555555";
const sourceMediaVersionId = "66666666-6666-4666-8666-666666666666";
const ingestJobId = "77777777-7777-4777-8777-777777777777";
const sha256 = "ab".repeat(32);
const quarantineObjectKey = `quarantine/${organizationId}/${ingestJobId}/88888888-8888-4888-8888-888888888888`;
const objectKey = `masters/${organizationId}/${mediaAssetId}/${sourceMediaVersionId}/${sha256}.jpg`;

function source(overrides = {}) {
  return {
    position: 0,
    filename: "Kitchen.jpg",
    byteSize: 2048,
    lastModified: 1234,
    contentType: "image/jpeg",
    sha256,
    mediaBatchId,
    mediaAssetId,
    sourceMediaVersionId,
    ingestJobId,
    quarantineObjectKey,
    objectKey,
    ingestState: "discovered",
    quarantineEtag: null,
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const calls = [];
  const accepted = [];
  let promoted = false;
  const storage = {
    async head(key) {
      calls.push(`head:${key}`);
      if (key === objectKey && !promoted) throw Object.assign(new Error("missing"), { name: "NotFound" });
      return { bytes: 2048, contentType: "image/jpeg", sha256, etag: key === quarantineObjectKey ? '"q-etag"' : '"m-etag"' };
    },
    async getVerified(key) {
      calls.push(`get:${key}`);
      return { body: (async function* () { yield Buffer.alloc(2048); })(), bytes: 2048, contentType: "image/jpeg", sha256 };
    },
    async promoteQuarantineCreateOnly(input) {
      calls.push(`promote:${input.sourceKey}:${input.destinationKey}:${input.expectedSourceEtag}`);
      promoted = true;
      return { outcome: "created" };
    },
    async deleteQuarantine(input) {
      calls.push(`delete:${input.key}:${input.expectedEtag}`);
    },
    ...overrides.storage,
  };
  const store = {
    async acceptSourceUpload(input) {
      calls.push(`accept:${input.quarantineEtag}`);
      accepted.push(input);
      return { ...input.file, ingestState: "accepted", quarantineEtag: input.quarantineEtag };
    },
    ...overrides.store,
  };
  return {
    calls,
    accepted,
    run: (sources, options = {}) => ingestAutoHDRSourceFiles({
      organizationId,
      bookingId,
      propertyId,
      sources,
      storage,
      store,
      verifyImage: async () => {
        calls.push("decode");
        return { widthPx: 3000, heightPx: 2000 };
      },
      signal: new AbortController().signal,
      perFileTimeoutMs: 100,
      ...options,
    }),
  };
}

test("quarantine is fully verified and decoded before create-only promotion, acceptance, and conditional cleanup", async () => {
  const f = fixture();
  const result = await f.run([source()]);
  assert.deepEqual(result.results.map(({ status, cleanup }) => ({ status, cleanup })), [
    { status: "accepted", cleanup: "deleted" },
  ]);
  assert.deepEqual(f.calls, [
    `head:${quarantineObjectKey}`,
    `get:${quarantineObjectKey}`,
    "decode",
    `head:${objectKey}`,
    `promote:${quarantineObjectKey}:${objectKey}:"q-etag"`,
    `head:${objectKey}`,
    `get:${objectKey}`,
    'accept:"q-etag"',
    `delete:${quarantineObjectKey}:"q-etag"`,
  ]);
  assert.equal(f.accepted[0].file.objectKey, objectKey);
});

test("accepted-but-unacknowledged files skip verification and promotion, then resume conditional cleanup", async () => {
  const f = fixture();
  const result = await f.run([source({ ingestState: "accepted", quarantineEtag: '"q-etag"' })]);
  assert.equal(result.results[0].status, "accepted");
  assert.equal(result.results[0].cleanup, "deleted");
  assert.deepEqual(f.calls, [`delete:${quarantineObjectKey}:"q-etag"`]);
});

test("an existing correct master reconciles while a mismatched master is never overwritten or deleted", async () => {
  const correct = fixture({
    storage: {
      async head(key) {
        correct.calls.push(`head:${key}`);
        return { bytes: 2048, contentType: "image/jpeg", sha256, etag: key === quarantineObjectKey ? '"q-etag"' : '"m-etag"' };
      },
      async promoteQuarantineCreateOnly() { assert.fail("correct master must skip promotion"); },
    },
  });
  const correctResult = await correct.run([source()]);
  assert.equal(correctResult.results[0].status, "accepted");

  const wrong = fixture({
    storage: {
      async head(key) {
        wrong.calls.push(`head:${key}`);
        return key === quarantineObjectKey
          ? { bytes: 2048, contentType: "image/jpeg", sha256, etag: '"q-etag"' }
          : { bytes: 2049, contentType: "image/jpeg", sha256, etag: '"wrong"' };
      },
      async promoteQuarantineCreateOnly() { assert.fail("mismatched master must not be overwritten"); },
      async deleteQuarantine() { assert.fail("evidence must be preserved"); },
    },
  });
  const wrongResult = await wrong.run([source()]);
  assert.equal(wrongResult.results[0].status, "reconciliation_required");
  assert.equal(wrong.calls.some((call) => call.startsWith("accept:")), false);
});

test("wrong quarantine ETag/hash and promotion ambiguity preserve evidence and produce per-file reconciliation", async () => {
  for (const head of [
    { bytes: 2048, contentType: "image/jpeg", sha256, etag: null },
    { bytes: 2048, contentType: "image/jpeg", sha256: "cd".repeat(32), etag: '"q-etag"' },
  ]) {
    const f = fixture({ storage: { async head() { return head; } } });
    const result = await f.run([source()]);
    assert.equal(result.results[0].status, "reconciliation_required");
    assert.equal(f.calls.some((call) => call.startsWith("delete:")), false);
  }

  let masterHeads = 0;
  const ambiguous = fixture({
    storage: {
      async head(key) {
        if (key === quarantineObjectKey) return { bytes: 2048, contentType: "image/jpeg", sha256, etag: '"q-etag"' };
        masterHeads += 1;
        if (masterHeads === 1) throw Object.assign(new Error("missing"), { name: "NotFound" });
        return { bytes: 2048, contentType: "image/jpeg", sha256, etag: '"m-etag"' };
      },
      async getVerified() {
        return { body: (async function* () { yield Buffer.alloc(2048); })(), bytes: 2048, contentType: "image/jpeg", sha256 };
      },
      async promoteQuarantineCreateOnly() { throw new Error("response lost"); },
    },
  });
  const result = await ambiguous.run([source()]);
  assert.equal(result.results[0].status, "accepted");
  assert.equal(ambiguous.calls.some((call) => call.startsWith("delete:")), true);
});

test("conditional cleanup failure preserves accepted evidence and does not downgrade acceptance", async () => {
  const f = fixture({ storage: { async deleteQuarantine() { throw new Error("conditional delete failed"); } } });
  const result = await f.run([source()]);
  assert.equal(result.results[0].status, "accepted");
  assert.equal(result.results[0].cleanup, "pending");
  assert.equal(f.accepted.length, 1);
});

test("acceptance is per-file and a timeout does not roll back an accepted sibling", async () => {
  const second = source({
    position: 1,
    filename: "Exterior.jpg",
    mediaAssetId: "99999999-9999-4999-8999-999999999999",
    sourceMediaVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ingestJobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    quarantineObjectKey: `quarantine/${organizationId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
    objectKey: `masters/${organizationId}/99999999-9999-4999-8999-999999999999/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${sha256}.jpg`,
  });
  const f = fixture({
    storage: {
      async head(key, signal) {
        if (key === second.quarantineObjectKey) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 1000);
            signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
          });
        }
        return { bytes: 2048, contentType: "image/jpeg", sha256, etag: key.includes("quarantine/") ? '"q-etag"' : '"m-etag"' };
      },
    },
  });
  const result = await f.run([source(), second], { perFileTimeoutMs: 5 });
  assert.deepEqual(result.results.map((entry) => entry.status), ["accepted", "reconciliation_required"]);
});
