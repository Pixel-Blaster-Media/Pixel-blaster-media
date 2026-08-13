import sharp from "sharp";

import type { CanonicalSourceContentType } from "./source-upload-core.ts";
import { AUTOHDR_SOURCE_MAX_FILE_BYTES } from "./source-limits.ts";

const MAX_DIMENSION_PX = 32_768;
const MAX_PIXELS = 100_000_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return crc >>> 0;
});

export async function verifyCanonicalImageStream(
  body: AsyncIterable<unknown>,
  contentType: CanonicalSourceContentType,
  signal?: AbortSignal,
): Promise<{ widthPx: number; heightPx: number }> {
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  for await (const value of body) {
    signal?.throwIfAborted();
    if (!(value instanceof Uint8Array)) throw new Error("Canonical source stream returned invalid bytes.");
    bytesRead += value.byteLength;
    if (bytesRead > AUTOHDR_SOURCE_MAX_FILE_BYTES) {
      throw new Error("Canonical source exceeds the 25 MiB verification limit.");
    }
    chunks.push(Buffer.from(value));
  }
  signal?.throwIfAborted();
  if (bytesRead < 1) throw new Error("Canonical source stream was empty.");

  const bytes = Buffer.concat(chunks, bytesRead);
  const encodedDimensions = contentType === "image/png"
    ? assertCompletePng(bytes)
    : assertCompleteJpeg(bytes);
  enforceDimensionPolicy(encodedDimensions);

  const decoder = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: MAX_PIXELS,
    sequentialRead: true,
  });
  const abortDecoder = () => decoder.destroy();
  signal?.addEventListener("abort", abortDecoder, { once: true });
  try {
    const metadata = await decoder.metadata();
    const expectedFormat = contentType === "image/jpeg" ? "jpeg" : "png";
    if (metadata.format !== expectedFormat) {
      throw new Error(`Canonical source content type does not match decoded ${expectedFormat.toUpperCase()} format.`);
    }
    const dimensions = { widthPx: metadata.width ?? 0, heightPx: metadata.height ?? 0 };
    enforceDimensionPolicy(dimensions);
    if (
      dimensions.widthPx !== encodedDimensions.widthPx ||
      dimensions.heightPx !== encodedDimensions.heightPx
    ) {
      throw new Error("Canonical source decoded dimensions do not match its encoded frame.");
    }
    signal?.throwIfAborted();
    await decoder.stats();
    signal?.throwIfAborted();
    return dimensions;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof Error && /dimensions|pixels|content type/.test(error.message)) throw error;
    const format = contentType === "image/jpeg" ? "JPEG" : "PNG";
    throw new Error(`Canonical source is not a valid fully decoded ${format} image.`, { cause: error });
  } finally {
    signal?.removeEventListener("abort", abortDecoder);
    decoder.destroy();
  }
}

function assertCompletePng(bytes: Buffer): { widthPx: number; heightPx: number } {
  if (bytes.length < 45 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Canonical source is not a valid complete PNG image.");
  }
  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let hasIdat = false;
  let hasIend = false;
  let dimensions = { widthPx: 0, heightPx: 0 };
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("Canonical source is not a valid complete PNG image.");
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) {
      throw new Error("Canonical source is not a valid complete PNG image.");
    }
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) {
      throw new Error("Canonical source is not a valid complete PNG image.");
    }
    if (chunkIndex === 0) {
      dimensions = {
        widthPx: bytes.readUInt32BE(offset + 8),
        heightPx: bytes.readUInt32BE(offset + 12),
      };
    }
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) {
      throw new Error("Canonical source PNG CRC validation failed.");
    }
    if (type === "IDAT") hasIdat ||= length > 0;
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) {
        throw new Error("Canonical source is not a valid complete PNG image.");
      }
      hasIend = true;
    }
    offset = end;
    chunkIndex += 1;
  }
  if (!hasIdat || !hasIend) throw new Error("Canonical source is not a valid complete PNG image.");
  return dimensions;
}

function assertCompleteJpeg(bytes: Buffer): { widthPx: number; heightPx: number } {
  if (
    bytes.length < 6 ||
    bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9
  ) {
    throw new Error("Canonical source is not a valid complete JPEG image.");
  }
  let offset = 2;
  let hasFrame = false;
  let dimensions = { widthPx: 0, heightPx: 0 };
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) throw new Error("Canonical source is not a valid complete JPEG image.");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break;
    if (offset + 2 > bytes.length) throw new Error("Canonical source is not a valid complete JPEG image.");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) {
      throw new Error("Canonical source is not a valid complete JPEG image.");
    }
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (length < 7) throw new Error("Canonical source is not a valid complete JPEG image.");
      hasFrame = true;
      dimensions = {
        widthPx: bytes.readUInt16BE(offset + 5),
        heightPx: bytes.readUInt16BE(offset + 3),
      };
    }
    if (marker === 0xda) {
      if (!hasFrame || offset + length >= bytes.length - 2) {
        throw new Error("Canonical source is not a valid complete JPEG image.");
      }
      return dimensions;
    }
    offset += length;
  }
  throw new Error("Canonical source is not a valid complete JPEG image.");
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function enforceDimensionPolicy({ widthPx, heightPx }: { widthPx: number; heightPx: number }): void {
  if (
    !Number.isSafeInteger(widthPx) ||
    !Number.isSafeInteger(heightPx) ||
    widthPx < 1 ||
    heightPx < 1 ||
    widthPx > MAX_DIMENSION_PX ||
    heightPx > MAX_DIMENSION_PX
  ) {
    throw new Error(`Canonical source dimensions must be between 1 and ${MAX_DIMENSION_PX} pixels.`);
  }
  if (widthPx * heightPx > MAX_PIXELS) {
    throw new Error("Canonical source exceeds the 100 million pixels limit.");
  }
}
