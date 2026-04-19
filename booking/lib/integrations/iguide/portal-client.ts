import "server-only";

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
 *   - iguide.list   – list all tours on the account (reserved for the
 *                     future "pick a tour" UI — see `listIGuides`)
 *   - user.account  – list subaccounts (the realtor sub-logins)
 *
 * All endpoints return JSON unless noted. 4xx/5xx surface as
 * `{ok:false, status, error}` rather than throwing — callers decide
 * whether to retry or degrade gracefully.
 */

const DEFAULT_BASE_URL = "https://manage.youriguide.com/api/v1";

function getCredentials(): { appId: string; appToken: string; baseUrl: string } | null {
  const appId = process.env.IGUIDE_APP_ID?.trim();
  const appToken = process.env.IGUIDE_APP_TOKEN?.trim();
  if (!appId || !appToken) return null;
  const baseUrl = (process.env.IGUIDE_API_BASE?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { appId, appToken, baseUrl };
}

/** Is the Portal API configured? Useful to gate admin UI. */
export function hasPortalCredentials(): boolean {
  return getCredentials() !== null;
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
): Promise<PortalResult<T>> {
  const creds = getCredentials();
  if (!creds) {
    return {
      ok: false,
      status: 0,
      error:
        "iGuide Portal API not configured. Set IGUIDE_APP_ID and IGUIDE_APP_TOKEN.",
    };
  }

  const url = `${creds.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

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
    return { ok: false, status: res.status, error: msg };
  }

  return { ok: true, status: res.status, data: parsed as T };
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

// ===========================================================================
// Endpoints we actually use
// ===========================================================================

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
): Promise<PortalResult<IGuideReadyEvent>> {
  const qs = new URLSearchParams({ taskId }).toString();
  return portalFetch<IGuideReadyEvent>(
    `/iguides/${encodeURIComponent(iguideId)}/events/ready/object?${qs}`,
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
): Promise<PortalResult<void>> {
  const qs = new URLSearchParams({ taskId }).toString();
  return portalFetch<void>(
    `/iguides/${encodeURIComponent(iguideId)}/events/ready/dispatch?${qs}`,
    { method: "POST", body: JSON.stringify({}) },
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
): Promise<PortalResult<IGuideAssetUrlsResponse>> {
  return portalFetch<IGuideAssetUrlsResponse>(
    `/iguides/${encodeURIComponent(iguideId)}/asset-urls`,
  );
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
