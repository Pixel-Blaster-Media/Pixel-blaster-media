export const MAX_CATALOG_VIDEO_BYTES = 1_000_000_000;
export const CATALOG_VIDEO_MAX_SECONDS = 600;
export const CATALOG_UPLOAD_WINDOW_MS = 6 * 60 * 60_000;
export const CATALOG_UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024;

export function validCatalogUploadSize(size: unknown): size is number {
  return typeof size === "number" && Number.isSafeInteger(size) && size > 0 && size <= MAX_CATALOG_VIDEO_BYTES;
}

export function validUploadFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

// This identifies a reselected file; it is not a claim about full-file integrity.
// Neither filenames nor upload capabilities are written to browser storage.
export async function catalogFileFingerprint(file: File): Promise<string> {
  const header = new TextEncoder().encode(JSON.stringify([file.name, file.size, file.type, file.lastModified]));
  const first = new Uint8Array(await file.slice(0, 65_536).arrayBuffer());
  const last = new Uint8Array(await file.slice(Math.max(0, file.size - 65_536)).arrayBuffer());
  const bytes = new Uint8Array(header.length + first.length + last.length);
  bytes.set(header); bytes.set(first, header.length); bytes.set(last, header.length + first.length);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function validStreamUploadCapability(value: unknown): value is string {
  return Object.values(inspectStreamUploadCapability(value)).every(Boolean);
}

// Booleans only: never retain any part of the bearer capability in diagnostics.
export function inspectStreamUploadCapability(value: unknown) {
  const checks = {
    capabilityPresent: typeof value === "string" && value.length > 0,
    capabilityWithinLength: typeof value === "string" && value.length <= 4096,
    capabilityParseable: false,
    capabilityHttps: false,
    capabilityNoCredentials: false,
    capabilityDefaultPort: false,
    capabilityNoFragment: false,
    capabilityAllowedHost: false,
    capabilityPath: false,
  };
  if (typeof value !== "string" || value.length > 4096) return checks;
  try {
    const url = new URL(value);
    checks.capabilityParseable = true;
    checks.capabilityHttps = url.protocol === "https:";
    checks.capabilityNoCredentials = !url.username && !url.password;
    checks.capabilityDefaultPort = !url.port;
    checks.capabilityNoFragment = !url.hash;
    checks.capabilityAllowedHost = url.hostname === "upload.videodelivery.net"
      || /^[a-z0-9-]+\.cloudflarestream\.com$/.test(url.hostname);
    checks.capabilityPath = url.pathname.length > 1;
  } catch { /* Unparseable capabilities remain rejected without logging input. */ }
  return checks;
}
