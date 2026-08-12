import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  copyMediaStorageCredentialsForSdk,
  loadDevelopmentMediaStorageConfig,
} from "../lib/media/storage/config-values.ts";
import {
  buildDerivativeKey,
  buildMasterKey,
  buildPackageKey,
  buildQuarantineKey,
  inspectMediaObjectKey,
} from "../lib/media/storage/keys.ts";
import { R2Storage } from "../lib/media/storage/r2-core.ts";
import {
  cleanupSyntheticQuarantineObjects,
  combineLiveProbeFailures,
} from "../lib/media/storage/live-probe-cleanup.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "31111111-1111-4111-8111-111111111111";
const ASSET_ID = "41111111-1111-4111-8111-111111111111";
const VERSION_ID = "51111111-1111-4111-8111-111111111111";
const RELEASE_ID = "61111111-1111-4111-8111-111111111111";
const SHA256 = createHash("sha256").update("synthetic-media").digest("hex");

const developmentEnv = {
  MEDIA_STORAGE_ENABLED: "false",
  MEDIA_STORAGE_ENVIRONMENT: "development",
  MEDIA_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  MEDIA_R2_ACCESS_KEY_ID: "development-access-key",
  MEDIA_R2_SECRET_ACCESS_KEY: "development-secret-key",
  MEDIA_R2_BUCKET: "pixel-blaster-dev-synthetic-media",
};

class FakeS3Client {
  constructor() {
    this.calls = [];
    this.objects = new Map();
    this.uploads = new Map();
    this.nextUpload = 1;
  }

  async send(command, options = {}) {
    this.calls.push({ name: command.constructor.name, input: command.input, options });
    if (options.abortSignal?.aborted) throw options.abortSignal.reason ?? new Error("aborted");
    const input = command.input;
    const identity = `${input.Bucket}/${input.Key}`;

    if (command.constructor.name === "PutObjectCommand") {
      if (input.IfNoneMatch === "*" && this.objects.has(identity)) {
        const error = new Error("precondition failed");
        error.name = "PreconditionFailed";
        throw error;
      }
      this.objects.set(identity, {
        body: Buffer.from(input.Body),
        contentType: input.ContentType,
        metadata: input.Metadata,
        etag: '"put-etag"',
      });
      return { ETag: '"put-etag"' };
    }
    if (command.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(identity);
      if (!object) throw Object.assign(new Error("not found"), { name: "NotFound" });
      return {
        ContentLength: object.body.length,
        ContentType: object.contentType,
        Metadata: object.metadata,
        ETag: object.etag,
      };
    }
    if (command.constructor.name === "GetObjectCommand") {
      const object = this.objects.get(identity);
      if (!object) throw Object.assign(new Error("not found"), { name: "NoSuchKey" });
      this.lastBody = Readable.from(object.body);
      return {
        Body: this.lastBody,
        ContentLength: object.body.length,
        ContentType: object.contentType,
        Metadata: object.metadata,
      };
    }
    if (command.constructor.name === "CreateMultipartUploadCommand") {
      const uploadId = `upload-${this.nextUpload++}`;
      this.uploads.set(uploadId, { identity, input, parts: new Map() });
      return { UploadId: uploadId };
    }
    if (command.constructor.name === "UploadPartCommand") {
      const upload = this.uploads.get(input.UploadId);
      if (!upload) throw new Error("unknown upload");
      upload.parts.set(input.PartNumber, Buffer.from(input.Body));
      this.onUploadPart?.(input.PartNumber);
      return { ETag: `"part-${input.PartNumber}"` };
    }
    if (command.constructor.name === "CompleteMultipartUploadCommand") {
      const upload = this.uploads.get(input.UploadId);
      if (!upload) throw new Error("unknown upload");
      if (input.IfNoneMatch === "*" && this.objects.has(identity)) {
        const error = new Error("precondition failed");
        error.name = "PreconditionFailed";
        throw error;
      }
      const body = Buffer.concat([...upload.parts.entries()].sort(([a], [b]) => a - b).map(([, part]) => part));
      const object = {
        body,
        contentType: upload.input.ContentType,
        metadata: upload.input.Metadata,
        etag: '"multipart-etag"',
      };
      this.objects.set(identity, object);
      this.onComplete?.(object);
      this.uploads.delete(input.UploadId);
      return { ETag: '"multipart-etag"' };
    }
    if (command.constructor.name === "AbortMultipartUploadCommand") {
      this.uploads.delete(input.UploadId);
      return {};
    }
    if (command.constructor.name === "DeleteObjectCommand") {
      const object = this.objects.get(identity);
      if (!object || input.IfMatch !== object.etag) {
        const error = new Error("precondition failed");
        error.name = "PreconditionFailed";
        throw error;
      }
      this.objects.delete(identity);
      return {};
    }
    throw new Error(`unexpected command ${command.constructor.name}`);
  }
}

async function consume(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function storage(client = new FakeS3Client()) {
  return {
    client,
    store: new R2Storage({
      client,
      organizationId: ORGANIZATION_ID,
      buckets: {
        quarantine: developmentEnv.MEDIA_R2_BUCKET,
        masters: developmentEnv.MEDIA_R2_BUCKET,
        delivery: developmentEnv.MEDIA_R2_BUCKET,
      },
    }),
  };
}

test("canonical key builders generate exact tenant-bound paths", () => {
  const quarantine = buildQuarantineKey(ORGANIZATION_ID, JOB_ID);
  const master = buildMasterKey(ORGANIZATION_ID, ASSET_ID, VERSION_ID, SHA256, "jpg");
  const derivative = buildDerivativeKey(ORGANIZATION_ID, VERSION_ID, 1, SHA256, "webp");
  const packageKey = buildPackageKey(ORGANIZATION_ID, RELEASE_ID, "mls_zip", SHA256);

  assert.match(quarantine, new RegExp(`^quarantine/${ORGANIZATION_ID}/${JOB_ID}/[0-9a-f-]{36}$`));
  assert.equal(master, `masters/${ORGANIZATION_ID}/${ASSET_ID}/${VERSION_ID}/${SHA256}.jpg`);
  assert.equal(derivative, `derivatives/${ORGANIZATION_ID}/${VERSION_ID}/1/${SHA256}.webp`);
  assert.equal(packageKey, `packages/${ORGANIZATION_ID}/${RELEASE_ID}/mls_zip/${SHA256}.zip`);
  assert.equal(inspectMediaObjectKey(master, ORGANIZATION_ID).bucketClass, "masters");
  assert.equal(inspectMediaObjectKey(derivative, ORGANIZATION_ID).bucketClass, "delivery");
  assert.equal(inspectMediaObjectKey(packageKey, ORGANIZATION_ID).bucketClass, "delivery");
});

test("key builders reject malformed identities, traversal, unsupported formats, and tenant drift", () => {
  assert.throws(() => buildMasterKey("not-a-uuid", ASSET_ID, VERSION_ID, SHA256, "jpg"), /UUID v4/i);
  assert.throws(() => buildMasterKey(ORGANIZATION_ID, ASSET_ID, VERSION_ID, SHA256.toUpperCase(), "jpg"), /sha256/i);
  assert.throws(() => buildMasterKey(ORGANIZATION_ID, ASSET_ID, VERSION_ID, SHA256, "html"), /extension/i);
  assert.throws(() => buildPackageKey(ORGANIZATION_ID, RELEASE_ID, "../../escape", SHA256), /package type/i);
  assert.throws(
    () => inspectMediaObjectKey(`masters/${OTHER_ORGANIZATION_ID}/${ASSET_ID}/${VERSION_ID}/${SHA256}.jpg`, ORGANIZATION_ID),
    /organization/i,
  );
  for (const unsafe of ["../escape", "/absolute", "masters//empty", "masters/a/../escape", "masters/a\\escape", "masters/a?token=x", "masters/a#fragment"])
    assert.throws(() => inspectMediaObjectKey(unsafe, ORGANIZATION_ID), /unsafe|organization|shape/i);
});

test("development storage config is explicit, disabled by default, and cannot name production buckets", () => {
  const config = loadDevelopmentMediaStorageConfig(developmentEnv);
  assert.equal(config.enabled, false);
  assert.equal(config.environment, "development");
  assert.equal(config.endpoint, `https://${developmentEnv.MEDIA_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.credentials), true);
  const sdkCredentials = copyMediaStorageCredentialsForSdk(config.credentials);
  assert.deepEqual(sdkCredentials, config.credentials);
  assert.equal(Object.isFrozen(sdkCredentials), false);
  assert.notEqual(sdkCredentials, config.credentials);
  assert.equal(config.bucket, "pixel-blaster-dev-synthetic-media");

  assert.throws(() => loadDevelopmentMediaStorageConfig({ ...developmentEnv, MEDIA_STORAGE_ENVIRONMENT: "production" }), /development/i);
  assert.throws(() => loadDevelopmentMediaStorageConfig({ ...developmentEnv, VERCEL_ENV: "production" }), /Vercel production/i);
  assert.throws(() => loadDevelopmentMediaStorageConfig({ ...developmentEnv, MEDIA_R2_ACCESS_KEY_ID: " development-access-key" }), /whitespace/i);
  assert.throws(() => loadDevelopmentMediaStorageConfig({ ...developmentEnv, MEDIA_STORAGE_ENABLED: "true" }), /disabled|code-dark/i);
  assert.equal(
    loadDevelopmentMediaStorageConfig({
      ...developmentEnv,
      MEDIA_STORAGE_ENABLED: "true",
      MEDIA_STORAGE_LIVE_PROBE_ACK: "development-synthetic-only",
    }).enabled,
    true,
  );
  assert.throws(() => loadDevelopmentMediaStorageConfig({ ...developmentEnv, MEDIA_R2_BUCKET: "pixel-blaster-production-media" }), /development|bucket/i);
  assert.throws(() => loadDevelopmentMediaStorageConfig({ ...developmentEnv, MEDIA_R2_SECRET_ACCESS_KEY: "" }), /SECRET_ACCESS_KEY/i);
});

test("buffer upload, HEAD, and GET bind buckets from canonical keys and verify bytes", async () => {
  const { client, store } = storage();
  const bytes = Buffer.from("synthetic-media");
  const key = buildMasterKey(ORGANIZATION_ID, ASSET_ID, VERSION_ID, SHA256, "jpg");

  await store.putBufferCreateOnly({ key, bytes, contentType: "image/jpeg", sha256: SHA256 });
  const head = await store.head(key);
  const download = await store.getVerified(key);

  assert.equal(head.bytes, bytes.length);
  assert.equal(head.sha256, SHA256);
  assert.deepEqual(await consume(download.body), bytes);
  assert.equal(client.calls[0].input.Bucket, developmentEnv.MEDIA_R2_BUCKET);
  assert.equal(client.calls[0].input.IfNoneMatch, "*");
  await assert.rejects(store.putBufferCreateOnly({ key, bytes, contentType: "image/jpeg", sha256: SHA256 }), /already exists/i);
});

test("multipart upload completes create-only and aborts every failed or cancelled upload", async () => {
  const { client, store } = storage();
  const first = Buffer.alloc(5 * 1024 * 1024, 1);
  const last = Buffer.from("synthetic-tail");
  const bytes = Buffer.concat([first, last]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const key = buildMasterKey(ORGANIZATION_ID, ASSET_ID, VERSION_ID, sha256, "jpg");

  const result = await store.putMultipartCreateOnly({
    key,
    parts: [first, last],
    contentType: "image/jpeg",
    sha256,
    expectedBytes: bytes.length,
  });
  assert.equal(result.bytes, bytes.length);
  assert.equal(client.uploads.size, 0);
  assert.equal(client.calls.find((call) => call.name === "CompleteMultipartUploadCommand").input.IfNoneMatch, "*");

  const wrongHashKey = buildDerivativeKey(ORGANIZATION_ID, VERSION_ID, 1, "f".repeat(64), "webp");
  await assert.rejects(
    store.putMultipartCreateOnly({
      key: wrongHashKey,
      parts: [first, last],
      contentType: "image/webp",
      sha256: "f".repeat(64),
      expectedBytes: bytes.length,
    }),
    /checksum mismatch/i,
  );
  assert.equal(client.uploads.size, 0);
  assert.equal(client.calls.at(-1).name, "AbortMultipartUploadCommand");

  const unequal = storage();
  const unequalMiddle = Buffer.alloc(6 * 1024 * 1024, 2);
  const unequalBytes = Buffer.concat([first, unequalMiddle, last]);
  const unequalSha = createHash("sha256").update(unequalBytes).digest("hex");
  await assert.rejects(
    unequal.store.putMultipartCreateOnly({
      key: buildDerivativeKey(ORGANIZATION_ID, VERSION_ID, 5, unequalSha, "webp"),
      parts: [first, unequalMiddle, last],
      contentType: "image/webp",
      sha256: unequalSha,
      expectedBytes: unequalBytes.length,
    }),
    /equal byte lengths/i,
  );
  assert.equal(unequal.client.uploads.size, 0);
  assert.equal(unequal.client.calls.at(-1).name, "AbortMultipartUploadCommand");

  const cancellation = storage();
  const controller = new AbortController();
  cancellation.client.onUploadPart = (partNumber) => {
    if (partNumber === 1) controller.abort(new Error("synthetic cancellation"));
  };
  await assert.rejects(
    cancellation.store.putMultipartCreateOnly({
      key: buildDerivativeKey(ORGANIZATION_ID, VERSION_ID, 2, sha256, "webp"),
      parts: [first, last],
      contentType: "image/webp",
      sha256,
      expectedBytes: bytes.length,
      signal: controller.signal,
    }),
    /synthetic cancellation|aborted/i,
  );
  assert.equal(cancellation.client.uploads.size, 0);
  assert.equal(cancellation.client.calls.at(-1).name, "AbortMultipartUploadCommand");

  const completedButUnverifiable = storage();
  completedButUnverifiable.client.onComplete = (object) => { object.metadata = {}; };
  await assert.rejects(
    completedButUnverifiable.store.putMultipartCreateOnly({
      key: buildDerivativeKey(ORGANIZATION_ID, VERSION_ID, 3, sha256, "webp"),
      parts: [first, last],
      contentType: "image/webp",
      sha256,
      expectedBytes: bytes.length,
    }),
    /reconciliation is required/i,
  );
  assert.equal(completedButUnverifiable.client.objects.size, 1);
  assert.notEqual(completedButUnverifiable.client.calls.at(-1).name, "AbortMultipartUploadCommand");

  const mutablePart = Buffer.alloc(5 * 1024 * 1024, 7);
  const immutableTail = Buffer.from("immutable-tail");
  const immutableBytes = Buffer.concat([mutablePart, immutableTail]);
  const immutableSha = createHash("sha256").update(immutableBytes).digest("hex");
  async function* mutatingProducer() {
    yield mutablePart;
    mutablePart.fill(8);
    yield immutableTail;
  }
  const snapshotted = storage();
  await snapshotted.store.putMultipartCreateOnly({
    key: buildDerivativeKey(ORGANIZATION_ID, VERSION_ID, 4, immutableSha, "webp"),
    parts: mutatingProducer(),
    contentType: "image/webp",
    sha256: immutableSha,
    expectedBytes: immutableBytes.length,
  });
  assert.deepEqual(
    [...snapshotted.client.objects.values()][0].body,
    immutableBytes,
    "multipart input must be snapshotted before the producer can mutate it",
  );
});

test("ambiguous live-probe uploads are reconciled and conditionally cleaned", async () => {
  const { client, store } = storage();
  const key = buildQuarantineKey(ORGANIZATION_ID, JOB_ID);
  const bytes = Buffer.from("synthetic-media");
  const cleanupCandidates = new Set([key]);

  await store.putBufferCreateOnly({
    key,
    bytes,
    contentType: "application/octet-stream",
    sha256: SHA256,
  });
  assert.equal(client.objects.size, 1);

  const cleanup = await cleanupSyntheticQuarantineObjects({
    keys: cleanupCandidates,
    head: (candidate) => store.head(candidate),
    remove: (candidate, expectedEtag) => store.deleteQuarantine({ key: candidate, expectedEtag }),
  });
  assert.deepEqual(cleanup, { removed: 1, absent: 0, unresolved: [] });
  assert.equal(client.objects.size, 0);
});

test("live-probe cleanup fails closed when residue cannot be reconciled", async () => {
  const key = buildQuarantineKey(ORGANIZATION_ID, JOB_ID);
  const cleanup = await cleanupSyntheticQuarantineObjects({
    keys: new Set([key]),
    head: async () => ({ bytes: 1, contentType: "application/octet-stream", sha256: SHA256, etag: null }),
    remove: async () => assert.fail("cleanup must not delete without a verified ETag"),
  });
  assert.equal(cleanup.removed, 0);
  assert.equal(cleanup.absent, 0);
  assert.deepEqual(cleanup.unresolved, [key.slice(-36)]);
});

test("live-probe cleanup treats every supported missing-object shape as benign", async () => {
  const keys = [
    buildQuarantineKey(ORGANIZATION_ID, JOB_ID),
    buildQuarantineKey(ORGANIZATION_ID, JOB_ID),
    buildQuarantineKey(ORGANIZATION_ID, JOB_ID),
  ];
  const missing = [
    Object.assign(new Error("missing"), { name: "NotFound" }),
    Object.assign(new Error("missing"), { name: "NoSuchKey" }),
    Object.assign(new Error("missing"), { $metadata: { httpStatusCode: 404 } }),
  ];
  let index = 0;
  const cleanup = await cleanupSyntheticQuarantineObjects({
    keys,
    head: async () => {
      throw missing[index++];
    },
    remove: async () => assert.fail("missing objects must not be deleted"),
  });
  assert.deepEqual(cleanup, { removed: 0, absent: 3, unresolved: [] });
});

test("live-probe preserves primary and final-cleanup failures together", () => {
  const primary = new Error("probe failed");
  const cleanup = new Error("cleanup failed");
  const combined = combineLiveProbeFailures(primary, cleanup);
  assert.equal(combined instanceof AggregateError, true);
  assert.deepEqual(combined.errors, [primary, cleanup]);
  assert.equal(combined.cause, primary);
  assert.match(combined.message, /probe and final cleanup both failed/i);
  assert.equal(combineLiveProbeFailures(primary, null), primary);
  assert.equal(combineLiveProbeFailures(null, cleanup), cleanup);
});

test("deletion is restricted to an exact quarantine object and ETag", async () => {
  const { client, store } = storage();
  const key = buildQuarantineKey(ORGANIZATION_ID, JOB_ID);
  const bytes = Buffer.from("synthetic-media");
  await store.putBufferCreateOnly({ key, bytes, contentType: "application/octet-stream", sha256: SHA256 });
  const head = await store.head(key);

  await assert.rejects(store.deleteQuarantine({ key, expectedEtag: '"wrong"' }), /precondition/i);
  await store.deleteQuarantine({ key, expectedEtag: head.etag });
  assert.equal(client.objects.size, 0);

  const master = buildMasterKey(ORGANIZATION_ID, ASSET_ID, VERSION_ID, SHA256, "jpg");
  await assert.rejects(store.deleteQuarantine({ key: master, expectedEtag: '"etag"' }), /quarantine/i);
});

test("verified downloads reject altered bytes and destroy the upstream stream on cancellation", async () => {
  const { client, store } = storage();
  const bytes = Buffer.from("synthetic-media");
  const key = buildMasterKey(ORGANIZATION_ID, ASSET_ID, VERSION_ID, SHA256, "jpg");
  await store.putBufferCreateOnly({ key, bytes, contentType: "image/jpeg", sha256: SHA256 });

  client.objects.get(`${developmentEnv.MEDIA_R2_BUCKET}/${key}`).body = Buffer.from("tampered-media");
  const tampered = await store.getVerified(key);
  await assert.rejects(consume(tampered.body), /byte length|checksum mismatch/i);

  client.objects.get(`${developmentEnv.MEDIA_R2_BUCKET}/${key}`).body = bytes;
  const controller = new AbortController();
  const download = await store.getVerified(key, controller.signal);
  controller.abort(new Error("synthetic download cancellation"));
  await assert.rejects(consume(download.body), /synthetic download cancellation|aborted/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.lastBody.destroyed, true);
});

test("credential-bearing modules are server-only and no current app route imports the R2 boundary", () => {
  const configSource = readFileSync(new URL("../lib/media/storage/config.ts", import.meta.url), "utf8");
  const r2Source = readFileSync(new URL("../lib/media/storage/r2.ts", import.meta.url), "utf8");
  assert.match(configSource, /^import "server-only";/m);
  assert.match(r2Source, /^import "server-only";/m);

  const packageSource = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.match(packageSource, /"@aws-sdk\/client-s3"/);
  for (const root of [
    new URL("../app/", import.meta.url).pathname,
    new URL("../lib/", import.meta.url).pathname,
  ]) {
    for (const path of sourceFiles(root)) {
      const source = readFileSync(path, "utf8");
      if (/^["']use client["'];/m.test(source)) {
        assert.doesNotMatch(source, /media\/storage\/(?:r2|config)/, `${path} imports server-only media credentials`);
      }
    }
  }
});

test("the live R2 verifier fails closed before network access while storage is disabled", () => {
  const result = spawnSync(
    process.execPath,
    [new URL("../scripts/verify-development-r2.mjs", import.meta.url).pathname],
    {
      cwd: new URL("../", import.meta.url),
      env: { ...process.env, ...developmentEnv },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /must be true for the authorized live development probe/i);
});
