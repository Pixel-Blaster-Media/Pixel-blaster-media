import type { AutoHDRPreparedUpload } from "./upload-contract.ts";
import type {
  AutoHDRCanonicalSource,
  AutoHDRSourceManifestEntry,
} from "./database-contract.ts";
import type { CanonicalSourceContentType } from "./source-upload-core.ts";
import {
  AUTOHDR_SOURCE_MAX_FILE_BYTES,
  AUTOHDR_SOURCE_MAX_FILES,
  AUTOHDR_SOURCE_MAX_TOTAL_BYTES,
} from "./source-limits.ts";

type BrowserFile = Readonly<{
  name: string;
  size: number;
  lastModified: number;
  type?: string;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}>;

const SAFE_FILENAME = /^[^\\/\u0000-\u001f\u007f]{1,255}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_FILE = /\.(jpe?g|png)$/i;

type UploadResponse = Readonly<{ ok: boolean; status: number }>;
type UploadFetch = (
  url: string,
  init: {
    method: "PUT";
    headers: {
      "Content-Type": "application/octet-stream";
      "x-amz-acl": "private";
    };
    body: BrowserFile;
    redirect: "error";
  },
) => Promise<UploadResponse>;

type CanonicalUploadFetch = (
  url: string,
  init: {
    method: "PUT";
    headers: {
      "Content-Type": CanonicalSourceContentType;
      "If-None-Match": "*";
      "x-amz-meta-sha256": string;
    };
    body: BrowserFile;
    redirect: "error";
    signal: AbortSignal;
  },
) => Promise<UploadResponse>;

export type CanonicalBrowserUploadResult = Readonly<{
  position: number;
  filename: string;
  attempted: boolean;
  status: "uploaded" | "reconciliation_candidate" | "accepted" | "cancelled";
}>;

export class CanonicalBrowserUploadError extends Error {
  readonly results: CanonicalBrowserUploadResult[];

  constructor(results: CanonicalBrowserUploadResult[]) {
    super("One or more Pixel source uploads failed; unchanged files may be retried.");
    this.results = results;
  }
}

export async function hashAutoHDRSourceFiles(
  files: BrowserFile[],
): Promise<AutoHDRSourceManifestEntry[]> {
  validateAutoHDRSourceFiles(files);

  const manifest: AutoHDRSourceManifestEntry[] = [];
  for (let position = 0; position < files.length; position += 1) {
    const file = files[position];
    const bytes = await file.arrayBuffer!();
    if (bytes.byteLength !== file.size) throw new Error("AutoHDR source file size changed during hashing.");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    manifest.push(Object.freeze({
      position,
      filename: file.name,
      byteSize: file.size,
      lastModified: file.lastModified,
      contentType: canonicalBrowserContentType(file),
      sha256,
    }));
  }
  return Object.freeze(manifest) as AutoHDRSourceManifestEntry[];
}

export function validateAutoHDRSourceFiles(files: BrowserFile[]): void {
  if (!Array.isArray(files) || files.length < 1) throw new Error("Pick at least one AutoHDR image.");
  if (files.length > AUTOHDR_SOURCE_MAX_FILES) throw new Error("AutoHDR accepts at most 20 images per job.");
  let total = 0;
  const names = new Set<string>();
  for (const file of files) {
    if (!SAFE_FILENAME.test(file.name) || file.name === "." || file.name === "..") {
      throw new Error("An AutoHDR filename is invalid.");
    }
    canonicalBrowserContentType(file);
    const folded = file.name.toLocaleLowerCase("en-US");
    if (names.has(folded)) throw new Error("AutoHDR job contains a duplicate filename.");
    names.add(folded);
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > AUTOHDR_SOURCE_MAX_FILE_BYTES) {
      throw new Error("Each AutoHDR image must be between 1 byte and 25 MiB.");
    }
    if (!Number.isSafeInteger(file.lastModified) || file.lastModified < 0) {
      throw new Error("An AutoHDR image timestamp is invalid.");
    }
    if (typeof file.arrayBuffer !== "function") throw new Error("AutoHDR source file is not readable.");
    total += file.size;
    if (total > AUTOHDR_SOURCE_MAX_TOTAL_BYTES) throw new Error("The AutoHDR job exceeds the 250 MiB total limit.");
  }
}

function canonicalBrowserContentType(file: BrowserFile): CanonicalSourceContentType {
  const match = SOURCE_FILE.exec(file.name);
  if (!match) throw new Error("Canonical source first release accepts only JPEG (.jpg/.jpeg) and PNG (.png) files.");
  const expected = match[1].toLowerCase() === "png" ? "image/png" : "image/jpeg";
  if (file.type !== expected) {
    throw new Error(`Canonical source file type must exactly match ${expected}.`);
  }
  return expected;
}

export async function uploadCanonicalAutoHDRSources(
  files: BrowserFile[],
  sources: Array<AutoHDRCanonicalSource & {
    upload: {
      url: string;
      method: "PUT";
      headers: {
        "Content-Type": CanonicalSourceContentType;
        "If-None-Match": "*";
        "x-amz-meta-sha256": string;
      };
    } | null;
  }>,
  options: {
    concurrency?: number;
    fetchImpl?: CanonicalUploadFetch;
    onProgress?: (completed: number, total: number) => void;
    signal?: AbortSignal;
    perFileTimeoutMs?: number;
    operationTimeoutMs?: number;
  } = {},
): Promise<CanonicalBrowserUploadResult[]> {
  if (files.length !== sources.length || files.length < 1) {
    throw new Error("AutoHDR files and canonical source identities did not match.");
  }
  const concurrency = options.concurrency ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 6) {
    throw new Error("AutoHDR upload concurrency must be between 1 and 6.");
  }
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const source = sources[index];
    const upload = source.upload;
    if (
      source.position !== index ||
      source.filename !== file.name ||
      source.byteSize !== file.size ||
      source.lastModified !== file.lastModified ||
      source.contentType !== canonicalBrowserContentType(file) ||
      !SHA256.test(source.sha256) ||
      (source.ingestState === "accepted" ? upload !== null : upload === null) ||
      (upload !== null && (
      upload.method !== "PUT" ||
      upload.headers["Content-Type"] !== source.contentType ||
      upload.headers["If-None-Match"] !== "*" ||
      !hasExactCanonicalSignedHeaders(upload.url, source.quarantineObjectKey) ||
      Object.keys(upload.headers).sort().join("\n") !==
        ["Content-Type", "If-None-Match", "x-amz-meta-sha256"].sort().join("\n") ||
      upload.headers["x-amz-meta-sha256"] !== source.sha256))
    ) {
      throw new Error("AutoHDR files and canonical source identities did not match.");
    }
  }
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as CanonicalUploadFetch);
  const perFileTimeoutMs = validDeadline(options.perFileTimeoutMs ?? 120_000, "file");
  const operationTimeoutMs = validDeadline(options.operationTimeoutMs ?? 270_000, "operation");
  const terminalController = new AbortController();
  const operationSignal = AbortSignal.any([
    terminalController.signal,
    AbortSignal.timeout(operationTimeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  let next = 0;
  let completed = 0;
  let terminalFailure = false;
  const results: CanonicalBrowserUploadResult[] = sources.map((source) => Object.freeze({
    position: source.position,
    filename: source.filename,
    attempted: false,
    status: source.ingestState === "accepted" ? "accepted" as const : "cancelled" as const,
  }));
  const worker = async () => {
    while (!operationSignal.aborted && next < files.length) {
      const index = next++;
      const file = files[index];
      const source = sources[index];
      if (source.upload === null) {
        completed += 1;
        options.onProgress?.(completed, files.length);
        continue;
      }
      const fileTimeout = AbortSignal.timeout(perFileTimeoutMs);
      const fileSignal = AbortSignal.any([operationSignal, fileTimeout]);
      results[index] = Object.freeze({ position: index, filename: file.name, attempted: true, status: "reconciliation_candidate" });
      try {
        const response = await fetchImpl(source.upload.url, {
          method: "PUT",
          headers: source.upload.headers,
          body: file,
          redirect: "error",
          signal: fileSignal,
        });
        if (response.ok) {
          results[index] = Object.freeze({ position: index, filename: file.name, attempted: true, status: "uploaded" });
        } else if (response.status !== 412) {
          terminalFailure = true;
          results[index] = Object.freeze({ position: index, filename: file.name, attempted: true, status: "cancelled" });
          terminalController.abort(new Error("terminal source upload failure"));
          return;
        }
      } catch {
        if (terminalController.signal.aborted) {
          results[index] = Object.freeze({ position: index, filename: file.name, attempted: true, status: "cancelled" });
          return;
        }
        // A network error, deadline, or externally aborted response can arrive
        // after R2 committed the create-only PUT. Server reconciliation decides.
      }
      completed += 1;
      options.onProgress?.(completed, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));
  if (terminalFailure) throw new CanonicalBrowserUploadError(Object.freeze(results) as CanonicalBrowserUploadResult[]);
  return Object.freeze(results) as CanonicalBrowserUploadResult[];
}

function hasExactCanonicalSignedHeaders(value: string, quarantineObjectKey: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      Boolean(url.hostname) &&
      decodeURIComponent(url.pathname) === `/${quarantineObjectKey}` &&
      (url.searchParams.get("X-Amz-SignedHeaders") ?? "") ===
        "content-length;content-type;host;if-none-match;x-amz-meta-sha256";
  } catch {
    return false;
  }
}

function validDeadline(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 300_000) {
    throw new Error(`AutoHDR ${label} upload deadline is invalid.`);
  }
  return value;
}

export async function uploadAutoHDRFiles(
  files: BrowserFile[],
  uploads: AutoHDRPreparedUpload[],
  options: {
    concurrency?: number;
    fetchImpl?: UploadFetch;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<void> {
  if (files.length !== uploads.length || files.length < 1) {
    throw new Error("AutoHDR files and upload destinations did not match.");
  }
  const concurrency = options.concurrency ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 6) {
    throw new Error("AutoHDR upload concurrency must be between 1 and 6.");
  }
  for (let index = 0; index < files.length; index += 1) {
    const upload = uploads[index];
    if (
      upload.filename !== files[index].name ||
      upload.method !== "PUT" ||
      upload.headers["Content-Type"] !== "application/octet-stream" ||
      upload.headers["x-amz-acl"] !== "private"
    ) {
      throw new Error("AutoHDR files and upload destinations did not match.");
    }
  }
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as UploadFetch);
  let next = 0;
  let completed = 0;
  const worker = async () => {
    while (next < files.length) {
      const index = next;
      next += 1;
      const file = files[index];
      const upload = uploads[index];
      const response = await fetchImpl(upload.url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-amz-acl": "private",
        },
        body: file,
        redirect: "error",
      });
      if (!response.ok) {
        throw new Error(`AutoHDR upload failed for ${file.name} (${response.status}).`);
      }
      completed += 1;
      options.onProgress?.(completed, files.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, () => worker()),
  );
}
