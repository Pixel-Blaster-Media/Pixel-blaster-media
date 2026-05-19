import "server-only";

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
 * For our single-tenant use (Pixel Blaster pulls from its own master
 * account) we use an API Token (Portal UI → Settings → API Management →
 * API Tokens tab). Scopes we need:
 *
 *   - iguide.read   – asset URLs, editors, work-order status
 *   - iguide.events – re-fetch the ready event payload on demand
 *   - iguide.list   – visible in iGUIDE's permission UI, but iGUIDE
 *                     confirmed in May 2026 that GET /iguides is not
 *                     exposed for external/customer use yet.
 *   - user.account  – list subaccounts (the realtor sub-logins)
 *
 * All endpoints return JSON unless noted. 4xx/5xx surface as
 * `{ok:false, status, error}` rather than throwing — callers decide
 * whether to retry or degrade gracefully.
 */

const DEFAULT_BASE_URL = "https://manage.youriguide.com/api/v1";

interface PortalScope {
  organizationId?: string;
}

async function getCredentials(
  scope?: PortalScope,
): Promise<{ appId: string; appToken: string; baseUrl: string } | null> {
  const appId = await getCredential(
    "iguide",
    "app_id",
    "IGUIDE_APP_ID",
    scope?.organizationId,
  );
  const appToken = await getCredential(
    "iguide",
    "app_token",
    "IGUIDE_APP_TOKEN",
    scope?.organizationId,
  );
  if (!appId || !appToken) return null;
  const baseUrl = (process.env.IGUIDE_API_BASE?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { appId, appToken, baseUrl };
}

/** Is the Portal API configured? Useful to gate admin UI. */
export async function hasPortalCredentials(scope?: PortalScope): Promise<boolean> {
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
  scope?: PortalScope,
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

  const text = await res.text();
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

export interface IGuideUrlObject {
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

export interface IGuideProperty {
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

export interface IGuideBillingInfo {
  iguideType?: string;
  package?: string;
  addons?: string[];
  billableAreaSqFeet?: number;
  billableAreaSqMeters?: number;
}

export interface IGuideBanner {
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

export interface IGuideSubaccount {
  id: string;
  firstname?: string;
  lastname?: string;
  emailHint?: string;
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
  address: {
    country: string;
    provinceState: string;
    city: string;
    postalCode: string;
    streetName: string;
    streetNumber: string;
    unit?: string;
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

export interface IGuideWorkOrderResponse {
  id?: string;
  workOrderId?: string;
  status?: string;
  state?: string;
  taskType?: string;
  [key: string]: unknown;
}

// ===========================================================================
// Endpoints we actually use
// ===========================================================================

/** Verify the configured iGuide credentials without touching any booking data. */
export async function testPortalCredentials(
  scope?: PortalScope,
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
  scope?: PortalScope,
): Promise<PortalResult<IGuideCreateResponse>> {
  return portalFetch<IGuideCreateResponse>("/iguides/", {
    method: "POST",
    body: JSON.stringify(input),
  }, scope);
}

/** Read the current state of a work order we previously created. */
export async function getWorkOrder(
  iguideId: string,
  workOrderId: string,
  scope?: PortalScope,
): Promise<PortalResult<IGuideWorkOrderResponse>> {
  return portalFetch<IGuideWorkOrderResponse>(
    `/iguides/${encodeURIComponent(iguideId)}/workOrders/${encodeURIComponent(
      workOrderId,
    )}`,
    {},
    scope,
  );
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
  scope?: PortalScope,
): Promise<PortalResult<IGuideReadyEvent>> {
  const qs = new URLSearchParams({ taskId }).toString();
  return portalFetch<IGuideReadyEvent>(
    `/iguides/${encodeURIComponent(iguideId)}/events/ready/object?${qs}`,
    {},
    scope,
  );
}

/**
 * Ask iGuide to re-dispatch the ready event to our webhook. Useful to
 * "replay" when we missed one (e.g. our server was down).
 *
 * Scope: iguide.events.
 */
export async function dispatchReadyEvent(
  iguideId: string,
  taskId: string,
  scope?: PortalScope,
): Promise<PortalResult<void>> {
  const qs = new URLSearchParams({ taskId }).toString();
  return portalFetch<void>(
    `/iguides/${encodeURIComponent(iguideId)}/events/ready/dispatch?${qs}`,
    { method: "POST", body: JSON.stringify({}) },
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
  scope?: PortalScope,
): Promise<PortalResult<IGuideAssetUrlsResponse>> {
  return portalFetch<IGuideAssetUrlsResponse>(
    `/iguides/${encodeURIComponent(iguideId)}/asset-urls`,
    {},
    scope,
  );
}

/**
 * List iGUIDEs available to the configured Portal API credentials.
 *
 * iGUIDE support confirmed this endpoint is not publicly exposed for customer
 * use yet, even though the iguide.list scope appears in their Portal API UI.
 * Keep the normalizer below for the future roadmap item, but do not wire this
 * into product UI until iGUIDE announces the endpoint is available.
 */
export async function listIGuides(
  scope?: PortalScope,
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

/**
 * List the realtor sub-accounts (editors) on our master iGuide account.
 * We'll eventually use this to auto-match tours to Pixel Blaster profiles
 * by email.
 *
 * Scope: user.account.
 */
export async function listSubaccounts(): Promise<PortalResult<IGuideSubaccount[]>> {
  return portalFetch<IGuideSubaccount[]>("/userinfo/subaccounts");
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
