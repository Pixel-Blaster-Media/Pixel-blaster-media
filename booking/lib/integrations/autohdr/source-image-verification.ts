import type { CanonicalSourceContentType } from "./source-upload-core.ts";

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_HEADER_BYTES = 1024 * 1024;
const MAX_DIMENSION_PX = 32_768;
const MAX_PIXELS = 100_000_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export async function verifyCanonicalImageStream(
  body: AsyncIterable<unknown>,
  contentType: CanonicalSourceContentType,
): Promise<{ widthPx: number; heightPx: number }> {
  const prefix: Buffer[] = [];
  let prefixBytes = 0;
  let bytesRead = 0;
  for await (const value of body) {
    if (!(value instanceof Uint8Array)) throw new Error("Canonical source stream returned invalid bytes.");
    bytesRead += value.byteLength;
    if (bytesRead > MAX_SOURCE_BYTES) throw new Error("Canonical source exceeds the 100 MiB verification limit.");
    if (prefixBytes < MAX_HEADER_BYTES) {
      const retained = value.subarray(0, Math.min(value.byteLength, MAX_HEADER_BYTES - prefixBytes));
      prefix.push(Buffer.from(retained));
      prefixBytes += retained.byteLength;
    }
  }
  if (bytesRead < 1) throw new Error("Canonical source stream was empty.");
  const header = Buffer.concat(prefix, prefixBytes);
  const dimensions = contentType === "image/jpeg"
    ? jpegDimensions(header)
    : pngDimensions(header);
  enforceDimensionPolicy(dimensions);
  return dimensions;
}

function pngDimensions(header: Buffer): { widthPx: number; heightPx: number } {
  if (
    header.length < 24 ||
    !header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    header.readUInt32BE(8) !== 13 ||
    header.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("Canonical source is not a valid PNG header.");
  }
  return { widthPx: header.readUInt32BE(16), heightPx: header.readUInt32BE(20) };
}

function jpegDimensions(header: Buffer): { widthPx: number; heightPx: number } {
  if (header.length < 4 || header[0] !== 0xff || header[1] !== 0xd8) {
    throw new Error("Canonical source is not a valid JPEG header.");
  }
  let offset = 2;
  while (offset < header.length) {
    if (header[offset] !== 0xff) throw new Error("Canonical source has an invalid JPEG marker.");
    while (offset < header.length && header[offset] === 0xff) offset += 1;
    if (offset >= header.length) break;
    const marker = header[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > header.length) break;
    const segmentLength = header.readUInt16BE(offset);
    if (segmentLength < 2) throw new Error("Canonical source has an invalid JPEG segment.");
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (segmentLength < 7 || offset + 7 > header.length) break;
      return {
        widthPx: header.readUInt16BE(offset + 5),
        heightPx: header.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  throw new Error("Canonical JPEG dimensions were not found within the bounded header.");
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
