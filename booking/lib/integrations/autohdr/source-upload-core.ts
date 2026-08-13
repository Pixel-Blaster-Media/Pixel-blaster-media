import { buildMasterKey, inspectMediaObjectKey } from "../../media/storage/keys.ts";
import type { AutoHDRCanonicalSource } from "./database-contract.ts";
import { AUTOHDR_SOURCE_MAX_FILE_BYTES } from "./source-limits.ts";

const SHA256 = /^[0-9a-f]{64}$/;
const PRIVATE_BUCKET = "pixel-blaster-private-media";

export type CanonicalSourceContentType = "image/jpeg" | "image/png";

export function canonicalSourceExtension(contentType: string): "jpg" | "png" {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  throw new Error("Canonical source content type must be image/jpeg or image/png.");
}

export function isCanonicalBrowserUploadEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return env.MEDIA_R2_BROWSER_UPLOADS_ENABLED === "true" &&
    env.AUTOHDR_QUARANTINE_WORKFLOW_ENABLED === "true";
}

export function buildCanonicalSourcePutInput(input: {
  organizationId: string;
  mediaAssetId: string;
  sourceMediaVersionId: string;
  objectKey: string;
  byteSize: number;
  contentType: string;
  sha256: string;
  bucket: string;
}) {
  if (input.bucket !== PRIVATE_BUCKET) throw new Error("Canonical sources require the exact private media bucket.");
  const contentType = input.contentType as CanonicalSourceContentType;
  const expectedKey = buildMasterKey(
    input.organizationId,
    input.mediaAssetId,
    input.sourceMediaVersionId,
    input.sha256,
    canonicalSourceExtension(contentType),
  );
  if (input.objectKey !== expectedKey) {
    throw new Error("Canonical source key or extension does not match its exact identity and content type.");
  }
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > AUTOHDR_SOURCE_MAX_FILE_BYTES) {
    throw new Error("Canonical source byte size is invalid.");
  }
  if (!SHA256.test(input.sha256)) throw new Error("Canonical source checksum is invalid.");
  return {
    Bucket: input.bucket,
    Key: expectedKey,
    ContentLength: input.byteSize,
    ContentType: contentType,
    Metadata: { sha256: input.sha256 },
    IfNoneMatch: "*",
  };
}

export function buildQuarantineSourcePutInput(input: {
  organizationId: string;
  ingestJobId: string;
  quarantineObjectKey: string;
  objectKey: string;
  mediaAssetId: string;
  sourceMediaVersionId: string;
  byteSize: number;
  contentType: string;
  sha256: string;
  bucket: string;
}) {
  buildCanonicalSourcePutInput({
    organizationId: input.organizationId,
    mediaAssetId: input.mediaAssetId,
    sourceMediaVersionId: input.sourceMediaVersionId,
    objectKey: input.objectKey,
    byteSize: input.byteSize,
    contentType: input.contentType,
    sha256: input.sha256,
    bucket: input.bucket,
  });
  const parsed = inspectMediaObjectKey(input.quarantineObjectKey, input.organizationId);
  if (
    parsed.objectClass !== "quarantine" ||
    !input.quarantineObjectKey.startsWith(
      `quarantine/${input.organizationId}/${input.ingestJobId}/`,
    )
  ) {
    throw new Error("Canonical source quarantine key does not match its exact tenant and ingest identity.");
  }
  return {
    Bucket: input.bucket,
    Key: parsed.key,
    ContentLength: input.byteSize,
    ContentType: input.contentType as CanonicalSourceContentType,
    Metadata: { sha256: input.sha256 },
    IfNoneMatch: "*",
  };
}

export function validateCanonicalSourceUpload(
  source: Pick<AutoHDRCanonicalSource, "mediaAssetId" | "sourceMediaVersionId" | "objectKey" | "byteSize" | "contentType" | "sha256"> & { organizationId: string },
  head: { bytes: number; contentType: string | null; sha256: string; etag: string | null },
): void {
  buildCanonicalSourcePutInput({
    organizationId: source.organizationId,
    mediaAssetId: source.mediaAssetId,
    sourceMediaVersionId: source.sourceMediaVersionId,
    objectKey: source.objectKey,
    byteSize: source.byteSize,
    contentType: source.contentType,
    sha256: source.sha256,
    bucket: PRIVATE_BUCKET,
  });
  if (
    head.bytes !== source.byteSize ||
    head.contentType !== source.contentType ||
    head.sha256 !== source.sha256
  ) {
    throw new Error("Canonical source HEAD did not match the prepared upload.");
  }
}
