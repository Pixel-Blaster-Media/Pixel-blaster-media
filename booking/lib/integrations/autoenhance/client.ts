import "server-only";

import { getCredential } from "@/lib/integrations/credentials";

export const AUTOENHANCE_BASE_URL =
  process.env.AUTOENHANCE_API_BASE ?? "https://api.autoenhance.ai";

export type AutoenhanceEnhanceType =
  | "property"
  | "property_usa"
  | "warm"
  | "neutral"
  | "modern";

export type AutoenhanceImageStatus =
  | "pending"
  | "uploading"
  | "uploaded"
  | "processing"
  | "processed"
  | "failed"
  | string;

export type AutoenhanceWindowPullType =
  | "NONE"
  | "ONLY_WINDOWS"
  | "WINDOWS_WITH_SKIES";

export type AutoenhanceCloudType = "CLEAR" | "LOW_CLOUD" | "HIGH_CLOUD";

export interface AutoenhanceRestageOptions {
  fire_in_fireplaces?: "AS_SHOT" | "ALIGHT";
  grass?: "AS_SHOT" | "GREEN";
  photographer?: "AS_SHOT" | "REMOVE";
  tvs?: "AS_SHOT" | "BLACK_OUT";
}

export interface AutoenhanceOrder {
  order_id: string;
  name: string;
  status?: string;
  total_images?: number;
  is_processing?: boolean;
  is_merging?: boolean;
  images?: unknown;
}

export interface AutoenhanceImage {
  image_id: string;
  image_name: string;
  order_id?: string;
  upload_url?: string;
  status?: AutoenhanceImageStatus;
  status_reason?: string | null;
  scene?: string | null;
  enhance_type?: AutoenhanceEnhanceType;
  enhanced?: boolean;
  downloaded?: boolean;
}

export interface AutoenhanceBracket {
  bracket_id: string;
  image_id?: string;
  name: string;
  order_id?: string;
  upload_url?: string;
  is_uploaded?: boolean;
}

export interface AutoenhanceOrderBrackets {
  brackets?: AutoenhanceBracket[];
}

export interface CreateImageInput {
  orderId: string;
  imageName: string;
  enhanceType: AutoenhanceEnhanceType;
  presetId?: string;
  skyReplacement: boolean;
  cloudType?: AutoenhanceCloudType | null;
  windowPullType?: AutoenhanceWindowPullType | null;
  privacy: boolean;
  upscale: boolean;
  tripodHide?: boolean | null;
  restage?: AutoenhanceRestageOptions | null;
}

export interface CreateBracketInput {
  orderId: string;
  name: string;
}

export class AutoenhanceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
  }
}

async function apiKey(organizationId?: string): Promise<string> {
  const key = await getCredential(
    "autoenhance",
    "api_key",
    "AUTOENHANCE_API_KEY",
    organizationId,
  );
  if (!key) {
    throw new AutoenhanceError(
      "Autoenhance API key is not configured. Save it in Settings -> Integrations or set AUTOENHANCE_API_KEY in Vercel.",
      500,
      "",
    );
  }
  return key.trim().replace(/^Bearer\s+/i, "");
}

async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  init: {
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | null | undefined>;
    organizationId?: string;
  } = {},
): Promise<T> {
  const url = new URL(path, AUTOENHANCE_BASE_URL);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value === null || value === undefined) continue;
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": await apiKey(init.organizationId),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new AutoenhanceError(
      `Autoenhance ${method} ${path} -> ${res.status}`,
      res.status,
      body.slice(0, 600),
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function createOrder(
  name: string,
  organizationId?: string,
): Promise<AutoenhanceOrder> {
  return request<AutoenhanceOrder>("POST", "/v3/orders/", {
    organizationId,
    body: { name },
  });
}

export function createImage(
  input: CreateImageInput,
  organizationId?: string,
): Promise<AutoenhanceImage> {
  return request<AutoenhanceImage>("POST", "/v3/images/", {
    organizationId,
    body: {
      order_id: input.orderId,
      image_name: input.imageName,
      enhance: true,
      enhance_type: input.enhanceType,
      ...(input.presetId ? { preset_id: input.presetId } : {}),
      sky_replacement: input.skyReplacement,
      ...(input.cloudType ? { cloud_type: input.cloudType } : {}),
      ...(input.windowPullType ? { window_pull_type: input.windowPullType } : {}),
      privacy: input.privacy,
      upscale: input.upscale,
      ...(input.tripodHide === null || input.tripodHide === undefined
        ? {}
        : { tripod_hide: input.tripodHide }),
      ...(input.restage && Object.keys(input.restage).length
        ? { restage: input.restage }
        : {}),
      lens_correction: true,
      vertical_correction: true,
    },
  });
}

export function createBracket(
  input: CreateBracketInput,
  organizationId?: string,
): Promise<AutoenhanceBracket> {
  return request<AutoenhanceBracket>("POST", "/v3/brackets/", {
    organizationId,
    body: {
      order_id: input.orderId,
      name: input.name,
    },
  });
}

export function getImage(
  imageId: string,
  organizationId?: string,
): Promise<AutoenhanceImage> {
  return request<AutoenhanceImage>(
    "GET",
    `/v3/images/${encodeURIComponent(imageId)}`,
    { organizationId },
  );
}

export function getOrder(
  orderId: string,
  organizationId?: string,
): Promise<AutoenhanceOrder> {
  return request<AutoenhanceOrder>(
    "GET",
    `/v3/orders/${encodeURIComponent(orderId)}`,
    { organizationId },
  );
}

export function getOrderBrackets(
  orderId: string,
  organizationId?: string,
): Promise<AutoenhanceOrderBrackets> {
  return request<AutoenhanceOrderBrackets>(
    "GET",
    `/v3/orders/${encodeURIComponent(orderId)}/brackets`,
    { organizationId },
  );
}

export function processOrder(
  orderId: string,
  organizationId?: string,
  options: {
    bracketGroups?: string[][];
    bracketsPerImage?: number;
    enhanceType?: AutoenhanceEnhanceType;
    presetId?: string;
    skyReplacement?: boolean;
    cloudType?: AutoenhanceCloudType | null;
    windowPullType?: AutoenhanceWindowPullType | null;
    privacy?: boolean;
    upscale?: boolean;
    tripodHide?: boolean | null;
    restage?: AutoenhanceRestageOptions | null;
  } = {},
): Promise<AutoenhanceOrder> {
  return request<AutoenhanceOrder>(
    "POST",
    `/v3/orders/${encodeURIComponent(orderId)}/process`,
    {
      organizationId,
      body: {
        ai_version: "5.x",
        enhance: true,
        ...(options.bracketGroups?.length
          ? {
              images: options.bracketGroups.map((bracketIds) => ({
                bracket_ids: bracketIds,
              })),
            }
          : {}),
        ...(options.bracketsPerImage && options.bracketsPerImage > 0
          ? { number_of_brackets_per_image: options.bracketsPerImage }
          : {}),
        ...(options.enhanceType ? { enhance_type: options.enhanceType } : {}),
        ...(options.presetId ? { preset_id: options.presetId } : {}),
        sky_replacement: options.skyReplacement ?? false,
        ...(options.cloudType ? { cloud_type: options.cloudType } : {}),
        ...(options.windowPullType ? { window_pull_type: options.windowPullType } : {}),
        privacy: options.privacy ?? true,
        upscale: options.upscale ?? false,
        ...(options.tripodHide === null || options.tripodHide === undefined
          ? {}
          : { tripod_hide: options.tripodHide }),
        ...(options.restage && Object.keys(options.restage).length
          ? { restage: options.restage }
          : {}),
        lens_correction: true,
        vertical_correction: true,
      },
    },
  );
}

export async function fetchEnhancedImage(
  imageId: string,
  options: {
    organizationId?: string;
    format?: "jpeg" | "png" | "webp" | "avif";
    quality?: number;
    preview?: boolean;
    maxWidth?: number;
    devMode?: boolean;
  } = {},
): Promise<Response> {
  const url = new URL(
    `/v3/images/${encodeURIComponent(imageId)}/enhanced`,
    AUTOENHANCE_BASE_URL,
  );
  url.searchParams.set("format", options.format ?? "jpeg");
  if (options.quality) url.searchParams.set("quality", String(options.quality));
  if (options.preview !== undefined) {
    url.searchParams.set("preview", String(options.preview));
  }
  if (options.maxWidth) url.searchParams.set("max_width", String(options.maxWidth));

  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": await apiKey(options.organizationId),
      ...(options.devMode ? { "x-dev-mode": "true" } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new AutoenhanceError(
      `Autoenhance GET /v3/images/${imageId}/enhanced -> ${res.status}`,
      res.status,
      body.slice(0, 600),
    );
  }
  return res;
}
