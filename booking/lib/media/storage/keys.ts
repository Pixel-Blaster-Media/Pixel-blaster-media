import { randomUUID } from "node:crypto";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const EXTENSIONS = new Set(["bin", "jpg", "png", "webp"]);
const PACKAGE_TYPES = new Set(["full_res_zip", "mls_zip", "web_zip", "custom_zip"]);
const MAX_KEY_BYTES = 1024;

export type MediaObjectClass = "quarantine" | "masters" | "derivatives" | "packages";
export type MediaBucketClass = "quarantine" | "masters" | "delivery";
declare const mediaObjectKeyBrand: unique symbol;
export type MediaObjectKey = string & { readonly [mediaObjectKeyBrand]: "canonical-media-object-key" };
export type MediaExtension = "bin" | "jpg" | "png" | "webp";
export type MediaPackageType = "full_res_zip" | "mls_zip" | "web_zip" | "custom_zip";

function uuidV4(value: string, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new Error(`${label} must be a lowercase UUID v4`);
  }
  return value;
}

function sha256Hex(value: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error("sha256 must be 64 lowercase hexadecimal characters");
  }
  return value;
}

function extension(value: string): MediaExtension {
  if (!EXTENSIONS.has(value)) throw new Error("media extension is not allowed");
  return value as MediaExtension;
}

function packageType(value: string): MediaPackageType {
  if (!PACKAGE_TYPES.has(value)) throw new Error("package type is not allowed");
  return value as MediaPackageType;
}

function assertSafeRawKey(key: string): string[] {
  if (typeof key !== "string" || key.length < 1 || Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES) {
    throw new Error("unsafe media object key");
  }
  if (
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("?") ||
    key.includes("#") ||
    /[\u0000-\u001f\u007f]/.test(key)
  ) {
    throw new Error("unsafe media object key");
  }
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("unsafe media object key");
  }
  return segments;
}

function checksumFilename(value: string, allowedExtension: MediaExtension | "zip"): string {
  const separator = value.lastIndexOf(".");
  if (separator < 1) throw new Error("media object key has an invalid checksum filename");
  const digest = value.slice(0, separator);
  const suffix = value.slice(separator + 1);
  sha256Hex(digest);
  if (suffix !== allowedExtension) throw new Error("media object key has an invalid extension");
  return digest;
}

export function buildQuarantineKey(organizationId: string, ingestJobId: string): MediaObjectKey {
  return `quarantine/${uuidV4(organizationId, "organizationId")}/${uuidV4(ingestJobId, "ingestJobId")}/${randomUUID()}` as MediaObjectKey;
}

export function buildMasterKey(
  organizationId: string,
  assetId: string,
  versionId: string,
  sha256: string,
  mediaExtension: string,
): MediaObjectKey {
  return `masters/${uuidV4(organizationId, "organizationId")}/${uuidV4(assetId, "assetId")}/${uuidV4(versionId, "versionId")}/${sha256Hex(sha256)}.${extension(mediaExtension)}` as MediaObjectKey;
}

export function buildDerivativeKey(
  organizationId: string,
  versionId: string,
  profileVersion: number,
  sha256: string,
  mediaExtension: string,
): MediaObjectKey {
  if (!Number.isSafeInteger(profileVersion) || profileVersion < 1 || profileVersion > 2_147_483_647) {
    throw new Error("profileVersion must be a positive safe integer");
  }
  return `derivatives/${uuidV4(organizationId, "organizationId")}/${uuidV4(versionId, "versionId")}/${profileVersion}/${sha256Hex(sha256)}.${extension(mediaExtension)}` as MediaObjectKey;
}

export function buildPackageKey(
  organizationId: string,
  releaseId: string,
  requestedPackageType: string,
  manifestSha256: string,
): MediaObjectKey {
  return `packages/${uuidV4(organizationId, "organizationId")}/${uuidV4(releaseId, "releaseId")}/${packageType(requestedPackageType)}/${sha256Hex(manifestSha256)}.zip` as MediaObjectKey;
}

export function inspectMediaObjectKey(
  key: string,
  expectedOrganizationId: string,
): {
  key: MediaObjectKey;
  objectClass: MediaObjectClass;
  bucketClass: MediaBucketClass;
  organizationId: string;
  sha256: string | null;
} {
  const organizationId = uuidV4(expectedOrganizationId, "expectedOrganizationId");
  const segments = assertSafeRawKey(key);
  if (segments[1] !== organizationId) throw new Error("media object key is outside the bound organization");

  if (segments[0] === "quarantine") {
    if (segments.length !== 4) throw new Error("quarantine object key has an invalid shape");
    uuidV4(segments[1], "organizationId");
    uuidV4(segments[2], "ingestJobId");
    uuidV4(segments[3], "randomObjectId");
    return { key: key as MediaObjectKey, objectClass: "quarantine", bucketClass: "quarantine", organizationId, sha256: null };
  }

  if (segments[0] === "masters") {
    if (segments.length !== 5) throw new Error("master object key has an invalid shape");
    uuidV4(segments[1], "organizationId");
    uuidV4(segments[2], "assetId");
    uuidV4(segments[3], "versionId");
    const suffix = segments[4].slice(segments[4].lastIndexOf(".") + 1);
    const sha256 = checksumFilename(segments[4], extension(suffix));
    return { key: key as MediaObjectKey, objectClass: "masters", bucketClass: "masters", organizationId, sha256 };
  }

  if (segments[0] === "derivatives") {
    if (segments.length !== 5) throw new Error("derivative object key has an invalid shape");
    uuidV4(segments[1], "organizationId");
    uuidV4(segments[2], "versionId");
    const profileVersion = Number(segments[3]);
    if (!Number.isSafeInteger(profileVersion) || profileVersion < 1 || String(profileVersion) !== segments[3]) {
      throw new Error("derivative object key has an invalid profile version");
    }
    const suffix = segments[4].slice(segments[4].lastIndexOf(".") + 1);
    const sha256 = checksumFilename(segments[4], extension(suffix));
    return { key: key as MediaObjectKey, objectClass: "derivatives", bucketClass: "delivery", organizationId, sha256 };
  }

  if (segments[0] === "packages") {
    if (segments.length !== 5) throw new Error("package object key has an invalid shape");
    uuidV4(segments[1], "organizationId");
    uuidV4(segments[2], "releaseId");
    packageType(segments[3]);
    const sha256 = checksumFilename(segments[4], "zip");
    return { key: key as MediaObjectKey, objectClass: "packages", bucketClass: "delivery", organizationId, sha256 };
  }

  throw new Error("media object key has an unsupported class");
}
