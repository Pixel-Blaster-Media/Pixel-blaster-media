import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

const deadlineContext = new AsyncLocalStorage<AbortSignal>();
export function withMediaDeadline<T>(milliseconds: number, work: () => Promise<T>): Promise<T> {
  return deadlineContext.run(AbortSignal.timeout(milliseconds), work);
}
export function mediaSignal(milliseconds: number): AbortSignal {
  const enclosing = deadlineContext.getStore();
  enclosing?.throwIfAborted();
  const local = AbortSignal.timeout(milliseconds);
  return enclosing ? AbortSignal.any([enclosing, local]) : local;
}

/** One signal must cover both fetch and body. Never trust Content-Length alone. */
export async function readProviderBytes(response: Response, options: { maxBytes: number; signal: AbortSignal }): Promise<Uint8Array<ArrayBuffer>> {
  const { maxBytes, signal } = options;
  const fail = (message: string): never => { void response.body?.cancel().catch(() => {}); throw new Error(message); };
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return fail("Invalid media size limit.");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) return fail("Media size limit exceeded.");
  if (response.headers.get("content-encoding") && response.headers.get("content-encoding") !== "identity") return fail("Unsupported media encoding.");
  if (!response.body) return fail("Empty media body.");
  const reader = response.body.getReader();
  let rejectAbort: (reason: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { rejectAbort(new Error("Media deadline exceeded.")); void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal.aborted) throw new Error("Media deadline exceeded.");
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Media size limit exceeded.");
      chunks.push(value);
    }
    if (!size) throw new Error("Empty media body.");
    if (length !== null && Number(length) !== size) throw new Error("Media size mismatch.");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

export function validateMediaSignature(bytes: Uint8Array, mime: string): void {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const valid = mime === "image/jpeg" ? b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255
    : mime === "image/png" ? b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === "image/webp" ? b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"
    : mime === "image/avif" ? b.toString("ascii", 4, 8) === "ftyp" && ["avif", "avis"].includes(b.toString("ascii", 8, 12))
    : mime === "application/pdf" ? b.toString("ascii", 0, 5) === "%PDF-"
    : mime === "application/zip" ? b[0] === 80 && b[1] === 75 && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6)) : false;
  if (!valid) throw new Error("Invalid media signature or type.");
}

export async function boundedMediaResponse(response: Response, options: { maxBytes: number; signal: AbortSignal; allowedTypes: string[] }): Promise<Response> {
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error("Media provider unavailable."); }
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!options.allowedTypes.includes(mime)) { void response.body?.cancel().catch(() => {}); throw new Error("Unsupported media type."); }
  const bytes = await readProviderBytes(response, options);
  validateMediaSignature(bytes, mime);
  if (mime.startsWith("image/")) {
    // Next already ships sharp; decode with hard input limits, not header trust.
    const { default: sharp } = await import("sharp");
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" });
    try {
      options.signal.throwIfAborted();
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width > 16_384 || metadata.height > 16_384 ||
          metadata.width * metadata.height > 40_000_000 || (metadata.pages ?? 1) !== 1) {
        throw new Error("Media dimension or pixel limit exceeded.");
      }
      // Force full decode to catch truncated/corrupt compressed pixel data.
      await image.timeout({ seconds: 10 }).stats();
      options.signal.throwIfAborted();
    } finally { image.destroy(); }
  }
  return new Response(bytes, { status: 200, headers: { "content-type": mime, "content-length": String(bytes.length) } });
}
