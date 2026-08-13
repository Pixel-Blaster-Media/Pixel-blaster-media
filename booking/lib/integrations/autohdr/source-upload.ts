import "server-only";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  copyMediaStorageCredentialsForSdk,
  loadProductionMediaStorageConfig,
} from "../../media/storage/config-values";
import type { AutoHDRCanonicalSource } from "./database-contract";
import {
  buildCanonicalSourcePutInput,
  isCanonicalBrowserUploadEnabled,
  type CanonicalSourceContentType,
} from "./source-upload-core";

const EXPIRES_SECONDS = 300;

export type CanonicalSourcePreparedUpload = AutoHDRCanonicalSource & Readonly<{
  upload: Readonly<{
    url: string;
    method: "PUT";
    headers: Readonly<{
      "Content-Type": CanonicalSourceContentType;
      "If-None-Match": "*";
      "x-amz-meta-sha256": string;
    }>;
  }>;
}>;

export async function presignCanonicalAutoHDRSources(
  organizationId: string,
  sources: AutoHDRCanonicalSource[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<CanonicalSourcePreparedUpload[]> {
  if (!isCanonicalBrowserUploadEnabled(env)) {
    throw new Error("Canonical browser uploads are disabled until production R2 CORS is verified.");
  }
  const config = loadProductionMediaStorageConfig(env);
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: copyMediaStorageCredentialsForSdk(config.credentials),
    forcePathStyle: false,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return Promise.all(sources.map(async (source) => {
    const command = new PutObjectCommand(buildCanonicalSourcePutInput({
      organizationId,
      mediaAssetId: source.mediaAssetId,
      sourceMediaVersionId: source.sourceMediaVersionId,
      objectKey: source.objectKey,
      byteSize: source.byteSize,
      contentType: source.contentType,
      sha256: source.sha256,
      bucket: config.bucket,
    }));
    const url = await getSignedUrl(client, command, {
      expiresIn: EXPIRES_SECONDS,
      signableHeaders: new Set(["content-type", "if-none-match", "x-amz-meta-sha256"]),
      unhoistableHeaders: new Set(["if-none-match", "x-amz-meta-sha256"]),
    });
    validatePresignedUrl(url, config.endpoint);
    return Object.freeze({
      ...source,
      upload: Object.freeze({
        url,
        method: "PUT" as const,
        headers: Object.freeze({
          "Content-Type": source.contentType,
          "If-None-Match": "*" as const,
          "x-amz-meta-sha256": source.sha256,
        }),
      }),
    });
  }));
}

function validatePresignedUrl(value: string, endpoint: string): void {
  const url = new URL(value);
  const endpointUrl = new URL(endpoint);
  const expiry = Number(url.searchParams.get("X-Amz-Expires"));
  const signedHeaders = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
  const expectedSignedHeaders = [
    "content-length",
    "content-type",
    "host",
    "if-none-match",
    "x-amz-meta-sha256",
  ];
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(`.${endpointUrl.hostname}`) ||
    url.username ||
    url.password ||
    !Number.isSafeInteger(expiry) ||
    expiry < 1 ||
    expiry > EXPIRES_SECONDS ||
    signedHeaders.join("\n") !== expectedSignedHeaders.join("\n") ||
    url.searchParams.has("x-amz-meta-sha256") ||
    url.searchParams.has("x-amz-checksum-crc32") ||
    url.searchParams.has("x-amz-sdk-checksum-algorithm")
  ) {
    throw new Error("Canonical source presigned upload is invalid.");
  }
}
