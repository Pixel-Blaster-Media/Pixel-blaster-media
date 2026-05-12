import "server-only";

import { getCredential } from "@/lib/integrations/credentials";

/**
 * Typed client for Fotello's API.
 *
 * Base URL: https://us-central1-real-estate-firebase-4109e.cloudfunctions.net
 * Auth: Bearer token (static API key issued by Fotello support).
 *
 * Endpoints exposed (matching the OpenAPI spec):
 *   - POST /createListing  { name }                           → { id }
 *   - POST /createUpload   { filename }                       → { id, url, expires }
 *   - POST /createEnhance  { upload_ids, listing_id, shot_type } → { id }
 *   - GET  /getEnhance     ?id=...                            → Enhance
 *   - POST /v1/prepare-download { listing_id, photo_formats, sections } → ZIP URL
 *
 * Our current workflow uses only /getEnhance (you upload in Fotello's UI,
 * we poll for completion). The other endpoints are here so a future
 * "upload from admin" flow can be added without rewriting the client.
 */

export const FOTELLO_BASE_URL =
  process.env.FOTELLO_API_BASE ??
  "https://us-central1-real-estate-firebase-4109e.cloudfunctions.net";

export type FotelloStatus = "in_progress" | "completed" | "pending" | "failed";
export type FotelloShotType = "interior" | "exterior";
export type FotelloPhotoFormat = "mls" | "print" | "original";
export type FotelloDownloadSection =
  | "photos"
  | "videos"
  | "virtual_tours"
  | "floor_plans"
  | "property_websites";

export interface FotelloEnhance {
  id: string;
  status: FotelloStatus;
  /**
   * Fotello-hosted "URL page with downloadable option" — per Fotello
   * support, this is a single link (not a ZIP; a gallery landing page).
   * Nullable while status is in_progress / pending.
   */
  enhanced_image_url: string | null;
  /** ISO timestamp or time string — URL expires, caller must refresh. */
  enhanced_image_url_expires: string | null;
}

export interface FotelloListing {
  id: string;
}

export interface FotelloUpload {
  id: string;
  url: string;
  expires: string;
}

export interface FotelloPreparedDownload {
  download_url: string;
  total_items: number;
  processed_items: number;
}

export class FotelloError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
  }
}

async function apiKey(): Promise<string> {
  const key = await getCredential("fotello", "api_key", "FOTELLO_API_KEY");
  if (!key) {
    throw new FotelloError(
      "Fotello API key not configured. Save it in /admin/settings/integrations or set FOTELLO_API_KEY in env vars.",
      500,
      "",
    );
  }
  return key;
}

function normalizeFotelloApiKey(key: string): string {
  return key.trim().replace(/^Bearer\s+/i, "").replace(/\u0430/g, "a");
}

function authorizationHeader(path: string, key: string): string {
  const normalized = normalizeFotelloApiKey(key);
  return path.startsWith("/v1/") ? `Bearer ${normalized}` : normalized;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  init: { body?: Record<string, unknown>; query?: Record<string, string> } = {},
): Promise<T> {
  const url = new URL(path, FOTELLO_BASE_URL);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    url.searchParams.set(k, v);
  }

  const token = await apiKey();
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      // Fotello's docs label this as BearerAuth, but the Cloud Function
      // currently accepts the raw `api-...` token in Authorization. Sending
      // `Bearer api-...` returns 401 on the original non-v1 endpoints.
      Authorization: authorizationHeader(path, token),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new FotelloError(
      `Fotello ${method} ${path} → ${res.status}`,
      res.status,
      body.slice(0, 500),
    );
  }

  return (await res.json()) as T;
}

// ---- Public API ----

export function getEnhance(id: string): Promise<FotelloEnhance> {
  return request<FotelloEnhance>("GET", "/getEnhance", { query: { id } });
}

export function createListing(name: string): Promise<FotelloListing> {
  return request<FotelloListing>("POST", "/createListing", { body: { name } });
}

export function createUpload(filename: string): Promise<FotelloUpload> {
  return request<FotelloUpload>("POST", "/createUpload", { body: { filename } });
}

export interface CreateEnhanceInput {
  uploadIds: string[];
  listingId: string;
  shotType?: FotelloShotType;
}

export function createEnhance(
  input: CreateEnhanceInput,
): Promise<{ id: string }> {
  return request<{ id: string }>("POST", "/createEnhance", {
    body: {
      upload_ids: input.uploadIds,
      listing_id: input.listingId,
      shot_type: input.shotType ?? "interior",
    },
  });
}

export function fotelloListingShareLink(listingId: string): string {
  return `https://app.fotello.co/listings/${encodeURIComponent(
    listingId.trim(),
  )}/shared`;
}

export interface PrepareDownloadInput {
  listingId: string;
  photoFormats?: FotelloPhotoFormat[];
  sections?: FotelloDownloadSection[];
}

export function prepareDownload(
  input: PrepareDownloadInput,
): Promise<FotelloPreparedDownload> {
  return request<FotelloPreparedDownload>("POST", "/v1/prepare-download", {
    body: {
      listing_id: input.listingId,
      ...(input.photoFormats?.length
        ? { photo_formats: input.photoFormats }
        : {}),
      ...(input.sections?.length ? { sections: input.sections } : {}),
    },
  });
}
