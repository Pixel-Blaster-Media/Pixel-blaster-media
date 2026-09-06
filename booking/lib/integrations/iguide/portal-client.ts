import "server-only";
import { readProviderBytes, mediaSignal } from "./bounded-media";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { getCredential } from "@/lib/integrations/credentials";

/**
 * iGuide Portal REST API client.
 *
 * Docs: https://docs.youriguide.com/rest/
 *
 * Auth is a simple key pair — each request carries two headers:
 *
 *   X-Plntr-App-Id:    your token ID or OAuth client ID
 *   X-Plntr-App-Token: your token value or OAuth access token
 *
 * Each organization supplies its own API Token (Portal UI → Settings → API
 * Management → API Tokens tab). Scopes used by the full workflow:
 *
 *   - iguide.read   – asset URLs, editors, work-order status
 *   - iguide.events – re-fetch the ready event payload on demand
 *   - iguide.write  – create an iGUIDE from a booking
 *   - iguide.process – process supplementary gallery uploads
 *   - iguide.list   – search the organization's portal tours
 *
 * All endpoints return JSON unless noted. 4xx/5xx surface as
 * `{ok:false, status, error}` rather than throwing — callers decide
 * whether to retry or degrade gracefully.
 */

const DEFAULT_BASE_URL = "https://manage.youriguide.com/api/v1";
const PORTAL_FETCH_TIMEOUT_MS = 15_000;

interface PortalScope {
  organizationId: string;
}

async function getCredentials(
  scope: PortalScope,
): Promise<{ appId: string; appToken: string; baseUrl: string } | null> {
  const appId = await getCredential(
    "iguide",
    "app_id",
    "IGUIDE_APP_ID",
    scope.organizationId,
  );
  const appToken = await getCredential(
    "iguide",
    "app_token",
    "IGUIDE_APP_TOKEN",
    scope.organizationId,
  );
  if (!appId || !appToken) return null;
  const baseUrl = (process.env.IGUIDE_API_BASE?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { appId, appToken, baseUrl };
}

/** Is the Portal API configured? Useful to gate admin UI. */
export async function hasPortalCredentials(scope: PortalScope): Promise<boolean> {
  return (await getCredentials(scope)) !== null;
}

export interface PortalResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function portalFetch<T>(
  path: string,
  init: RequestInit = {},
  scope: PortalScope,
): Promise<PortalResult<T>> {
  const creds = await getCredentials(scope);
  if (!creds) {
    return {
      ok: false,
      status: 0,
      error:
        "iGuide Portal API not configured. Save credentials in /admin/settings/integrations or set IGUIDE_APP_ID + IGUIDE_APP_TOKEN.",
    };
  }

  const url = `${creds.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const credentialProblem = validateHeaderCredential(
    "iGUIDE Client ID",
    creds.appId,
  ) ?? validateHeaderCredential("iGUIDE Token", creds.appToken);
  if (credentialProblem) {
    return { ok: false, status: 0, error: credentialProblem };
  }

  let res: Response;
  const signal = init.signal ?? AbortSignal.timeout(PORTAL_FETCH_TIMEOUT_MS);
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "X-Plntr-App-Id": creds.appId,
        "X-Plntr-App-Token": creds.appToken,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      cache: "no-store",
      redirect: init.redirect ?? "manual",
      signal,
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error:
        err instanceof Error ? err.message : "Network error reaching iGuide.",
    };
  }

  // Some endpoints return 302 -> signed S3 URL. We don't follow automatically
  // because the caller may want the redirect target rather than the body.
  if (res.status === 302) {
    const location = res.headers.get("location");
    if (location) {
      return { ok: true, status: res.status, data: { location } as unknown as T };
    }
  }

  if (res.status === 204) {
    return { ok: true, status: res.status, data: undefined };
  }

  let text: string;
  try {
    text = new TextDecoder().decode(await readProviderBytes(res, { maxBytes: 1024 * 1024, signal }));
  } catch {
    return { ok: false, status: 502, error: "iGUIDE response unavailable or exceeds limits." };
  }
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!res.ok) {
        return { ok: false, status: res.status, error: text.slice(0, 500) };
      }
      // Successful but non-JSON (e.g. file download through wrong endpoint).
      return { ok: false, status: res.status, error: "Response wasn't JSON." };
    }
  }

  if (!res.ok) {
    const msg =
      (parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : undefined) ??
      (parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : undefined) ??
      `iGuide returned ${res.status}.`;
    const debugInfo =
      parsed && typeof parsed === "object" && "debugInfo" in parsed
        ? String((parsed as { debugInfo: unknown }).debugInfo)
        : null;
    return {
      ok: false,
      status: res.status,
      error: debugInfo ? `${msg} (${debugInfo})` : msg,
    };
  }

  return { ok: true, status: res.status, data: parsed as T };
}

function validateHeaderCredential(label: string, value: string): string | null {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 255) {
      return `${label} contains a character that cannot be sent to iGUIDE at position ${
        i + 1
      }. Delete and paste it again directly from iGUIDE. Avoid smart quotes, extra labels, or copied formatting.`;
    }
  }
  if (/\s/.test(value)) {
    return `${label} contains a space or line break. Delete and paste only the exact value from iGUIDE.`;
  }
  return null;
}

// ===========================================================================
// Types — modeled from the shapes in the ready-event docs and API reference.
// We intentionally keep these loose (lots of `| null` and `?`) because the
// actual responses carry optional/variable fields depending on tour type.
// ===========================================================================

interface IGuideUrlObject {
  publicUrl?: string;
  unbrandedUrl?: string;
  embeddedUrl?: string;
  manageUrl?: string;
  mediaUrls?: Record<string, IGuideMediaUrls | undefined>;
  // Older payloads sometimes nest differently — keep it permissive.
  media?: unknown;
}

export interface IGuideMediaUrls {
  galleryFrontImage?: string;
  pdfMetric?: string;
  pdfImperial?: string;
  galleryZip?: string;
  galleryMlsZip?: string;
  galleryLowRes?: string;
  galleryLowResZip?: string;
  sphereZip?: string;
  offlineZip?: string;
  svgZip?: string;
  dxfZip?: string;
  embedImage?: string;
  jpgMetric?: Array<{ id: number; floorName: string; url: string }>;
  jpgImperial?: Array<{ id: number; floorName: string; url: string }>;
}

interface IGuideProperty {
  fullAddress?: string;
  country?: string;
  postalCode?: string;
  stateProvince?: string;
  city?: string;
  streetName?: string;
  streetNumber?: string;
  unit?: string;
  location?: { lat?: number; lng?: number };
}

interface IGuideBillingInfo {
  iguideType?: string;
  package?: string;
  addons?: string[];
  billableAreaSqFeet?: number;
  billableAreaSqMeters?: number;
}

interface IGuideBanner {
  fullName?: string;
  title?: string;
  company?: string;
  phones?: Array<{ label?: string; number?: string }>;
  emails?: string[];
  website?: string;
  socialLinks?: Array<{ label?: string; link?: string }>;
}

/** Full shape of the `ready` event payload (also returned by on-demand fetch). */
export interface IGuideReadyEvent {
  type?: string;
  iguideId: string;
  defaultViewId?: string;
  iguideAlias?: string;
  workOrderId?: string;
  authtoken?: string;
  urls?: IGuideUrlObject;
  property?: IGuideProperty;
  summary?: unknown;
  billingInfo?: IGuideBillingInfo;
  banner?: IGuideBanner;
}

/** Response from GET /iguides/:id/asset-urls — organized by language + ADS. */
export interface IGuideAssetUrlsResponse {
  languages?: Record<string, IGuideMediaUrls | undefined>;
  ads?: Array<{ url?: string; [k: string]: unknown }>;
}

export interface IGuideListItem {
  id: string;
  alias?: string | null;
  address?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  manageUrl?: string | null;
  raw?: Record<string, unknown>;
}

export interface IGuideCreateInput {
  type: "standard" | string;
  industry: "residential" | string;
  applyDefaults?: boolean;
  address: {
    country: string;
    provinceState: string;
    city: string;
    postalCode: string;
    streetName: string;
    streetNumber: string;
    unitNumber?: string;
  };
  webhooks?: Array<{
    event: "*" | "ready" | string;
    url: string;
  }>;
}

export interface IGuideCreateResponse {
  id: string;
  alias?: string;
  workOrderId?: string;
  defaultViewId?: string;
  [key: string]: unknown;
}

export interface IGuideUploadAssetInput {
  iguideId: string;
  filename: string;
  bytes: ArrayBuffer;
  contentType?: string;
  appendToViews?: "default" | "all";
  waitForProcess?: boolean;
  signal?: AbortSignal;
  /** Must durably fence each checkpoint before the next external effect. */
  checkpoint?: (receipt: IGuideUploadCheckpoint) => Promise<void>;
}

export interface IGuideUploadCheckpoint {
  phase: "allocating" | "accepted" | "processing";
  assetName?: string;
  jid?: string;
}

/** Read-only reconciliation of the exact accepted asset; never requests a permit. */
export async function getUploadProcessingStatus(iguideId: string, assetName: string, scope: PortalScope): Promise<PortalResult<unknown>> {
  return portalFetch(`/iguides/${encodeURIComponent(iguideId)}/assets/${encodeURIComponent(assetName)}/waitForProcess`,
    { signal: mediaSignal(15_000) }, scope);
}

export interface IGuideUploadResult extends PortalResult<IGuideUploadAssetResponse> {
  outcome: "completed" | "processing" | "rejected" | "reconciliation_required";
}

export interface IGuideUploadAssetResponse {
  assetName: string;
  jid?: string;
  timestamp?: number;
  rawProcessResponse?: unknown;
  processComplete?: boolean;
  processWarning?: string;
}

interface IGuideUploadPermitResponse {
  name: string;
  uploadToken: string;
  uploadPermit: {
    region: string;
    bucket: string;
    key: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  };
}

// ===========================================================================
// Endpoints we actually use
// ===========================================================================

/** Verify the configured iGuide credentials without touching any booking data. */
export async function testPortalCredentials(
  scope: PortalScope,
): Promise<
  PortalResult<{ appId: string }>
> {
  return portalFetch<{ appId: string }>("/integrations/test", {
    method: "POST",
    body: JSON.stringify({}),
  }, scope);
}

/**
 * Create an iGUIDE from a booking/property record. This is the safest path for
 * automation because the response includes the immutable iGUIDE id and initial
 * work order id, which we store immediately for exact webhook matching.
 *
 * Scope: iguide.write.
 */
export async function createIGuide(
  input: IGuideCreateInput,
  scope: PortalScope,
): Promise<PortalResult<IGuideCreateResponse>> {
  return portalFetch<IGuideCreateResponse>("/iguides/", {
    method: "POST",
    body: JSON.stringify(input),
  }, scope);
}

/**
 * Fetch the on-demand `ready` event payload for an already-published tour.
 * This is the same shape the webhook delivers — safe to run through our
 * webhook-payload normalizer.
 *
 * Scope: iguide.events. Requires the workOrderId (passed as ?taskId=) from
 * a prior webhook delivery.
 */
export async function getReadyEventObject(
  iguideId: string,
  taskId: string,
  scope: PortalScope,
): Promise<PortalResult<IGuideReadyEvent>> {
  const qs = new URLSearchParams({ taskId }).toString();
  return portalFetch<IGuideReadyEvent>(
    `/iguides/${encodeURIComponent(iguideId)}/events/ready/object?${qs}`,
    {},
    scope,
  );
}

/**
 * Pull the latest media asset URLs for the default view. This is the
 * preferred refresh mechanism post-publish (e.g. to get a freshly-rotated
 * access token or to pick up an updated floor plan).
 *
 * Scope: iguide.read.
 */
export async function getAssetUrls(
  iguideId: string,
  scope: PortalScope,
): Promise<PortalResult<IGuideAssetUrlsResponse>> {
  return portalFetch<IGuideAssetUrlsResponse>(
    `/iguides/${encodeURIComponent(iguideId)}/asset-urls`,
    {},
    scope,
  );
}

/**
 * Upload a finished photo or asset into an iGUIDE gallery.
 *
 * iGUIDE uses a direct-to-S3 flow:
 * 1. POST /iguides/:id/assets for a temporary upload permit.
 * 2. Upload the bytes to the S3 bucket/key from that permit.
 * 3. POST /assets/:assetName/process with the upload token.
 *
 * Passing appendToViews=default adds photos to the default gallery view, which
 * is what we want for Autoenhance-finished listing photos.
 */
export async function uploadAssetToIGuide(
  input: IGuideUploadAssetInput,
  scope: PortalScope,
): Promise<IGuideUploadResult> {
  const signal = input.signal ?? mediaSignal(60_000);
  const bytes = new Uint8Array(input.bytes);
  if (!bytes.byteLength) {
    return { ok: false, outcome: "rejected", status: 400, error: "Asset file is empty." };
  }
  await input.checkpoint?.({ phase: "allocating" });

  const permit = await portalFetch<IGuideUploadPermitResponse>(
    `/iguides/${encodeURIComponent(input.iguideId)}/assets`,
    {
      method: "POST",
      signal,
      body: JSON.stringify({
        filename: input.filename,
        filesize: bytes.byteLength,
      }),
    },
    scope,
  );
  if (!permit.ok || !permit.data) {
    return {
      ok: false,
      outcome: permit.status >= 400 && permit.status < 500 && ![408, 429].includes(permit.status) ? "rejected" : "reconciliation_required",
      status: permit.status,
      error: "iGUIDE upload permit was not confirmed.",
    };
  }

  if (!permit.data.name || typeof permit.data.name !== "string" || permit.data.name.length > 512) {
    return { ok: false, outcome: "reconciliation_required", status: 502, error: "Invalid iGUIDE permit receipt." };
  }
  const receipt: IGuideUploadAssetResponse = { assetName: permit.data.name };
  const unknown = (status = 0): IGuideUploadResult => ({
    ok: false, outcome: "reconciliation_required", status, data: receipt,
    error: "iGUIDE outcome requires reconciliation; do not upload again.",
  });
  try {
    await input.checkpoint?.({ phase: "accepted", assetName: receipt.assetName });
  } catch { return unknown(); }
  const uploadPermit = permit.data.uploadPermit;
  let s3: S3Client | undefined;
  try {
    s3 = new S3Client({
      region: uploadPermit.region,
      maxAttempts: 1,
      credentials: {
        accessKeyId: uploadPermit.accessKeyId,
        secretAccessKey: uploadPermit.secretAccessKey,
        sessionToken: uploadPermit.sessionToken,
      },
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: uploadPermit.bucket,
        Key: uploadPermit.key,
        Body: bytes,
        ACL: "bucket-owner-full-control",
        ContentType: input.contentType ?? "application/octet-stream",
      }),
      { abortSignal: signal },
    );
  } catch { return unknown(); }
  finally { s3?.destroy(); }

  const query = new URLSearchParams({
    uploadToken: permit.data.uploadToken,
  });
  if (input.appendToViews) {
    query.set("appendToViews", input.appendToViews);
  }
  const processed = await portalFetch<{ jid?: string; timestamp?: number }>(
    `/iguides/${encodeURIComponent(input.iguideId)}/assets/${encodeURIComponent(
      permit.data.name,
    )}/process?${query.toString()}`,
    { method: "POST", signal },
    scope,
  );
  if (!processed.ok) {
    return unknown(processed.status);
  }
  receipt.jid = typeof processed.data?.jid === "string" ? processed.data.jid : undefined;
  try {
    await input.checkpoint?.({ phase: "processing", assetName: receipt.assetName, jid: receipt.jid });
  } catch { return unknown(); }

  let processComplete: boolean | undefined;
  let processWarning: string | undefined;
  if (input.waitForProcess) {
    const wait = await portalFetch<unknown>(
      `/iguides/${encodeURIComponent(input.iguideId)}/assets/${encodeURIComponent(
        permit.data.name,
      )}/waitForProcess`,
      { signal },
      scope,
    );
    if (wait.ok && wait.status === 204) {
      processComplete = true;
    } else if (wait.status === 581) {
      processComplete = false;
      processWarning =
        "iGUIDE accepted the upload, but the background processor is still working. Check the iGUIDE gallery again in a minute.";
    } else {
      return unknown(wait.status);
    }
  }

  return {
    ok: true,
    outcome: processComplete ? "completed" : "processing",
    status: processed.status,
    data: {
      assetName: permit.data.name,
      jid: processed.data?.jid,
      timestamp: processed.data?.timestamp,
      rawProcessResponse: processed.data,
      processComplete,
      processWarning,
    },
  };
}

/**
 * List iGUIDEs available to the configured Portal API credentials.
 *
 * This endpoint was added to the public July 2026 API documentation after being
 * unavailable to customer integrations earlier in the project.
 */
export async function listIGuides(
  scope: PortalScope,
): Promise<PortalResult<IGuideListItem[]>> {
  const result = await portalFetch<unknown>("/iguides", {}, scope);
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
    };
  }
  return {
    ok: true,
    status: result.status,
    data: normalizeIGuideList(result.data),
  };
}

function normalizeIGuideList(value: unknown): IGuideListItem[] {
  const rows = extractIGuideArray(value);
  return rows
    .map((row) => normalizeIGuideListItem(row))
    .filter((row): row is IGuideListItem => Boolean(row?.id));
}

function extractIGuideArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  const candidates = [
    value.iguides,
    value.items,
    value.data,
    value.results,
    value.records,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

function normalizeIGuideListItem(
  row: Record<string, unknown>,
): IGuideListItem | null {
  const id = firstString(row, ["id", "iguideId", "iguide_id"]);
  if (!id) return null;

  const property = isRecord(row.property) ? row.property : null;
  const urls = isRecord(row.urls) ? row.urls : null;
  const address =
    firstString(row, ["address", "fullAddress", "propertyAddress"]) ??
    (property
      ? firstString(property, ["fullAddress", "address", "formattedAddress"]) ??
        [
          firstString(property, ["streetNumber"]),
          firstString(property, ["streetName"]),
          firstString(property, ["city"]),
          firstString(property, ["postalCode"]),
        ]
          .filter(Boolean)
          .join(" ")
      : null);

  return {
    id,
    alias: firstString(row, ["alias", "iguideAlias", "slug"]),
    address: address || null,
    status: firstString(row, ["status", "state"]),
    createdAt: firstString(row, ["createdAt", "created_at", "created"]),
    updatedAt: firstString(row, ["updatedAt", "updated_at", "modifiedAt"]),
    manageUrl:
      firstString(row, ["manageUrl", "editUrl"]) ??
      firstString(urls, ["manageUrl"]),
    raw: row,
  };
}

function firstString(
  row: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
