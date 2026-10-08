import { CATALOG_VIDEO_MAX_SECONDS, inspectStreamUploadCapability, validCatalogUploadSize, validStreamUploadCapability } from "./catalog-upload-policy.ts";

const HTTPS_URL_MAX = 2048;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const STREAM_UID = /^[0-9a-f]{32}$/;
const STREAM_CUSTOMER_CODE = /^[A-Za-z0-9]{8,80}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;
const VIMEO_ID = /^\d{5,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CatalogExampleKind = "video" | "interactive" | "link";
export type CatalogExampleSource = "external_url" | "cloudflare_stream";

export class StreamProvisioningError extends Error {
  readonly outcome: "definitive" | "ambiguous";
  readonly streamUid?: string;
  readonly diagnostic?: StreamTusPreparationDiagnostic;

  constructor(message: string, outcome: "definitive" | "ambiguous", streamUid?: string, diagnostic?: StreamTusPreparationDiagnostic) {
    super(message);
    this.name = "StreamProvisioningError";
    this.outcome = outcome;
    this.streamUid = streamUid;
    this.diagnostic = diagnostic;
  }
}

export function nextExampleDisplayOrder(
  examples: ReadonlyArray<{ display_order: number }>,
): number | null {
  const used = new Set(
    examples
      .map((example) => example.display_order)
      .filter((position) => Number.isInteger(position) && position >= 0 && position < 8),
  );
  for (let position = 0; position < 8; position += 1) {
    if (!used.has(position)) return position;
  }
  return null;
}

export function parseExampleUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > HTTPS_URL_MAX) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      unsafeExampleHostname(url.hostname)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function unsafeExampleHostname(raw: string): boolean {
  const host = raw.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host.includes(":")
  );
}

export function toExampleEmbedUrl(raw: string): string | null {
  const parsed = parseExampleUrl(raw);
  if (!parsed) return null;
  const url = new URL(parsed);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return YOUTUBE_ID.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const id = url.pathname.startsWith("/shorts/")
      ? url.pathname.split("/")[2] ?? ""
      : url.searchParams.get("v") ?? "";
    return YOUTUBE_ID.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  }
  if (host === "vimeo.com") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return VIMEO_ID.test(id) ? `https://player.vimeo.com/video/${id}` : null;
  }
  if (host === "youriguide.com" || host.endsWith(".youriguide.com")) {
    return parsed;
  }
  return null;
}

export function toStreamEmbedUrl(
  uid: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const code = env.CLOUDFLARE_STREAM_CUSTOMER_CODE?.trim() ?? "";
  if (!STREAM_UID.test(uid) || !STREAM_CUSTOMER_CODE.test(code)) return null;
  return `https://customer-${code}.cloudflarestream.com/${uid}/iframe`;
}

export interface StreamConfig {
  accountId: string;
  apiToken: string;
  allowedOrigin: string;
}

export function isStreamConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  try {
    loadStreamConfig(env);
    return true;
  } catch {
    return false;
  }
}

export function loadStreamConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): StreamConfig {
  const { accountId, apiToken } = loadStreamApiCredentials(env);
  const appUrl = parseExampleUrl(env.NEXT_PUBLIC_APP_URL ?? "");
  if (!appUrl) throw new Error("The public app URL is not configured for Stream uploads.");
  return Object.freeze({
    accountId,
    apiToken,
    allowedOrigin: new URL(appUrl).hostname,
  });
}

export async function findStreamVideosByClaimIds(
  claimIds: readonly string[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ found: Map<string, string>; absent: Set<string> }> {
  const wanted = new Set(claimIds.filter((id) => UUID.test(id)));
  const found = new Map<string, string>();
  const absent = new Set<string>();
  if (wanted.size === 0) return { found, absent };
  const credentials = loadStreamApiCredentials(env);

  for (const claimId of wanted) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/stream`);
    url.searchParams.set("creator", claimId);
    url.searchParams.set("limit", "2");
    url.searchParams.set("include_counts", "true");
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${credentials.apiToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Cloudflare Stream inventory lookup failed.");
    const raw = await readBoundedProviderJson(response);
    const envelope = raw as {
      success?: unknown;
      result?: unknown;
      result_info?: {
        count?: unknown;
        page?: unknown;
        per_page?: unknown;
        total_count?: unknown;
        total_pages?: unknown;
      };
      range?: unknown;
      total?: unknown;
    };
    const legacyVideos = Array.isArray(envelope.result) ? envelope.result : null;
    const currentResult = (
      envelope.result &&
      typeof envelope.result === "object" &&
      !Array.isArray(envelope.result)
    )
      ? envelope.result as { videos?: unknown; range?: unknown; total?: unknown }
      : null;
    const currentVideos = Array.isArray(currentResult?.videos) ? currentResult.videos : null;
    const videos = legacyVideos ?? currentVideos;
    const info = envelope.result_info;
    const hasLegacyCounts = Boolean(
      info &&
      legacyVideos &&
      info.page === 1 &&
      info.per_page === 2 &&
      info.count === legacyVideos.length &&
      info.total_count === legacyVideos.length &&
      (info.total_pages === 0 || info.total_pages === 1),
    );
    const hasCurrentCounts = Boolean(
      currentResult &&
      currentVideos &&
      currentResult.range === currentVideos.length &&
      currentResult.total === currentVideos.length,
    );
    if (
      envelope.success !== true ||
      !videos ||
      videos.length > 1 ||
      (!hasLegacyCounts && !hasCurrentCounts)
    ) {
      throw new Error("Cloudflare Stream inventory was invalid.");
    }
    if (videos.length === 0) {
      absent.add(claimId);
      continue;
    }
    const entry = videos[0];
    if (!entry || typeof entry !== "object") throw new Error("Cloudflare Stream inventory was invalid.");
    const video = entry as { uid?: unknown; creator?: unknown; meta?: { catalogUploadClaimId?: unknown } };
    if (
      video.creator !== claimId ||
      video.meta?.catalogUploadClaimId !== claimId ||
      typeof video.uid !== "string" ||
      !STREAM_UID.test(video.uid)
    ) {
      throw new Error("Cloudflare Stream inventory correlation was invalid.");
    }
    found.set(claimId, video.uid);
  }
  return { found, absent };
}

export async function deleteStreamVideo(
  uid: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!STREAM_UID.test(uid)) return false;
  let credentials: { accountId: string; apiToken: string };
  try {
    credentials = loadStreamApiCredentials(env);
  } catch {
    return false;
  }
  try {
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/stream/${uid}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${credentials.apiToken}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export async function createStreamDirectUpload(input: {
  name: string;
  operationId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ uid: string; uploadUrl: string }> {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("Example name is required and must be 120 characters or fewer.");
  if (!UUID.test(input.operationId)) throw new Error("Invalid upload operation ID.");
  const config = loadStreamConfig(input.env);
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream/direct_upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maxDurationSeconds: 600,
          allowedOrigins: [config.allowedOrigin],
          requireSignedURLs: false,
          creator: input.operationId,
          meta: { name, catalogUploadClaimId: input.operationId },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new StreamProvisioningError("Cloudflare Stream could not confirm upload preparation.", "ambiguous");
  }
  if (!response.ok) {
    const outcome = response.status >= 500 || response.status === 408 || response.status === 429
      ? "ambiguous"
      : "definitive";
    throw new StreamProvisioningError("Cloudflare Stream rejected upload preparation.", outcome);
  }
  let raw: unknown;
  try {
    raw = await readBoundedProviderJson(response);
  } catch {
    throw new StreamProvisioningError("Cloudflare Stream returned an ambiguous upload response.", "ambiguous");
  }
  const result = parseStreamUploadResponse(raw);
  if (!result) {
    throw new StreamProvisioningError("Cloudflare Stream returned an invalid upload capability.", "ambiguous");
  }
  return result;
}

export async function createStreamTusUpload(input: {
  name: string;
  operationId: string;
  size: number;
  expiresAt: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ uid: string; uploadUrl: string }> {
  const name = input.name.trim();
  if (!name || name.length > 120 || !UUID.test(input.operationId) || !validCatalogUploadSize(input.size)
      || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()) {
    throw new Error("Invalid resumable upload request.");
  }
  const config = loadStreamConfig(input.env);
  const fetchImpl = input.fetchImpl ?? fetch;
  const metadata = Object.entries({
    name, maxDurationSeconds: String(CATALOG_VIDEO_MAX_SECONDS), expiry: input.expiresAt,
    // TUS encodes a comma-separated domain list, not the JSON API's array syntax.
    // There is exactly one configured hostname; keep provider readback strict below.
    allowedorigins: config.allowedOrigin, catalogUploadClaimId: input.operationId,
  }).map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`).join(",");
  let response: Response;
  try {
    response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream?direct_user=true`, {
      method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${config.apiToken}`, "Tus-Resumable": "1.0.0",
        "Upload-Length": String(input.size), "Upload-Metadata": metadata, "Upload-Creator": input.operationId },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new StreamProvisioningError("Cloudflare could not confirm upload preparation.", "ambiguous", undefined,
      { verified: false, stage: "provider_create", httpStatus: null, checks: null });
  }
  if (response.status !== 201) {
    const ambiguous = response.status >= 500 || response.status === 408 || response.status === 429 || response.ok;
    throw new StreamProvisioningError("Cloudflare rejected resumable upload preparation.", ambiguous ? "ambiguous" : "definitive", undefined,
      { verified: false, stage: "provider_create", httpStatus: response.status, checks: null });
  }
  const uid = response.headers.get("stream-media-id");
  const uploadUrl = response.headers.get("Location");
  if (!uid || !STREAM_UID.test(uid) || !validStreamUploadCapability(uploadUrl)) {
    throw new StreamProvisioningError("Cloudflare returned an invalid resumable upload capability.", "ambiguous",
      uid && STREAM_UID.test(uid) ? uid : undefined,
      { verified: false, stage: "capability_validation", httpStatus: response.status,
        checks: { uidPresent: Boolean(uid), uidValid: Boolean(uid && STREAM_UID.test(uid)),
          ...inspectStreamUploadCapability(uploadUrl) } });
  }
  // Do not expose a capability unless the provider retained our restrictions.
  const inspection = await inspectStreamTusReservation({ uid, operationId: input.operationId,
    expiresAt: input.expiresAt, env: input.env, fetchImpl });
  if (!inspection.verified) {
    throw new StreamProvisioningError("Could not verify upload restrictions.", "ambiguous", uid, inspection);
  }
  return { uid, uploadUrl };
}

export interface StreamTusInspection {
  verified: boolean;
  stage: "provider_read" | "restriction_verification";
  httpStatus: number | null;
  checks: {
    success: boolean; uid: boolean; allowedOrigin: boolean; maxDuration: boolean;
    expiry: boolean; creator: boolean; claimMetadata: boolean;
  } | null;
  expiryChecks?: { present: boolean; parseable: boolean; exactMatch: boolean; sameWholeSecond: boolean };
}

export type StreamTusPreparationDiagnostic = StreamTusInspection | {
  verified: false;
  stage: "provider_create";
  httpStatus: number | null;
  checks: null;
} | {
  verified: false;
  stage: "capability_validation";
  httpStatus: number;
  checks: ReturnType<typeof inspectStreamUploadCapability> & { uidPresent: boolean; uidValid: boolean };
};

// Read-only. Never return provider payloads, capabilities, credentials or metadata values.
export async function inspectStreamTusReservation(input: {
  uid: string; operationId: string; expiresAt: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>; fetchImpl?: typeof fetch;
}): Promise<StreamTusInspection> {
  if (!STREAM_UID.test(input.uid) || !UUID.test(input.operationId)
      || !Number.isFinite(Date.parse(input.expiresAt))) throw new Error("Invalid upload inspection.");
  const config = loadStreamConfig(input.env);
  const fetchImpl = input.fetchImpl ?? fetch;
  let httpStatus: number | null = null;
  try {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream/${input.uid}`, {
      headers: { Authorization: `Bearer ${config.apiToken}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    httpStatus = response.status;
    if (!response.ok) return { verified: false, stage: "provider_read", httpStatus, checks: null };
    const data = await readBoundedProviderJson(response) as {
      success?: boolean; result?: { uid?: string; allowedOrigins?: unknown; creator?: string;
        maxDurationSeconds?: number; uploadExpiry?: string; meta?: { catalogUploadClaimId?: string } };
    };
    const rawProviderExpiry = data?.result?.uploadExpiry;
    const expiryPresent = typeof rawProviderExpiry === "string";
    const providerExpiry = typeof rawProviderExpiry === "string" ? Date.parse(rawProviderExpiry) : NaN;
    const expectedExpiry = Date.parse(input.expiresAt);
    const expiryChecks = {
      present: expiryPresent,
      parseable: Number.isFinite(providerExpiry),
      exactMatch: providerExpiry === expectedExpiry,
      // Diagnostic only. A same-second but different-millisecond expiry still fails.
      sameWholeSecond: Math.floor(providerExpiry / 1000) === Math.floor(expectedExpiry / 1000),
    };
    const checks = {
      success: data?.success === true,
      uid: data?.result?.uid === input.uid,
      allowedOrigin: JSON.stringify(data?.result?.allowedOrigins) === JSON.stringify([config.allowedOrigin]),
      maxDuration: data?.result?.maxDurationSeconds === CATALOG_VIDEO_MAX_SECONDS,
      expiry: expiryChecks.exactMatch,
      creator: data?.result?.creator === input.operationId,
      claimMetadata: data?.result?.meta?.catalogUploadClaimId === input.operationId,
    };
    return { verified: Object.values(checks).every(Boolean), stage: "restriction_verification", httpStatus, checks, expiryChecks };
  } catch {
    return { verified: false, stage: "provider_read", httpStatus, checks: null };
  }
}

export interface StreamVideoDetails {
  state: "ready" | "processing" | "failed";
  width: number | null;
  height: number | null;
}

export async function getStreamVideoDetails(
  uid: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<StreamVideoDetails> {
  if (!STREAM_UID.test(uid)) throw new Error("Invalid Cloudflare Stream video ID.");
  const config = loadStreamConfig(env);
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream/${uid}`,
    {
      headers: { Authorization: `Bearer ${config.apiToken}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error("Cloudflare Stream could not check the video.");
  const raw = await readBoundedProviderJson(response);
  if (!raw || typeof raw !== "object" || (raw as { success?: unknown }).success !== true) {
    throw new Error("Cloudflare Stream returned an invalid video status.");
  }
  const result = (raw as { result?: unknown }).result;
  if (!result || typeof result !== "object") throw new Error("Cloudflare Stream returned an invalid video status.");
  const video = result as {
    readyToStream?: unknown;
    status?: { state?: unknown };
    input?: { width?: unknown; height?: unknown };
  };
  const state = video.readyToStream === true || video.status?.state === "ready"
    ? "ready"
    : video.status?.state === "error" ? "failed" : "processing";
  if (state !== "ready") return { state, width: null, height: null };
  const width = video.input?.width;
  const height = video.input?.height;
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || (width as number) < 1
    || (height as number) < 1
    || (width as number) > 32768
    || (height as number) > 32768
  ) {
    throw new Error("Cloudflare Stream returned invalid video dimensions.");
  }
  return { state, width: width as number, height: height as number };
}

export async function getStreamVideoState(
  uid: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<"ready" | "processing" | "failed"> {
  return (await getStreamVideoDetails(uid, env, fetchImpl)).state;
}

async function readBoundedProviderJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared < 0 || declared > 65_536) {
    throw new Error("Cloudflare Stream response was too large.");
  }
  const text = await response.text();
  if (text.length > 65_536) throw new Error("Cloudflare Stream response was too large.");
  return JSON.parse(text);
}

function parseStreamUploadResponse(raw: unknown): { uid: string; uploadUrl: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const envelope = raw as { success?: unknown; result?: unknown };
  if (envelope.success !== true || !envelope.result || typeof envelope.result !== "object") return null;
  const result = envelope.result as { uid?: unknown; uploadURL?: unknown };
  if (typeof result.uid !== "string" || !STREAM_UID.test(result.uid)) return null;
  if (typeof result.uploadURL !== "string" || result.uploadURL.length > 4096) return null;
  try {
    const url = new URL(result.uploadURL);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.hostname !== "upload.videodelivery.net" &&
        !url.hostname.endsWith(".cloudflarestream.com"))
    ) {
      return null;
    }
    return { uid: result.uid, uploadUrl: url.toString() };
  } catch {
    return null;
  }
}

function loadStreamApiCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): { accountId: string; apiToken: string } {
  const accountId = env.CLOUDFLARE_STREAM_ACCOUNT_ID?.trim() ?? "";
  if (!ACCOUNT_ID.test(accountId)) {
    throw new Error("Cloudflare Stream account ID is not configured.");
  }
  const apiToken = env.CLOUDFLARE_STREAM_API_TOKEN ?? "";
  if (apiToken.length < 8 || apiToken.length > 512 || apiToken.trim() !== apiToken) {
    throw new Error("Cloudflare Stream API token is not configured.");
  }
  return { accountId, apiToken };
}
