"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  createEnhance,
  createListing,
  createUpload,
  getEnhance,
  type FotelloShotType,
} from "@/lib/integrations/fotello/client";

type ActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function testCreateListing(
  name: string,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Listing name is required." };
  try {
    const listing = await createListing(trimmed);
    return { ok: true, id: listing.id };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function testCreateUpload(
  filename: string,
): Promise<ActionResult<{ id: string; url: string; expires: string }>> {
  await requireAdmin();
  const trimmed = filename.trim();
  if (!trimmed) return { ok: false, error: "Filename is required." };
  try {
    const upload = await createUpload(trimmed);
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
  await requireAdmin();
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
      const listing = await createListing(listingName);
      listingId = listing.id;
    }

    const uploadIds: string[] = [];
    for (const file of files) {
      const upload = await createUpload(file.name);
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

    const enhance = await createEnhance({ listingId, uploadIds, shotType });
    const current = await getEnhance(enhance.id);
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
  await requireAdmin();
  const listingId = input.listingId.trim();
  const uploadIds = input.uploadIds.map((id) => id.trim()).filter(Boolean);
  if (!listingId) return { ok: false, error: "Listing ID is required." };
  if (!uploadIds.length) return { ok: false, error: "At least one upload ID is required." };
  try {
    const enhance = await createEnhance({
      listingId,
      uploadIds,
      shotType: input.shotType,
    });
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
  await requireAdmin();
  const trimmed = id.trim();
  if (!trimmed) return { ok: false, error: "Enhance ID is required." };
  try {
    const enhance = await getEnhance(trimmed);
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
