const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const DEVELOPMENT_BUCKET = "pixel-blaster-dev-synthetic-media" as const;

export interface DevelopmentMediaStorageConfig {
  readonly enabled: boolean;
  readonly environment: "development";
  readonly endpoint: string;
  readonly region: "auto";
  readonly credentials: Readonly<{
    accessKeyId: string;
    secretAccessKey: string;
  }>;
  readonly bucket: typeof DEVELOPMENT_BUCKET;
}

function required(env: NodeJS.ProcessEnv | Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new Error(`${name} is required and must be bounded`);
  }
  if (value.trim() !== value) throw new Error(`${name} must not contain surrounding whitespace`);
  return value;
}

export function copyMediaStorageCredentialsForSdk(
  credentials: DevelopmentMediaStorageConfig["credentials"],
): { accessKeyId: string; secretAccessKey: string } {
  return {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
  };
}

export function loadDevelopmentMediaStorageConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): DevelopmentMediaStorageConfig {
  if (required(env, "MEDIA_STORAGE_ENVIRONMENT") !== "development") {
    throw new Error("canonical media storage is restricted to the development environment");
  }
  if (env.VERCEL_ENV === "production") {
    throw new Error("development R2 storage cannot run in a Vercel production environment");
  }

  const enabledValue = required(env, "MEDIA_STORAGE_ENABLED");
  if (enabledValue !== "false" && enabledValue !== "true") {
    throw new Error("MEDIA_STORAGE_ENABLED must be exactly true or false");
  }
  const enabled = enabledValue === "true";
  if (enabled && env.MEDIA_STORAGE_LIVE_PROBE_ACK !== "development-synthetic-only") {
    throw new Error("live development storage remains disabled without the synthetic-only acknowledgement");
  }

  const accountId = required(env, "MEDIA_R2_ACCOUNT_ID");
  if (!ACCOUNT_ID.test(accountId)) throw new Error("MEDIA_R2_ACCOUNT_ID must be 32 lowercase hexadecimal characters");
  const accessKeyId = required(env, "MEDIA_R2_ACCESS_KEY_ID");
  const secretAccessKey = required(env, "MEDIA_R2_SECRET_ACCESS_KEY");
  const bucket = required(env, "MEDIA_R2_BUCKET");
  if (bucket !== DEVELOPMENT_BUCKET || bucket.includes("production")) {
    throw new Error(`MEDIA_R2_BUCKET must name the exact private development bucket ${DEVELOPMENT_BUCKET}`);
  }

  const config: DevelopmentMediaStorageConfig = {
    enabled,
    environment: "development",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: Object.freeze({ accessKeyId, secretAccessKey }),
    bucket,
  };
  return Object.freeze(config);
}
