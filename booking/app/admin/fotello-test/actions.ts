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
