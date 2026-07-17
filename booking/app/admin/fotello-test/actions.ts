"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  createEnhance,
  createListing,
  createUpload,
  FOTELLO_BASE_URL,
  fotelloListingShareLink,
  getEnhance,
  prepareDownload,
  type FotelloDownloadSection,
  type FotelloPhotoFormat,
  type FotelloShotType,
} from "@/lib/integrations/fotello/client";
import { getCredential } from "@/lib/integrations/credentials";

type ActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

type PrepareDownloadAttempt = {
  label: string;
  endpoint: string;
  ok: boolean;
  status: number | null;
  body: string;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeListingId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const listingIndex = parts.findIndex((part) => part === "listings");
    if (listingIndex >= 0 && parts[listingIndex + 1]) {
      return parts[listingIndex + 1];
    }
  } catch {
    // Plain listing ids are expected too.
  }
  return trimmed;
}

function normalizeFotelloApiKey(key: string): string {
  return key.trim().replace(/^Bearer\s+/i, "").replace(/\u0430/g, "a");
}

export async function testFotelloShareLink(
  listingIdOrUrl: string,
): Promise<ActionResult<{ listingId: string; shareUrl: string }>> {
  await requireAdmin();
  const listingId = normalizeListingId(listingIdOrUrl);
  if (!listingId) return { ok: false, error: "Listing ID is required." };
  return {
    ok: true,
    listingId,
    shareUrl: fotelloListingShareLink(listingId),
  };
}

export async function testPrepareDownload(input: {
  listingId: string;
  photoFormats: FotelloPhotoFormat[];
  sections: FotelloDownloadSection[];
}): Promise<
  ActionResult<{
    listingId: string;
    downloadUrl: string;
    totalItems: number;
    processedItems: number;
  }>
> {
  const admin = await requireAdmin();
  const listingId = normalizeListingId(input.listingId);
  if (!listingId) return { ok: false, error: "Listing ID is required." };
  try {
    const download = await prepareDownload(
      {
        listingId,
        photoFormats: input.photoFormats,
        sections: input.sections,
      },
      admin.organizationId,
    );
    return {
      ok: true,
      listingId,
      downloadUrl: download.download_url,
      totalItems: download.total_items,
      processedItems: download.processed_items,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function diagnosePrepareDownload(input: {
  listingId: string;
  photoFormats: FotelloPhotoFormat[];
  sections: FotelloDownloadSection[];
}): Promise<
  | {
      ok: true;
      listingId: string;
      downloadUrl: string;
      totalItems: number;
      processedItems: number;
      attempts: PrepareDownloadAttempt[];
    }
  | { ok: false; error: string; attempts: PrepareDownloadAttempt[] }
> {
  const admin = await requireAdmin();
  const listingId = normalizeListingId(input.listingId);
  if (!listingId) {
    return { ok: false, error: "Listing ID is required.", attempts: [] };
  }

  const apiKey = await getCredential(
    "fotello",
    "api_key",
    "FOTELLO_API_KEY",
    admin.organizationId,
  );
  if (!apiKey) {
    return {
      ok: false,
      error: "Fotello API key is not configured.",
      attempts: [],
    };
  }

  const normalizedKey = normalizeFotelloApiKey(apiKey);
  const requestBody = JSON.stringify({
    listing_id: listingId,
    photo_formats: input.photoFormats,
    sections: input.sections,
  });
  const bases = [
    {
      label: "Support path on current API base",
      baseUrl: process.env.FOTELLO_DOWNLOAD_API_BASE ?? FOTELLO_BASE_URL,
      path: "/v1/prepare-download",
      authorization: `Bearer ${normalizedKey}`,
    },
    {
      label: "Cloud Function camelCase",
      baseUrl: FOTELLO_BASE_URL,
      path: "/prepareDownload",
      authorization: normalizedKey,
    },
    {
      label: "Cloud Function kebab-case",
      baseUrl: FOTELLO_BASE_URL,
      path: "/prepare-download",
      authorization: normalizedKey,
    },
    {
      label: "API subdomain v1",
      baseUrl: "https://api.fotello.co",
      path: "/v1/prepare-download",
      authorization: `Bearer ${normalizedKey}`,
    },
    {
      label: "App API v1",
      baseUrl: "https://app.fotello.co",
      path: "/api/v1/prepare-download",
      authorization: `Bearer ${normalizedKey}`,
    },
  ];

  const attempts: PrepareDownloadAttempt[] = [];
  for (const candidate of bases) {
    const url = new URL(candidate.path, candidate.baseUrl);
    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: candidate.authorization,
        },
        body: requestBody,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      attempts.push({
        label: candidate.label,
        endpoint: `${url.origin}${url.pathname}`,
        ok: response.ok,
        status: response.status,
        body: text.slice(0, 300),
      });

      if (response.ok) {
        const json = JSON.parse(text) as {
          download_url?: string;
          total_items?: number;
          processed_items?: number;
        };
        if (json.download_url) {
          return {
            ok: true,
            listingId,
            downloadUrl: json.download_url,
            totalItems: json.total_items ?? 0,
            processedItems: json.processed_items ?? 0,
            attempts,
          };
        }
      }
    } catch (err) {
      attempts.push({
        label: candidate.label,
        endpoint: `${url.origin}${url.pathname}`,
        ok: false,
        status: null,
        body: errorMessage(err).slice(0, 300),
      });
    }
  }

  return {
    ok: false,
    error:
      "None of the tested Fotello prepare-download endpoints returned a ZIP.",
    attempts,
  };
}

export async function testCreateListing(
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Listing name is required." };
  try {
    const listing = await createListing(trimmed, admin.organizationId);
    return { ok: true, id: listing.id };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function testCreateUpload(
  filename: string,
): Promise<ActionResult<{ id: string; url: string; expires: string }>> {
  const admin = await requireAdmin();
  const trimmed = filename.trim();
  if (!trimmed) return { ok: false, error: "Filename is required." };
  try {
    const upload = await createUpload(trimmed, admin.organizationId);
    return {
      ok: true,
      id: upload.id,
      url: upload.url,
      expires: upload.expires,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function testUploadAndEnhance(formData: FormData): Promise<
  ActionResult<{
    listingId: string;
    uploadIds: string[];
    enhanceId: string;
    status: string;
    enhancedImageUrl: string | null;
    enhancedImageUrlExpires: string | null;
  }>
> {
  const admin = await requireAdmin();
  const listingName = String(formData.get("listingName") ?? "").trim();
  let listingId = String(formData.get("listingId") ?? "").trim();
  const shotType = String(formData.get("shotType") ?? "interior") === "exterior"
    ? "exterior"
    : "interior";
  const files = formData.getAll("photos").filter((value) => {
    return (
      typeof value === "object" &&
      value !== null &&
      "arrayBuffer" in value &&
      "name" in value &&
      "size" in value &&
      Number(value.size) > 0
    );
  }) as Array<File>;

  if (!listingId && !listingName) {
    return { ok: false, error: "Listing name is required when no listing ID is provided." };
  }
  if (!files.length) return { ok: false, error: "Pick at least one photo." };

  try {
    if (!listingId) {
      const listing = await createListing(listingName, admin.organizationId);
      listingId = listing.id;
    }

    const uploadIds: string[] = [];
    for (const file of files) {
      const upload = await createUpload(file.name, admin.organizationId);
      const put = await fetch(upload.url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: Buffer.from(await file.arrayBuffer()),
      });
      if (!put.ok) {
        const body = await put.text().catch(() => "");
        throw new Error(
          `Presigned upload failed for ${file.name}: ${put.status} ${body.slice(0, 200)}`,
        );
      }
      uploadIds.push(upload.id);
    }

    const enhance = await createEnhance(
      { listingId, uploadIds, shotType },
      admin.organizationId,
    );
    const current = await getEnhance(enhance.id, admin.organizationId);
    return {
      ok: true,
      listingId,
      uploadIds,
      enhanceId: enhance.id,
      status: current.status,
      enhancedImageUrl: current.enhanced_image_url,
      enhancedImageUrlExpires: current.enhanced_image_url_expires,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function testCreateEnhance(input: {
  listingId: string;
  uploadIds: string[];
  shotType: FotelloShotType;
}): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const listingId = input.listingId.trim();
  const uploadIds = input.uploadIds.map((id) => id.trim()).filter(Boolean);
  if (!listingId) return { ok: false, error: "Listing ID is required." };
  if (!uploadIds.length) return { ok: false, error: "At least one upload ID is required." };
  try {
    const enhance = await createEnhance(
      {
        listingId,
        uploadIds,
        shotType: input.shotType,
      },
      admin.organizationId,
    );
    return { ok: true, id: enhance.id };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function testGetEnhance(id: string): Promise<
  ActionResult<{
    id: string;
    status: string;
    enhancedImageUrl: string | null;
    enhancedImageUrlExpires: string | null;
  }>
> {
  const admin = await requireAdmin();
  const trimmed = id.trim();
  if (!trimmed) return { ok: false, error: "Enhance ID is required." };
  try {
    const enhance = await getEnhance(trimmed, admin.organizationId);
    return {
      ok: true,
      id: enhance.id,
      status: enhance.status,
      enhancedImageUrl: enhance.enhanced_image_url,
      enhancedImageUrlExpires: enhance.enhanced_image_url_expires,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
