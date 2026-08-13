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
  },
) => Promise<UploadResponse>;

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
    };
  }>,
  options: {
    concurrency?: number;
    fetchImpl?: CanonicalUploadFetch;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<void> {
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
    if (
      source.position !== index ||
      source.filename !== file.name ||
      source.byteSize !== file.size ||
      source.lastModified !== file.lastModified ||
      source.contentType !== canonicalBrowserContentType(file) ||
      !SHA256.test(source.sha256) ||
      source.upload.method !== "PUT" ||
      source.upload.headers["Content-Type"] !== source.contentType ||
      source.upload.headers["If-None-Match"] !== "*" ||
      !hasExactCanonicalSignedHeaders(source.upload.url) ||
      Object.keys(source.upload.headers).sort().join("\n") !==
        ["Content-Type", "If-None-Match", "x-amz-meta-sha256"].sort().join("\n") ||
      source.upload.headers["x-amz-meta-sha256"] !== source.sha256
    ) {
      throw new Error("AutoHDR files and canonical source identities did not match.");
    }
  }
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as CanonicalUploadFetch);
  let next = 0;
  let completed = 0;
  const worker = async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      const source = sources[index];
      const response = await fetchImpl(source.upload.url, {
        method: "PUT",
        headers: source.upload.headers,
        body: file,
        redirect: "error",
      });
      // An idempotent retry may find the exact checksum-addressed key present.
      // Only server-side HEAD + verified GET may accept that existing object.
      if (!response.ok && response.status !== 412) {
        throw new Error(`Pixel source upload failed for ${file.name} (${response.status}).`);
      }
      completed += 1;
      options.onProgress?.(completed, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));
}

function hasExactCanonicalSignedHeaders(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.searchParams.get("X-Amz-SignedHeaders") ?? "") ===
        "content-length;content-type;host;if-none-match;x-amz-meta-sha256";
  } catch {
    return false;
  }
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
