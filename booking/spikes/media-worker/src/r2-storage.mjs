import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { isProxy } from "node:util/types";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import { sha256Hex } from "./pipeline.mjs";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const OBJECT_CLASSES = new Set(["quarantine", "masters", "derivatives", "packages"]);
const MAX_BUFFER_BYTES = 100 * 1024 * 1024;
const CONTENT_TYPES = new Set([
  "application/octet-stream",
  "application/zip",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function parseBoundKey(key, organizationId) {
  if (typeof key !== "string" || key.length < 1 || key.length > 1024) throw new Error("unsafe object key");
  if (key.startsWith("/") || key.includes("\\") || key.includes("?") || key.includes("#") || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new Error("unsafe object key");
  }
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("unsafe object key");
  if (!OBJECT_CLASSES.has(segments[0]) || segments[1] !== organizationId) {
    throw new Error("object key is outside the bound organization prefix");
  }
  return { key, filename: segments.at(-1) };
}

function safeSha256(value) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error("sha256 must be lowercase hexadecimal");
  return value;
}

function assertChecksumAddressed(filename, sha256) {
  const separator = filename.indexOf(".");
  const stem = separator === -1 ? filename : filename.slice(0, separator);
  if (stem !== sha256) throw new Error("object key must be checksum-addressed");
}

function preconditionFailure(error) {
  return error?.name === "PreconditionFailed" || error?.$metadata?.httpStatusCode === 412;
}

export class R2Storage {
  constructor({ client, bucket, organizationId }) {
    if (!client || typeof client.send !== "function") throw new Error("client must implement send(command)");
    if (typeof bucket !== "string" || !BUCKET.test(bucket)) throw new Error("bucket name is invalid");
    if (typeof organizationId !== "string" || !UUID_V4.test(organizationId)) throw new Error("organizationId must be a UUID v4");
    this.client = client;
    this.bucket = bucket;
    this.organizationId = organizationId;
  }

  async putBuffer({ key, bytes, contentType, sha256 }) {
    const parsed = parseBoundKey(key, this.organizationId);
    const expected = safeSha256(sha256);
    if (!Buffer.isBuffer(bytes) || isProxy(bytes) || bytes.length === 0) throw new Error("bytes must be a non-empty non-Proxy Buffer");
    if (bytes.length > MAX_BUFFER_BYTES) throw new Error("buffer upload exceeds the 100 MiB limit; multipart upload is required");
    if (!CONTENT_TYPES.has(contentType)) throw new Error("content type is not allowed");
    const payload = Buffer.from(bytes);
    if (sha256Hex(payload) !== expected) throw new Error("checksum mismatch");
    assertChecksumAddressed(parsed.filename, expected);

    try {
      const result = await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: parsed.key,
        Body: payload,
        ContentLength: payload.length,
        ContentType: contentType,
        Metadata: { sha256: expected },
        IfNoneMatch: "*",
      }));
      return { etag: result.ETag ?? null, bytes: payload.length, sha256: expected };
    } catch (error) {
      if (preconditionFailure(error)) throw new Error("immutable object already exists");
      throw error;
    }
  }

  async head(key) {
    const parsed = parseBoundKey(key, this.organizationId);
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: parsed.key }));
    const sha256 = result.Metadata?.sha256;
    if (!sha256 || !SHA256.test(sha256)) throw new Error("stored object is missing valid checksum metadata");
    assertChecksumAddressed(parsed.filename, sha256);
    if (!Number.isSafeInteger(result.ContentLength) || result.ContentLength < 1) throw new Error("stored object is missing a valid length");
    return { bytes: result.ContentLength, contentType: result.ContentType ?? null, sha256 };
  }

  async getVerified(key) {
    const parsed = parseBoundKey(key, this.organizationId);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: parsed.key }));
    const expected = result.Metadata?.sha256;
    if (!result.Body || typeof result.Body.pipe !== "function" || typeof result.Body.destroy !== "function") {
      throw new Error("stored object has no destroyable readable body");
    }
    try {
      if (!expected || !SHA256.test(expected)) throw new Error("stored object is missing valid checksum metadata");
      assertChecksumAddressed(parsed.filename, expected);
      if (!Number.isSafeInteger(result.ContentLength) || result.ContentLength < 1) throw new Error("stored object is missing a valid length");
    } catch (error) {
      result.Body.destroy();
      throw error;
    }

    const hash = createHash("sha256");
    let bytesRead = 0;
    const verifier = new Transform({
      transform(chunk, _encoding, callback) {
        bytesRead += chunk.length;
        if (bytesRead > result.ContentLength) return callback(new Error("download length mismatch"));
        hash.update(chunk);
        callback(null, chunk);
      },
      flush(callback) {
        if (bytesRead !== result.ContentLength) return callback(new Error("download length mismatch"));
        if (hash.digest("hex") !== expected) return callback(new Error("download checksum mismatch"));
        callback();
      },
    });
    verifier.once("close", () => {
      if (!result.Body.destroyed) result.Body.destroy();
    });
    result.Body.once("error", (error) => verifier.destroy(error));
    result.Body.pipe(verifier);
    return { body: verifier, bytes: result.ContentLength, sha256: expected };
  }
}
