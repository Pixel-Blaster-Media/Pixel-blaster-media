#!/usr/bin/env node
import { createHash } from "node:crypto";

import {
  HeadBucketCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  copyMediaStorageCredentialsForSdk,
  loadDevelopmentMediaStorageConfig,
} from "../lib/media/storage/config-values.ts";
import { buildQuarantineKey } from "../lib/media/storage/keys.ts";
import {
  cleanupSyntheticQuarantineObjects,
  combineLiveProbeFailures,
} from "../lib/media/storage/live-probe-cleanup.ts";
import { R2Storage } from "../lib/media/storage/r2-core.ts";

const ORGANIZATION_ID = "d1111111-1111-4111-8111-111111111111";
const INGEST_JOB_ID = "d2111111-1111-4111-8111-111111111111";
const PREFIX = `quarantine/${ORGANIZATION_ID}/${INGEST_JOB_ID}/`;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function consume(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const config = loadDevelopmentMediaStorageConfig(process.env);
if (!config.enabled) throw new Error("MEDIA_STORAGE_ENABLED must be true for the authorized live development probe");

const client = new S3Client({
  region: config.region,
  endpoint: config.endpoint,
  credentials: copyMediaStorageCredentialsForSdk(config.credentials),
  forcePathStyle: false,
  maxAttempts: 3,
});
const storage = new R2Storage({
  client,
  organizationId: ORGANIZATION_ID,
  buckets: {
    quarantine: config.bucket,
    masters: config.bucket,
    delivery: config.bucket,
  },
});

const cleanupCandidates = new Set();
const startedAt = Date.now();
let primaryFailure = null;
let successEvidence = null;
try {
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }));

  const smallBytes = Buffer.from("pixel-booking-r2-development-synthetic-probe");
  const smallSha = digest(smallBytes);
  const smallKey = buildQuarantineKey(ORGANIZATION_ID, INGEST_JOB_ID);
  cleanupCandidates.add(smallKey);
  const smallPut = await storage.putBufferCreateOnly({
    key: smallKey,
    bytes: smallBytes,
    contentType: "application/octet-stream",
    sha256: smallSha,
  });
  if (!smallPut.etag) throw new Error("live buffer upload returned no ETag");
  const smallHead = await storage.head(smallKey);
  const smallDownload = await storage.getVerified(smallKey);
  if (!smallBytes.equals(await consume(smallDownload.body))) throw new Error("live buffer download bytes changed");
  if (smallHead.bytes !== smallBytes.length || smallHead.sha256 !== smallSha) throw new Error("live buffer HEAD verification failed");
  try {
    await storage.putBufferCreateOnly({
      key: smallKey,
      bytes: smallBytes,
      contentType: "application/octet-stream",
      sha256: smallSha,
    });
    throw new Error("live create-only upload unexpectedly overwrote an object");
  } catch (error) {
    if (!(error instanceof Error) || !/already exists/i.test(error.message)) throw error;
  }

  const firstPart = Buffer.alloc(5 * 1024 * 1024, 0x52);
  const finalPart = Buffer.from("pixel-booking-r2-multipart-tail");
  const multipartBytes = Buffer.concat([firstPart, finalPart]);
  const multipartSha = digest(multipartBytes);
  const multipartKey = buildQuarantineKey(ORGANIZATION_ID, INGEST_JOB_ID);
  cleanupCandidates.add(multipartKey);
  const multipartPut = await storage.putMultipartCreateOnly({
    key: multipartKey,
    parts: [firstPart, finalPart],
    contentType: "application/octet-stream",
    sha256: multipartSha,
    expectedBytes: multipartBytes.length,
  });
  if (!multipartPut.etag) throw new Error("live multipart upload returned no ETag");
  const multipartDownload = await storage.getVerified(multipartKey);
  if (!multipartBytes.equals(await consume(multipartDownload.body))) throw new Error("live multipart bytes changed");

  const abortedKey = buildQuarantineKey(ORGANIZATION_ID, INGEST_JOB_ID);
  cleanupCandidates.add(abortedKey);
  try {
    await storage.putMultipartCreateOnly({
      key: abortedKey,
      parts: [firstPart, finalPart],
      contentType: "application/octet-stream",
      sha256: "f".repeat(64),
      expectedBytes: multipartBytes.length,
    });
    throw new Error("checksum-invalid multipart upload unexpectedly completed");
  } catch (error) {
    if (!(error instanceof Error) || !/checksum mismatch/i.test(error.message)) throw error;
  }

  const pending = await client.send(new ListMultipartUploadsCommand({
    Bucket: config.bucket,
    Prefix: PREFIX,
  }));
  if ((pending.Uploads?.length ?? 0) !== 0) throw new Error("aborted multipart upload left an orphan");

  const cleanup = await cleanupSyntheticQuarantineObjects({
    keys: cleanupCandidates,
    head: (key) => storage.head(key),
    remove: (key, expectedEtag) =>
      storage.deleteQuarantine({ key, expectedEtag }),
  });
  if (cleanup.unresolved.length !== 0) {
    throw new Error(
      `synthetic probe cleanup requires operator attention for ${cleanup.unresolved.length} object(s)`,
    );
  }
  const residue = await client.send(new ListObjectsV2Command({
    Bucket: config.bucket,
    Prefix: PREFIX,
  }));
  if ((residue.KeyCount ?? residue.Contents?.length ?? 0) !== 0) throw new Error("synthetic probe cleanup left object residue");

  successEvidence = {
    passed: true,
    environment: config.environment,
    bucketsVerified: 1,
    bufferBytes: smallBytes.length,
    multipartBytes: multipartBytes.length,
    orphanMultipartUploads: 0,
    objectResidue: 0,
    durationMs: Date.now() - startedAt,
  };
} catch (error) {
  primaryFailure = error;
} finally {
  const finalCleanup = await cleanupSyntheticQuarantineObjects({
    keys: cleanupCandidates,
    head: (key) => storage.head(key),
    remove: (key, expectedEtag) =>
      storage.deleteQuarantine({ key, expectedEtag }),
  });
  for (const suffix of finalCleanup.unresolved) {
    console.error(
      `Cleanup requires operator attention for synthetic key suffix ${suffix}.`,
    );
  }
  client.destroy();
  const cleanupFailure =
    finalCleanup.unresolved.length !== 0
      ? new Error(
      `synthetic probe final cleanup left ${finalCleanup.unresolved.length} unresolved object(s)`,
        )
      : null;
  const failure = combineLiveProbeFailures(primaryFailure, cleanupFailure);
  if (failure) {
    throw failure;
  }
}

if (!successEvidence) {
  throw new Error("R2 development probe produced no success evidence");
}
console.log(JSON.stringify(successEvidence));
