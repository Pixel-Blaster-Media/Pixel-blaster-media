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

  constructor(message: string, outcome: "definitive" | "ambiguous") {
    super(message);
    this.name = "StreamProvisioningError";
    this.outcome = outcome;
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
    const info = envelope.result_info;
    const hasLegacyCounts = Boolean(
      info &&
      info.page === 1 &&
      info.per_page === 2 &&
      info.count === (Array.isArray(envelope.result) ? envelope.result.length : -1) &&
      info.total_count === (Array.isArray(envelope.result) ? envelope.result.length : -1) &&
      (info.total_pages === 0 || info.total_pages === 1),
    );
    const hasCurrentCounts = Boolean(
      Array.isArray(envelope.result) &&
      envelope.range === envelope.result.length &&
      envelope.total === envelope.result.length,
    );
    if (
      envelope.success !== true ||
      !Array.isArray(envelope.result) ||
      envelope.result.length > 1 ||
      (!hasLegacyCounts && !hasCurrentCounts)
    ) {
      throw new Error("Cloudflare Stream inventory was invalid.");
    }
    if (envelope.result.length === 0) {
      absent.add(claimId);
      continue;
    }
    const entry = envelope.result[0];
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

export async function getStreamVideoState(
  uid: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<"ready" | "processing" | "failed"> {
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
  const video = result as { readyToStream?: unknown; status?: { state?: unknown } };
  if (video.readyToStream === true || video.status?.state === "ready") return "ready";
  if (video.status?.state === "error") return "failed";
  return "processing";
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
