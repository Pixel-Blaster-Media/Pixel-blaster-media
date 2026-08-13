import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

import {
  copyMediaStorageCredentialsForSdk,
  loadDevelopmentMediaStorageConfig,
  loadProductionMediaStorageConfig,
} from "./config-values.ts";
import { R2Storage } from "./r2-core.ts";

export function createDevelopmentR2Storage(
  organizationId: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): R2Storage {
  const config = loadDevelopmentMediaStorageConfig(env);
  if (!config.enabled) {
    throw new Error("development R2 storage is disabled; no remote media operation was attempted");
  }
  return createR2Storage(organizationId, config);
}

export function createProductionR2Storage(
  organizationId: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): R2Storage {
  return createR2Storage(organizationId, loadProductionMediaStorageConfig(env));
}

function createR2Storage(
  organizationId: string,
  config: {
    endpoint: string;
    region: "auto";
    credentials: Readonly<{ accessKeyId: string; secretAccessKey: string }>;
    bucket: string;
  },
): R2Storage {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: copyMediaStorageCredentialsForSdk(config.credentials),
    forcePathStyle: false,
    maxAttempts: 3,
  });
  return new R2Storage({
    client,
    organizationId,
    buckets: {
      quarantine: config.bucket,
      masters: config.bucket,
      delivery: config.bucket,
    },
  });
}
