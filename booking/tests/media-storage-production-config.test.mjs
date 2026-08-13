import assert from "node:assert/strict";
import test from "node:test";

import { loadProductionMediaStorageConfig } from "../lib/media/storage/config-values.ts";

const productionEnv = {
  MEDIA_STORAGE_ENABLED: "true",
  MEDIA_STORAGE_ENVIRONMENT: "production",
  MEDIA_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  MEDIA_R2_ACCESS_KEY_ID: "production-access-key",
  MEDIA_R2_SECRET_ACCESS_KEY: "production-secret-key",
  MEDIA_R2_BUCKET: "pixel-blaster-private-media",
  VERCEL_ENV: "production",
};

test("loads only the exact private production media bucket", () => {
  const config = loadProductionMediaStorageConfig(productionEnv);
  assert.equal(config.enabled, true);
  assert.equal(config.environment, "production");
  assert.equal(config.bucket, "pixel-blaster-private-media");
  assert.equal(config.endpoint, "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.credentials));
});

test("production media storage fails closed outside Vercel production", () => {
  assert.throws(
    () => loadProductionMediaStorageConfig({ ...productionEnv, VERCEL_ENV: "preview" }),
    /Vercel production/i,
  );
  assert.throws(
    () => loadProductionMediaStorageConfig({ ...productionEnv, MEDIA_STORAGE_ENABLED: "false" }),
    /must be enabled/i,
  );
});

test("production media storage rejects development or alternate buckets", () => {
  assert.throws(
    () =>
      loadProductionMediaStorageConfig({
        ...productionEnv,
        MEDIA_R2_BUCKET: "pixel-blaster-dev-synthetic-media",
      }),
    /exact private production bucket/i,
  );
  assert.throws(
    () => loadProductionMediaStorageConfig({ ...productionEnv, MEDIA_R2_BUCKET: "other-private" }),
    /exact private production bucket/i,
  );
});
