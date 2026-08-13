import { createHash } from "node:crypto";

import { AUTOHDR_MODELS, type AutoHDRStyleInput } from "./contract.ts";
import type {
  AutoHDRCanonicalSource,
  AutoHDRSourceManifestEntry,
} from "./database-contract.ts";

const MAX_FILES = 160;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
const SAFE_FILENAME = /^[^\\/\u0000-\u001f\u007f]{1,255}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type AutoHDRFileManifestEntry = Readonly<{
  name: string;
  size: number;
  lastModified: number;
}>;

export type AutoHDRAcceptedSource = AutoHDRCanonicalSource;

const STYLE_KEYS = new Set([
  "modelSelection",
  "declutter",
  "retainOriginalSky",
  "perspectiveCorrection",
  "grassReplacement",
]);

export type AutoHDRJobState =
  | "claimed"
  | "preparing"
  | "awaiting_upload"
  | "finalizing"
  | "processing"
  | "ready"
  | "retrieving"
  | "review_pending"
  | "retryable"
  | "reconciliation_required"
  | "rejected";

const TRANSITIONS = {
  claimed: ["preparing", "rejected"],
  preparing: ["awaiting_upload", "reconciliation_required", "rejected"],
  awaiting_upload: ["finalizing", "rejected"],
  finalizing: ["processing", "reconciliation_required", "rejected"],
  processing: ["ready", "retryable", "reconciliation_required", "rejected"],
  ready: ["retrieving", "rejected"],
  retrieving: ["review_pending", "retryable", "reconciliation_required", "rejected"],
  review_pending: [],
  retryable: ["processing", "retrieving", "reconciliation_required", "rejected"],
  reconciliation_required: [],
  rejected: [],
} as const satisfies Readonly<Record<AutoHDRJobState, readonly AutoHDRJobState[]>>;

export function normalizeAutoHDRFileManifest(
  input: Array<{ name: unknown; size: unknown; lastModified: unknown }>,
): AutoHDRFileManifestEntry[] {
  if (!Array.isArray(input) || input.length < 1) {
    throw new Error("Pick at least one AutoHDR image.");
  }
  if (input.length > MAX_FILES) throw new Error("AutoHDR accepts at most 160 images per job.");
  let total = 0;
  const names = new Set<string>();
  const output = input.map((entry) => {
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!SAFE_FILENAME.test(name) || name === "." || name === "..") {
      throw new Error("An AutoHDR filename is invalid.");
    }
    const folded = name.toLocaleLowerCase("en-US");
    if (names.has(folded)) throw new Error("AutoHDR job contains a duplicate filename.");
    names.add(folded);
    const size = entry.size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) {
      throw new Error("Each AutoHDR image must be between 1 byte and 100 MiB.");
    }
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error("The AutoHDR job exceeds the 8 GiB total limit.");
    const lastModified = entry.lastModified;
    if (
      typeof lastModified !== "number" ||
      !Number.isSafeInteger(lastModified) ||
      lastModified < 0
    ) {
      throw new Error("An AutoHDR image timestamp is invalid.");
    }
    return Object.freeze({ name, size, lastModified });
  });
  return Object.freeze(output) as AutoHDRFileManifestEntry[];
}

export function buildAutoHDRIdempotencyKey(input: {
  organizationId: string;
  bookingId: string;
  manifest: Array<AutoHDRFileManifestEntry | AutoHDRAcceptedSource>;
  style?: AutoHDRStyleInput;
}): string {
  if (!UUID.test(input.organizationId) || !UUID.test(input.bookingId)) {
    throw new Error("AutoHDR tenant or booking identity is invalid.");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({
      manifest: input.manifest.map((file) => "name" in file
        ? [file.name, file.size, file.lastModified]
        : [
            file.position,
            file.sourceMediaVersionId,
            file.filename,
            file.byteSize,
            file.lastModified,
            file.sha256,
          ]),
      style: normalizeAutoHDRStyle(input.style ?? {}),
    }))
    .digest("hex");
  return `autohdr:${input.bookingId}:${digest}`;
}

export function normalizeAutoHDRSourceManifest(input: unknown): AutoHDRSourceManifestEntry[] {
  if (!Array.isArray(input) || input.length < 1) throw new Error("Pick at least one AutoHDR image.");
  if (input.length > MAX_FILES) throw new Error("AutoHDR accepts at most 160 images per job.");
  let total = 0;
  const names = new Set<string>();
  const checksums = new Set<string>();
  return Object.freeze(input.map((value, position) => {
    const row = object(value);
    const filename = safeFilename(row.filename);
    const folded = filename.toLocaleLowerCase("en-US");
    if (names.has(folded)) throw new Error("AutoHDR job contains a duplicate filename.");
    names.add(folded);
    if (row.position !== position) throw new Error("AutoHDR source positions must be contiguous.");
    const byteSize = positiveInteger(row.byteSize, MAX_FILE_BYTES, "AutoHDR source byte size");
    total += byteSize;
    if (total > MAX_TOTAL_BYTES) throw new Error("The AutoHDR job exceeds the 8 GiB total limit.");
    const lastModified = nonnegativeInteger(row.lastModified, "AutoHDR source timestamp");
    const contentType = canonicalSourceContentType(filename, row.contentType);
    const sha256 = typeof row.sha256 === "string" && /^[0-9a-f]{64}$/.test(row.sha256)
      ? row.sha256
      : "";
    if (!sha256) throw new Error("AutoHDR source checksum is invalid.");
    if (checksums.has(sha256)) throw new Error("AutoHDR source checksum is duplicated.");
    checksums.add(sha256);
    return Object.freeze({
      position,
      filename,
      byteSize,
      lastModified,
      contentType,
      sha256,
    });
  })) as AutoHDRSourceManifestEntry[];
}

export function normalizeAcceptedAutoHDRSources(input: unknown): AutoHDRAcceptedSource[] {
  const manifest = normalizeAutoHDRSourceManifest(input);
  const rows = input as Array<Record<string, unknown>>;
  const versions = new Set<string>();
  return Object.freeze(manifest.map((entry, index) => {
    const row = rows[index];
    const sourceMediaVersionId = validUuid(row.sourceMediaVersionId, "source media version");
    if (versions.has(sourceMediaVersionId)) throw new Error("AutoHDR source identity is duplicated.");
    versions.add(sourceMediaVersionId);
    return Object.freeze({
      ...entry,
      mediaBatchId: validUuid(row.mediaBatchId, "media batch"),
      mediaAssetId: validUuid(row.mediaAssetId, "media asset"),
      sourceMediaVersionId,
      ingestJobId: validUuid(row.ingestJobId, "ingest job"),
      objectKey: safeObjectKey(row.objectKey),
    });
  })) as AutoHDRAcceptedSource[];
}

export function buildAutoHDRManifestSha256(files: AutoHDRAcceptedSource[]): string {
  return createHash("sha256").update(JSON.stringify(files.map((file) => ({
    position: file.position,
    source_media_version_id: file.sourceMediaVersionId,
    filename: file.filename,
  })))).digest("hex");
}

export function normalizeAutoHDRStyle(value: unknown): AutoHDRStyleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AutoHDR style must be an object.");
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !STYLE_KEYS.has(key))) {
    throw new Error("AutoHDR style contains an unsupported field.");
  }
  if (
    row.modelSelection !== undefined &&
    (typeof row.modelSelection !== "string" ||
      !AUTOHDR_MODELS.includes(row.modelSelection as (typeof AUTOHDR_MODELS)[number]))
  ) {
    throw new Error("AutoHDR model selection is unsupported.");
  }
  for (const key of [
    "declutter",
    "retainOriginalSky",
    "perspectiveCorrection",
    "grassReplacement",
  ] as const) {
    if (row[key] !== undefined && typeof row[key] !== "boolean") {
      throw new Error(`AutoHDR ${key} must be a boolean.`);
    }
  }
  return Object.freeze({
    ...(row.modelSelection === undefined
      ? {}
      : { modelSelection: row.modelSelection as AutoHDRStyleInput["modelSelection"] }),
    ...(row.declutter === undefined ? {} : { declutter: row.declutter as boolean }),
    ...(row.retainOriginalSky === undefined
      ? {}
      : { retainOriginalSky: row.retainOriginalSky as boolean }),
    ...(row.perspectiveCorrection === undefined
      ? {}
      : { perspectiveCorrection: row.perspectiveCorrection as boolean }),
    ...(row.grassReplacement === undefined
      ? {}
      : { grassReplacement: row.grassReplacement as boolean }),
  });
}

export function assertAutoHDRTransition(from: AutoHDRJobState, to: AutoHDRJobState): void {
  const allowed = TRANSITIONS[from] as readonly AutoHDRJobState[];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid transition for AutoHDR job from ${from} to ${to}.`);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AutoHDR source manifest is invalid.");
  return value as Record<string, unknown>;
}

function safeFilename(value: unknown): string {
  if (typeof value !== "string" || !SAFE_FILENAME.test(value) || value === "." || value === "..") {
    throw new Error("An AutoHDR filename is invalid.");
  }
  return value;
}

function canonicalSourceContentType(
  filename: string,
  value: unknown,
): "image/jpeg" | "image/png" {
  const lower = filename.toLowerCase();
  if ((lower.endsWith(".jpg") || lower.endsWith(".jpeg")) && value === "image/jpeg") {
    return value;
  }
  if (lower.endsWith(".png") && value === "image/png") return value;
  throw new Error("AutoHDR source must be an exact JPEG or PNG file type.");
}

function positiveInteger(value: unknown, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid.`);
  return value;
}

function validUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`AutoHDR ${label} identity is invalid.`);
  return value;
}

function safeObjectKey(value: unknown): string {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 1024 ||
    value.startsWith("/") || value.includes("\\") || value.includes("?") ||
    value.includes("#") || /[\u0000-\u001f\u007f]/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) throw new Error("AutoHDR source object key is invalid.");
  return value;
}
