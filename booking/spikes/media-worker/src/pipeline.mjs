import { createHash } from "node:crypto";
import { Transform, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { isProxy } from "node:util/types";

import { ZipArchive } from "archiver";
import sharp from "sharp";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const PROFILE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const REQUIRED_MEDIA_IDS = ["organizationId", "ingestJobId", "assetId", "versionId", "releaseId"];
const FIXED_ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");
const RESERVED_MANIFEST_NAME = "release-manifest.json";
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 100_000_000;
const MAX_ARCHIVE_ENTRIES = 500;
const MAX_ARCHIVE_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_INPUT_BYTES = 20 * 1024 ** 3;
const MAX_BUFFERED_ZIP_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function createSyntheticSource({ width, height, seed }) {
  if (!Number.isInteger(width) || width < 1 || width > 10_000) throw new Error("width must be an integer from 1 to 10000");
  if (!Number.isInteger(height) || height < 1 || height > 10_000) throw new Error("height must be an integer from 1 to 10000");
  if (!Number.isInteger(seed)) throw new Error("seed must be an integer");
  if (width * height > MAX_IMAGE_PIXELS) throw new Error("synthetic image exceeds the pixel limit");

  const raw = Buffer.allocUnsafe(width * height * 3);
  for (let index = 0; index < raw.length; index += 3) {
    const pixel = index / 3;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    raw[index] = (x * 13 + y * 3 + seed * 17) % 256;
    raw[index + 1] = (x * 5 + y * 11 + seed * 29) % 256;
    raw[index + 2] = (x * 7 + y * 19 + seed * 31) % 256;
  }

  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: false })
    .toBuffer();
}

async function output(bytes, profile, pipeline) {
  const transformed = await pipeline(sharp(bytes, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS }).rotate()).toBuffer();
  const metadata = await sharp(transformed, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  if (metadata.format !== "jpeg" || !metadata.width || !metadata.height) {
    throw new Error(`${profile} did not produce a measurable JPEG`);
  }
  return {
    profile,
    bytes: transformed,
    sha256: sha256Hex(transformed),
    width: metadata.width,
    height: metadata.height,
    bytesLength: transformed.length,
  };
}

export async function deriveDeliveryProfiles(sourceBytes) {
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.length === 0) throw new Error("sourceBytes must be a non-empty Buffer");
  if (sourceBytes.length > MAX_SOURCE_BYTES) throw new Error("sourceBytes exceeds the 100 MiB limit");
  const metadata = await sharp(sourceBytes, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("source image has no measurable dimensions");
  if (metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION) throw new Error("source image exceeds the dimension limit");
  if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw new Error("source image exceeds the pixel limit");

  const fullRes = await output(
    sourceBytes,
    "client.fullres.share.v1",
    (image) => image.jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: false }),
  );
  const mls = await output(
    sourceBytes,
    "ontario.proptx.provisional.2026-08-11.v1",
    (image) => image
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 89, chromaSubsampling: "4:4:4", mozjpeg: false }),
  );

  return { masterSha256: sha256Hex(sourceBytes), fullRes, mls };
}

function captureDataRecord(value, { required, optional = [], label }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  if (isProxy(value)) throw new Error(`${label} must not be a Proxy`);
  const allowed = new Set([...required, ...optional]);
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new Error(`unexpected ${label} property: ${String(key)}`);
    }
  }
  const captured = Object.create(null);
  for (const name of required) {
    if (!ownKeys.includes(name)) throw new Error(`${name} is required`);
  }
  for (const name of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !("value" in descriptor)) throw new Error(`${name} must be a data property`);
    captured[name] = descriptor.value;
  }
  return Object.freeze(captured);
}

function assertUuid(name, value) {
  if (typeof value !== "string") throw new Error(`${name} must be a primitive string UUID v4`);
  if (!UUID_V4.test(value)) throw new Error(`${name} must be a UUID v4`);
}

export function mediaObjectKeys(ids, sha256) {
  const validated = captureDataRecord(ids, { required: REQUIRED_MEDIA_IDS, label: "identifier" });
  for (const name of REQUIRED_MEDIA_IDS) assertUuid(name, validated[name]);
  if (typeof sha256 !== "string") throw new Error("sha256 must be a primitive string");
  if (!SHA256.test(sha256)) throw new Error("sha256 must be 64 lowercase hexadecimal characters");

  return Object.freeze({
    quarantine: `quarantine/${validated.organizationId}/${validated.ingestJobId}/${validated.versionId}/${sha256}.bin`,
    master: `masters/${validated.organizationId}/${validated.assetId}/${validated.versionId}/${sha256}.jpg`,
    derivative(profile) {
      if (typeof profile !== "string") throw new Error("profile must be a primitive string");
      if (!PROFILE.test(profile)) throw new Error("profile contains unsafe characters");
      return `derivatives/${validated.organizationId}/${validated.versionId}/${profile}/${sha256}.jpg`;
    },
    package(kind, packageSha256) {
      if (typeof kind !== "string") throw new Error("package kind must be a primitive string");
      if (!PROFILE.test(kind)) throw new Error("package kind contains unsafe characters");
      if (typeof packageSha256 !== "string") throw new Error("package sha256 must be a primitive string");
      if (!SHA256.test(packageSha256)) throw new Error("package sha256 must be 64 lowercase hexadecimal characters");
      return `packages/${validated.organizationId}/${validated.releaseId}/${kind}/${packageSha256}.zip`;
    },
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function safeArchiveName(name) {
  if (typeof name !== "string" || name.length < 1 || name.length > 180) throw new Error("archive filename is invalid");
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) throw new Error("archive filename contains a control character");
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,179}$/.test(name)) {
    throw new Error("archive filename must use portable ASCII letters, digits, spaces, dots, underscores, or hyphens");
  }
  if (/[ .]$/.test(name)) throw new Error("archive filename cannot end with a space or dot");
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error("archive filename must be a basename");
  }
  const identity = name.toLowerCase();
  if (identity === RESERVED_MANIFEST_NAME) throw new Error(`${RESERVED_MANIFEST_NAME} is reserved`);
  return { name, identity };
}

function validateRelease(release) {
  const captured = captureDataRecord(release, {
    required: ["releaseId", "profile"],
    label: "release metadata",
  });
  assertUuid("releaseId", captured.releaseId);
  if (typeof captured.profile !== "string" || !PROFILE.test(captured.profile)) throw new Error("release profile is invalid");
  return Object.freeze({ releaseId: captured.releaseId, profile: captured.profile });
}

function captureDenseArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (isProxy(value)) throw new Error(`${label} must not be a Proxy`);
  const expectedKeys = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !expectedKeys.has(key)) throw new Error(`unexpected ${label} property: ${String(key)}`);
  }
  const captured = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) throw new Error(`${label}[${index}] must be a data property`);
    captured.push(descriptor.value);
  }
  return Object.freeze(captured);
}

function captureArchiveEntryMetadata(file) {
  if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error("archive entry must be an object");
  if (isProxy(file)) throw new Error("archive entry must not be a Proxy");
  const ownKeys = Reflect.ownKeys(file);
  const hasBytes = ownKeys.includes("bytes");
  const hasSource = ownKeys.includes("source");
  if (hasBytes === hasSource) throw new Error("archive entry must contain either bytes or a source factory");
  const captured = hasBytes
    ? captureDataRecord(file, { required: ["name", "bytes"], optional: ["bytesLength", "sha256"], label: "archive entry" })
    : captureDataRecord(file, { required: ["name", "source", "bytesLength", "sha256"], label: "archive entry" });
  const { name, identity } = safeArchiveName(captured.name);

  if (hasBytes) {
    if (!Buffer.isBuffer(captured.bytes) || isProxy(captured.bytes) || captured.bytes.length === 0) {
      throw new Error(`${name} bytes must be a non-empty non-Proxy Buffer`);
    }
    const bytesLength = captured.bytes.length;
    if (bytesLength > MAX_ARCHIVE_ENTRY_BYTES) throw new Error(`${name} declared bytes must be from 1 to 100 MiB`);
    if (Object.hasOwn(captured, "bytesLength") && captured.bytesLength !== bytesLength) throw new Error(`${name} byte length mismatch`);
    if (Object.hasOwn(captured, "sha256") && (typeof captured.sha256 !== "string" || !SHA256.test(captured.sha256))) {
      throw new Error(`${name} requires a lowercase SHA-256`);
    }
    return Object.freeze({
      name,
      identity,
      bytes: captured.bytes,
      source: null,
      bytesLength,
      declaredSha256: captured.sha256 ?? null,
    });
  }

  if (typeof captured.source !== "function" || isProxy(captured.source)) throw new Error(`${name} source must be a non-Proxy function`);
  if (!Number.isSafeInteger(captured.bytesLength) || captured.bytesLength < 1 || captured.bytesLength > MAX_ARCHIVE_ENTRY_BYTES) {
    throw new Error(`${name} declared bytes must be from 1 to 100 MiB`);
  }
  if (typeof captured.sha256 !== "string" || !SHA256.test(captured.sha256)) throw new Error(`${name} requires a lowercase SHA-256`);
  return Object.freeze({
    name,
    identity,
    bytes: null,
    source: captured.source,
    bytesLength: captured.bytesLength,
    sha256: captured.sha256,
  });
}

function snapshotArchiveEntry(file) {
  if (!file.bytes) return file;
  const bytes = Buffer.from(file.bytes);
  const sha256 = sha256Hex(bytes);
  if (file.declaredSha256 && file.declaredSha256 !== sha256) throw new Error(`${file.name} checksum mismatch`);
  return Object.freeze({
    name: file.name,
    identity: file.identity,
    bytes,
    source: null,
    bytesLength: bytes.length,
    sha256,
  });
}

function prepareArchive(
  files,
  release,
  {
    maxAggregateBytes = MAX_ARCHIVE_INPUT_BYTES,
    aggregateError = "archive aggregate bytes exceed the 20 GiB limit",
  } = {},
) {
  const capturedFiles = captureDenseArray(files, "archive entries");
  if (capturedFiles.length < 1) throw new Error("archive requires at least one entry");
  if (capturedFiles.length > MAX_ARCHIVE_ENTRIES) throw new Error(`archive supports at most ${MAX_ARCHIVE_ENTRIES} entries`);
  const names = new Set();
  let aggregateBytes = 0;
  const preflight = capturedFiles
    .map(captureArchiveEntryMetadata)
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const file of preflight) {
    if (names.has(file.identity)) throw new Error(`duplicate archive filename: ${file.name}`);
    names.add(file.identity);
    aggregateBytes += file.bytesLength;
  }
  if (aggregateBytes > maxAggregateBytes) throw new Error(aggregateError);
  const releaseMetadata = validateRelease(release);
  const sorted = preflight.map(snapshotArchiveEntry);
  const manifestFiles = Object.freeze(sorted.map(({ name, bytesLength, sha256 }) => Object.freeze({
    name,
    bytes: bytesLength,
    sha256,
  })));
  const manifest = Object.freeze({
    releaseId: releaseMetadata.releaseId,
    profile: releaseMetadata.profile,
    files: manifestFiles,
  });
  const manifestBytes = Buffer.from(`${JSON.stringify(canonicalJson(manifest), null, 2)}\n`, "utf8");
  if (manifestBytes.length > MAX_MANIFEST_BYTES) throw new Error("release manifest exceeds the 1 MiB limit");
  return { sorted, manifest, manifestBytes, aggregateBytes };
}

function verifiedSource(file, activeSources, onError) {
  const source = file.source();
  if (!source || typeof source.pipe !== "function" || typeof source.destroy !== "function") {
    throw new Error(`${file.name} source factory must return a destroyable readable stream`);
  }
  activeSources.add(source);
  const hash = createHash("sha256");
  let bytesRead = 0;
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      bytesRead += chunk.length;
      if (bytesRead > file.bytesLength) return callback(new Error(`${file.name} byte length mismatch`));
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      activeSources.delete(source);
      if (bytesRead !== file.bytesLength) return callback(new Error(`${file.name} byte length mismatch`));
      if (hash.digest("hex") !== file.sha256) return callback(new Error(`${file.name} checksum mismatch`));
      callback();
    },
  });
  verifier.once("error", onError);
  source.once("error", (error) => verifier.destroy(error));
  return source.pipe(verifier);
}

function destroyZipResources(archive, destination, activeSources) {
  for (const source of activeSources) source.destroy();
  activeSources.clear();
  if (!archive.destroyed) {
    archive.abort();
    archive.destroy();
  }
  if (!destination.destroyed) destination.destroy();
}

async function writePreparedZip(prepared, destination, { signal } = {}) {
  if (!destination || typeof destination.write !== "function" || typeof destination.destroy !== "function") {
    throw new Error("destination must be a destroyable writable stream");
  }
  if (signal?.aborted) throw signal.reason ?? new Error("ZIP operation aborted");
  const hash = createHash("sha256");
  const activeSources = new Set();
  let bytesWritten = 0;
  let failed = false;
  let rejectFailure;
  const failure = new Promise((_, reject) => { rejectFailure = reject; });
  const archive = new ZipArchive({ store: true, forceLocalTime: false });
  const fail = (error) => {
    if (failed) return;
    failed = true;
    destroyZipResources(archive, destination, activeSources);
    rejectFailure(error instanceof Error ? error : new Error(String(error)));
  };
  const abort = () => fail(signal.reason ?? new Error("ZIP operation aborted"));
  signal?.addEventListener("abort", abort, { once: true });
  archive.on("data", (chunk) => {
    hash.update(chunk);
    bytesWritten += chunk.length;
  });
  archive.once("error", fail);
  destination.once("error", fail);
  archive.pipe(destination);
  const destinationCompletion = finished(destination);

  try {
    for (const file of prepared.sorted) {
      const input = file.bytes ?? verifiedSource(file, activeSources, fail);
      archive.append(input, { name: file.name, date: FIXED_ZIP_DATE, mode: 0o100644 });
    }
    archive.append(prepared.manifestBytes, { name: RESERVED_MANIFEST_NAME, date: FIXED_ZIP_DATE, mode: 0o100644 });
    const completion = (async () => {
      await archive.finalize();
      await destinationCompletion;
    })();
    completion.catch(() => {});
    await Promise.race([completion, failure]);
    return {
      sha256: hash.digest("hex"),
      bytesWritten,
      fileCount: prepared.sorted.length + 1,
      manifest: prepared.manifest,
      inputBytes: prepared.aggregateBytes,
    };
  } catch (error) {
    if (!failed) {
      failed = true;
      destroyZipResources(archive, destination, activeSources);
    }
    await destinationCompletion.catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function writeDeterministicZip(files, release, destination, options = {}) {
  const prepared = prepareArchive(files, release);
  return writePreparedZip(prepared, destination, options);
}

export async function buildDeterministicZip(files, release) {
  const prepared = prepareArchive(files, release, {
    maxAggregateBytes: MAX_BUFFERED_ZIP_INPUT_BYTES,
    aggregateError: "buffered ZIP input exceeds 100 MiB; use writeDeterministicZip",
  });
  const chunks = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const result = await writePreparedZip(prepared, destination);
  return { ...result, bytes: Buffer.concat(chunks) };
}
