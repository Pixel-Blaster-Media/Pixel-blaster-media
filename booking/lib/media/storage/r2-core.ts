import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { isProxy } from "node:util/types";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

import { inspectMediaObjectKey, type MediaBucketClass, type MediaObjectKey } from "./keys.ts";

const SHA256 = /^[0-9a-f]{64}$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const ETAG = /^(?:W\/)?"[^"\r\n]{1,126}"$/;
const MAX_BUFFER_BYTES = 100 * 1024 * 1024;
const MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_PART_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10_000;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "application/zip",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type S3CommandClient = Pick<S3Client, "send">;

type StorageBuckets = Readonly<{
  quarantine: string;
  masters: string;
  delivery: string;
}>;

function safeSha256(value: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error("sha256 must be 64 lowercase hexadecimal characters");
  }
  return value;
}

function safeContentType(value: string): string {
  if (!ALLOWED_CONTENT_TYPES.has(value)) throw new Error("content type is not allowed");
  return value;
}

function safeBucket(value: string): string {
  if (typeof value !== "string" || !BUCKET.test(value)) throw new Error("R2 bucket name is invalid");
  return value;
}

function safeEtag(value: string): string {
  if (typeof value !== "string" || !ETAG.test(value)) throw new Error("expectedEtag is invalid");
  return value;
}

function preconditionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "PreconditionFailed" || candidate.$metadata?.httpStatusCode === 412;
}

function abortReason(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new Error("storage operation aborted");
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

export class R2Storage {
  private readonly client: S3CommandClient;
  private readonly organizationId: string;
  private readonly buckets: StorageBuckets;

  constructor({
    client,
    organizationId,
    buckets,
  }: {
    client: S3CommandClient;
    organizationId: string;
    buckets: StorageBuckets;
  }) {
    if (!client || typeof client.send !== "function") throw new Error("R2 client must implement send(command)");
    inspectMediaObjectKey(`quarantine/${organizationId}/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000`, organizationId);
    this.client = client;
    this.organizationId = organizationId;
    this.buckets = Object.freeze({
      quarantine: safeBucket(buckets.quarantine),
      masters: safeBucket(buckets.masters),
      delivery: safeBucket(buckets.delivery),
    });
  }

  private resolve(key: MediaObjectKey): {
    key: MediaObjectKey;
    bucket: string;
    bucketClass: MediaBucketClass;
    objectClass: "quarantine" | "masters" | "derivatives" | "packages";
    keySha256: string | null;
  } {
    const parsed = inspectMediaObjectKey(key, this.organizationId);
    return {
      key: parsed.key,
      bucket: this.buckets[parsed.bucketClass],
      bucketClass: parsed.bucketClass,
      objectClass: parsed.objectClass,
      keySha256: parsed.sha256,
    };
  }

  private assertChecksumBinding(keySha256: string | null, expected: string): void {
    if (keySha256 !== null && keySha256 !== expected) {
      throw new Error("object key must be checksum-addressed to the expected sha256");
    }
  }

  async putBufferCreateOnly({
    key,
    bytes,
    contentType,
    sha256,
    signal,
  }: {
    key: MediaObjectKey;
    bytes: Buffer;
    contentType: string;
    sha256: string;
    signal?: AbortSignal;
  }): Promise<{ etag: string | null; bytes: number; sha256: string }> {
    const location = this.resolve(key);
    const expected = safeSha256(sha256);
    this.assertChecksumBinding(location.keySha256, expected);
    safeContentType(contentType);
    if (!Buffer.isBuffer(bytes) || isProxy(bytes) || bytes.length < 1) {
      throw new Error("bytes must be a non-empty non-Proxy Buffer");
    }
    if (bytes.length > MAX_BUFFER_BYTES) {
      throw new Error("buffer upload exceeds 100 MiB; multipart upload is required");
    }
    const payload = Buffer.from(bytes);
    if (createHash("sha256").update(payload).digest("hex") !== expected) throw new Error("upload checksum mismatch");
    assertNotAborted(signal);

    try {
      const result = await this.client.send(
        new PutObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
          Body: payload,
          ContentLength: payload.length,
          ContentType: contentType,
          Metadata: { sha256: expected },
          IfNoneMatch: "*",
        }),
        { abortSignal: signal },
      );
      return { etag: result.ETag ?? null, bytes: payload.length, sha256: expected };
    } catch (error) {
      if (preconditionFailure(error)) throw new Error("immutable object already exists", { cause: error });
      throw error;
    }
  }

  async putMultipartCreateOnly({
    key,
    parts,
    contentType,
    sha256,
    expectedBytes,
    signal,
  }: {
    key: MediaObjectKey;
    parts: Iterable<Buffer> | AsyncIterable<Buffer>;
    contentType: string;
    sha256: string;
    expectedBytes: number;
    signal?: AbortSignal;
  }): Promise<{ etag: string | null; bytes: number; sha256: string; parts: number }> {
    const location = this.resolve(key);
    const expected = safeSha256(sha256);
    this.assertChecksumBinding(location.keySha256, expected);
    safeContentType(contentType);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) throw new Error("expectedBytes must be a positive safe integer");
    assertNotAborted(signal);

    const created = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: location.bucket,
        Key: location.key,
        ContentType: contentType,
        Metadata: { sha256: expected },
      }),
      { abortSignal: signal },
    );
    if (!created.UploadId) throw new Error("R2 did not return a multipart upload ID");
    const uploadId = created.UploadId;
    const completedParts: Array<{ ETag: string; PartNumber: number }> = [];
    const hash = createHash("sha256");
    let bytesUploaded = 0;
    let pending: Buffer | null = null;
    let remoteCompleted = false;
    let nonFinalPartBytes: number | null = null;

    const uploadPart = async (part: Buffer, isLast: boolean): Promise<void> => {
      assertNotAborted(signal);
      if (!Buffer.isBuffer(part) || isProxy(part) || part.length < 1) throw new Error("multipart parts must be non-empty non-Proxy Buffers");
      if (!isLast && part.length < MIN_MULTIPART_PART_BYTES) throw new Error("every non-final multipart part must be at least 5 MiB");
      if (!isLast && nonFinalPartBytes !== null && part.length !== nonFinalPartBytes) {
        throw new Error("all non-final multipart parts must have equal byte lengths");
      }
      if (!isLast) nonFinalPartBytes = part.length;
      if (part.length > MAX_MULTIPART_PART_BYTES) throw new Error("multipart part exceeds 5 GiB");
      if (completedParts.length >= MAX_MULTIPART_PARTS) throw new Error("multipart upload exceeds 10,000 parts");
      const partNumber = completedParts.length + 1;
      const snapshot = Buffer.from(part);
      hash.update(snapshot);
      bytesUploaded += snapshot.length;
      if (bytesUploaded > expectedBytes) throw new Error("multipart byte length exceeds expectedBytes");
      const uploaded = await this.client.send(
        new UploadPartCommand({
          Bucket: location.bucket,
          Key: location.key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: snapshot,
          ContentLength: snapshot.length,
        }),
        { abortSignal: signal },
      );
      if (!uploaded.ETag) throw new Error("R2 multipart part is missing an ETag");
      completedParts.push({ ETag: uploaded.ETag, PartNumber: partNumber });
    };

    try {
      for await (const part of parts) {
        if (!Buffer.isBuffer(part) || isProxy(part) || part.length < 1) {
          throw new Error("multipart parts must be non-empty non-Proxy Buffers");
        }
        const snapshot = Buffer.from(part);
        if (pending !== null) await uploadPart(pending, false);
        pending = snapshot;
      }
      if (pending === null) throw new Error("multipart upload requires at least one part");
      await uploadPart(pending, true);
      if (bytesUploaded !== expectedBytes) throw new Error("multipart byte length mismatch");
      if (hash.digest("hex") !== expected) throw new Error("multipart checksum mismatch");
      assertNotAborted(signal);

      const completed = await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: location.bucket,
          Key: location.key,
          UploadId: uploadId,
          MultipartUpload: { Parts: completedParts },
          IfNoneMatch: "*",
        }),
        { abortSignal: signal },
      );
      remoteCompleted = true;
      const verified = await this.head(location.key, signal);
      if (verified.bytes !== expectedBytes || verified.sha256 !== expected) {
        throw new Error("completed multipart object failed HEAD verification");
      }
      return { etag: completed.ETag ?? verified.etag, bytes: bytesUploaded, sha256: expected, parts: completedParts.length };
    } catch (error) {
      if (remoteCompleted) {
        throw new Error("multipart object completed but verification failed; reconciliation is required", { cause: error });
      }
      try {
        await this.client.send(new AbortMultipartUploadCommand({
          Bucket: location.bucket,
          Key: location.key,
          UploadId: uploadId,
        }));
      } catch (abortError) {
        throw new AggregateError([error, abortError], "multipart upload failed and cleanup could not be confirmed");
      }
      if (preconditionFailure(error)) throw new Error("immutable object already exists", { cause: error });
      throw error;
    }
  }

  async head(key: MediaObjectKey, signal?: AbortSignal): Promise<{
    bytes: number;
    contentType: string | null;
    sha256: string;
    etag: string | null;
  }> {
    const location = this.resolve(key);
    assertNotAborted(signal);
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: location.bucket, Key: location.key }),
      { abortSignal: signal },
    );
    const sha256 = safeSha256(result.Metadata?.sha256 ?? "");
    this.assertChecksumBinding(location.keySha256, sha256);
    if (!Number.isSafeInteger(result.ContentLength) || (result.ContentLength ?? 0) < 1) {
      throw new Error("stored object is missing a valid byte length");
    }
    return {
      bytes: result.ContentLength as number,
      contentType: result.ContentType ?? null,
      sha256,
      etag: result.ETag ?? null,
    };
  }

  async getVerified(key: MediaObjectKey, signal?: AbortSignal): Promise<{
    body: Transform;
    bytes: number;
    contentType: string | null;
    sha256: string;
  }> {
    const location = this.resolve(key);
    assertNotAborted(signal);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: location.bucket, Key: location.key }),
      { abortSignal: signal },
    );
    const body = result.Body as unknown as NodeJS.ReadableStream & { destroy(error?: Error): void; destroyed?: boolean };
    if (!body || typeof body.pipe !== "function" || typeof body.destroy !== "function") {
      throw new Error("stored object has no destroyable Node.js readable body");
    }

    let expected: string;
    let expectedBytes: number;
    try {
      expected = safeSha256(result.Metadata?.sha256 ?? "");
      this.assertChecksumBinding(location.keySha256, expected);
      if (!Number.isSafeInteger(result.ContentLength) || (result.ContentLength ?? 0) < 1) {
        throw new Error("stored object is missing a valid byte length");
      }
      expectedBytes = result.ContentLength as number;
    } catch (error) {
      body.destroy(error instanceof Error ? error : undefined);
      throw error;
    }

    const hash = createHash("sha256");
    let bytesRead = 0;
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesRead += chunk.length;
        if (bytesRead > expectedBytes) return callback(new Error("download byte length mismatch"));
        hash.update(chunk);
        callback(null, chunk);
      },
      flush(callback) {
        if (bytesRead !== expectedBytes) return callback(new Error("download byte length mismatch"));
        if (hash.digest("hex") !== expected) return callback(new Error("download checksum mismatch"));
        callback();
      },
    });
    const abortListener = () => verifier.destroy(abortReason(signal));
    signal?.addEventListener("abort", abortListener, { once: true });
    verifier.once("close", () => {
      signal?.removeEventListener("abort", abortListener);
      if (!body.destroyed) body.destroy();
    });
    body.once("error", (error: Error) => verifier.destroy(error));
    body.pipe(verifier);
    return { body: verifier, bytes: expectedBytes, contentType: result.ContentType ?? null, sha256: expected };
  }

  async deleteQuarantine({
    key,
    expectedEtag,
    signal,
  }: {
    key: MediaObjectKey;
    expectedEtag: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const location = this.resolve(key);
    if (location.objectClass !== "quarantine") throw new Error("only quarantine objects may be deleted through this boundary");
    const etag = safeEtag(expectedEtag);
    assertNotAborted(signal);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
          IfMatch: etag,
        }),
        { abortSignal: signal },
      );
    } catch (error) {
      if (preconditionFailure(error)) throw new Error("quarantine delete precondition failed", { cause: error });
      throw error;
    }
  }
}
