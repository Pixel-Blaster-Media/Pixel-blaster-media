import { createHash } from "node:crypto";

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
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!SAFE_FILENAME.test(name) || name === "." || name === "..") {
      throw new Error("An AutoHDR filename is invalid.");
    }
    const folded = name.toLocaleLowerCase("en-US");
    if (names.has(folded)) throw new Error("AutoHDR job contains a duplicate filename.");
    names.add(folded);
    const size = Number(entry.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) {
      throw new Error("Each AutoHDR image must be between 1 byte and 100 MiB.");
    }
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error("The AutoHDR job exceeds the 8 GiB total limit.");
    const lastModified = Number(entry.lastModified);
    if (!Number.isSafeInteger(lastModified) || lastModified < 0) {
      throw new Error("An AutoHDR image timestamp is invalid.");
    }
    return Object.freeze({ name, size, lastModified });
  });
  return Object.freeze(output) as AutoHDRFileManifestEntry[];
}

export function buildAutoHDRIdempotencyKey(input: {
  organizationId: string;
  bookingId: string;
  manifest: AutoHDRFileManifestEntry[];
}): string {
  if (!UUID.test(input.organizationId) || !UUID.test(input.bookingId)) {
    throw new Error("AutoHDR tenant or booking identity is invalid.");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(input.manifest.map(({ name, size, lastModified }) => [name, size, lastModified])))
    .digest("hex");
  return `autohdr:${input.bookingId}:${digest}`;
}

export function assertAutoHDRTransition(from: AutoHDRJobState, to: AutoHDRJobState): void {
  const allowed = TRANSITIONS[from] as readonly AutoHDRJobState[];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid transition for AutoHDR job from ${from} to ${to}.`);
  }
}
