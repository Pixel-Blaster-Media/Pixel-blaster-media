import { AUTOHDR_SOURCE_MAX_FILES } from "./source-limits.ts";

export const AUTOHDR_MODELS = [
  "Classic",
  "The Lisa",
  "Twilight",
  "Twilight-Golden",
  "Twilight-Pink",
  "Twilight-Midnight",
  "Classic-V4",
] as const;

export type AutoHDRModel = (typeof AUTOHDR_MODELS)[number];
export type AutoHDRNormalizedStatus =
  | "created"
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "unknown";

export type AutoHDRStyleInput = {
  modelSelection?: AutoHDRModel;
  declutter?: boolean;
  retainOriginalSky?: boolean;
  perspectiveCorrection?: boolean;
  grassReplacement?: boolean;
};

const UID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/;
const SAFE_FILENAME_PATTERN = /^[^\\/\u0000-\u001f\u007f]{1,255}$/;
const PUBLIC_HOST_DENY = new Set(["localhost", "localhost.localdomain"]);

export function buildAutoHDRCreateRequest(input: {
  files: string[];
  uploadCallbackUrl: string;
  statusCallbackUrl?: string;
  address?: string;
  style?: AutoHDRStyleInput;
  mockCall?: boolean;
}) {
  if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > AUTOHDR_SOURCE_MAX_FILES) {
    throw new Error("AutoHDR files must contain between 1 and 20 filenames.");
  }
  const files = input.files.map((filename) => ({ filename: safeFilename(filename) }));
  const uploadCallbackUrl = safeHttpsUrl(input.uploadCallbackUrl, "upload callback URL");
  const style = encodeStyle(input.style);
  return {
    files,
    upload_callback_url: uploadCallbackUrl,
    ...(input.statusCallbackUrl
      ? { status_callback_url: safeHttpsUrl(input.statusCallbackUrl, "status callback URL") }
      : {}),
    ...(input.address?.trim() ? { address: boundedString(input.address, "address", 500) } : {}),
    ...(input.mockCall ? { mock_call: true } : {}),
    ...(Object.keys(style).length ? { style } : {}),
  };
}

export function parseAutoHDRCreateResponse(value: unknown): {
  id: number;
  uid: string;
  uploadedFiles: string[];
  status: string;
  createdAt: string;
} {
  const row = exactObject(value, ["id", "uid", "uploaded_files", "status", "creation_date_utc"]);
  // AutoHDR's live schema calls these values `uploaded_files`, but it does
  // not define them as URLs or specify upload method/headers. Keep the values
  // opaque until the provider confirms the presigned-upload contract.
  const uploaded = requiredArray(row.uploaded_files, "uploaded_files", AUTOHDR_SOURCE_MAX_FILES).map((entry) =>
    boundedString(entry, "uploaded_files entry", 4096),
  );
  return {
    id: positiveInteger(row.id, "id"),
    uid: uid(row.uid),
    uploadedFiles: uploaded,
    status: boundedString(row.status, "status", 96),
    createdAt: isoDate(row.creation_date_utc, "creation_date_utc"),
  };
}

export function parseAutoHDRStatusResponse(value: unknown): {
  id: number;
  rawStatus: string | null;
  normalizedStatus: AutoHDRNormalizedStatus;
  createdAt: string;
} {
  const row = exactObject(value, ["id", "status", "creation_date_utc"]);
  const rawStatus = row.status === null ? null : boundedString(row.status, "status", 96);
  return {
    id: positiveInteger(row.id, "id"),
    rawStatus,
    normalizedStatus: normalizeAutoHDRStatus(rawStatus),
    createdAt: isoDate(row.creation_date_utc, "creation_date_utc"),
  };
}

export function parseAutoHDRProcessedPhotos(value: unknown): Array<{
  name: string;
  url: string;
}> {
  const row = exactObject(value, ["files"]);
  return requiredArray(row.files, "files", 500).map((item) => {
    const photo = exactObject(item, ["name", "url"]);
    return {
      name: safeFilename(photo.name),
      url: safeHttpsUrl(photo.url, "processed photo URL"),
    };
  });
}

export function normalizeAutoHDRStatus(value: string | null): AutoHDRNormalizedStatus {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (["created", "new", "draft", "pending_upload"].includes(normalized)) return "created";
  if (["uploading", "uploaded", "upload_complete", "finalizing"].includes(normalized)) {
    return "uploading";
  }
  if (["processing", "in_progress", "queued", "pending"].includes(normalized)) {
    return "processing";
  }
  if (["completed", "complete", "processed", "ready", "finished", "success"].includes(normalized)) {
    return "ready";
  }
  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) return "failed";
  return "unknown";
}

function encodeStyle(style: AutoHDRStyleInput | undefined): Record<string, unknown> {
  if (!style) return {};
  if (style.modelSelection && !AUTOHDR_MODELS.includes(style.modelSelection)) {
    throw new Error("AutoHDR model selection is unsupported.");
  }
  return {
    ...(style.modelSelection ? { model_selection: style.modelSelection } : {}),
    ...(style.declutter === undefined ? {} : { declutter: style.declutter }),
    ...(style.retainOriginalSky === undefined
      ? {}
      : { retain_original_sky: style.retainOriginalSky }),
    ...(style.perspectiveCorrection === undefined
      ? {}
      : { perspective_correction: style.perspectiveCorrection }),
    ...(style.grassReplacement === undefined
      ? {}
      : { grass_replacement: style.grassReplacement }),
  };
}

function exactObject(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AutoHDR response must be an object.");
  }
  const row = value as Record<string, unknown>;
  const unknown = Object.keys(row).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new Error("AutoHDR response contained unknown fields.");
  return row;
}

function requiredArray(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Error(`AutoHDR ${field} must be a bounded array.`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`AutoHDR ${field} must be a positive integer.`);
  }
  return Number(value);
}

function uid(value: unknown): string {
  if (typeof value !== "string" || !UID_PATTERN.test(value)) {
    throw new Error("AutoHDR uid is invalid.");
  }
  return value;
}

function safeFilename(value: unknown): string {
  if (typeof value !== "string" || !SAFE_FILENAME_PATTERN.test(value) || value === "." || value === "..") {
    throw new Error("AutoHDR filename is invalid.");
  }
  return value;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new Error(`AutoHDR ${field} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(`AutoHDR ${field} is invalid.`);
  }
  return trimmed;
}

function isoDate(value: unknown, field: string): string {
  const text = boundedString(value, field, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new Error(`AutoHDR ${field} is not a valid timestamp.`);
  }
  return text;
}

function safeHttpsUrl(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 4096) {
    throw new Error(`AutoHDR ${field} is invalid.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`AutoHDR ${field} is invalid.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    PUBLIC_HOST_DENY.has(url.hostname.toLowerCase()) ||
    url.hostname.endsWith(".localhost")
  ) {
    throw new Error(`AutoHDR ${field} is invalid.`);
  }
  return url.toString();
}
