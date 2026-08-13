import type { AutoHDRPreparedUpload } from "./upload-contract.ts";

type BrowserFile = Readonly<{
  name: string;
  size: number;
  lastModified: number;
}>;

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
