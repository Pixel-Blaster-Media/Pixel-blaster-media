"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

const PROFILE_MEDIA_BUCKET = "profile-media";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function updateRealtorProfile(
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const profileId = cleanText(formData.get("profile_id"));
  if (!profileId) return { ok: false, error: "Missing realtor profile." };

  const profilePhotoUrl = parseOptionalUrl(
    cleanText(formData.get("profile_photo_url")),
    "Profile photo URL",
  );
  if (!profilePhotoUrl.ok) return { ok: false, error: profilePhotoUrl.error };

  const brokerageLogoUrl = parseOptionalUrl(
    cleanText(formData.get("brokerage_logo_url")),
    "Brokerage logo URL",
  );
  if (!brokerageLogoUrl.ok) {
    return { ok: false, error: brokerageLogoUrl.error };
  }

  const websiteUrl = parseOptionalUrl(
    cleanText(formData.get("website_url")),
    "Website URL",
  );
  if (!websiteUrl.ok) return { ok: false, error: websiteUrl.error };

  const instagramUrl = parseOptionalUrl(
    cleanText(formData.get("instagram_url")),
    "Instagram URL",
  );
  if (!instagramUrl.ok) return { ok: false, error: instagramUrl.error };

  const service = getServiceSupabase();
  let nextProfilePhotoUrl = profilePhotoUrl.value;
  let nextBrokerageLogoUrl = brokerageLogoUrl.value;

  if (formData.get("clear_profile_photo") === "on") {
    nextProfilePhotoUrl = null;
  } else {
    const upload = await uploadImageIfPresent(
      service,
      profileId,
      "headshot",
      formData.get("profile_photo_file"),
    );
    if (!upload.ok) return { ok: false, error: upload.error };
    if (upload.url) nextProfilePhotoUrl = upload.url;
  }

  if (formData.get("clear_brokerage_logo") === "on") {
    nextBrokerageLogoUrl = null;
  } else {
    const upload = await uploadImageIfPresent(
      service,
      profileId,
      "logo",
      formData.get("brokerage_logo_file"),
    );
    if (!upload.ok) return { ok: false, error: upload.error };
    if (upload.url) nextBrokerageLogoUrl = upload.url;
  }

  const update: ProfileUpdate = {
    full_name: cleanText(formData.get("full_name")) || null,
    phone: cleanText(formData.get("phone")) || null,
    brokerage: cleanText(formData.get("brokerage")) || null,
    profile_photo_url: nextProfilePhotoUrl,
    brokerage_logo_url: nextBrokerageLogoUrl,
    website_url: websiteUrl.value,
    instagram_url: instagramUrl.value,
  };

  const { data: updatedProfile, error } = await service
    .from("profiles")
    .update(update)
    .eq("id", profileId)
    .eq("role", "realtor")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) return { ok: false, error: error.message };
  if (!updatedProfile) {
    return { ok: false, error: "Realtor profile was not found." };
  }

  revalidatePath("/admin/realtors");
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/today");
  revalidatePath("/portal");
  return { ok: true };
}

function cleanText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseOptionalUrl(
  raw: string,
  label: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (!raw) return { ok: true, value: null };
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, error: `${label} must start with http:// or https://.` };
    }
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false, error: `${label} is not a valid link.` };
  }
}

async function uploadImageIfPresent(
  service: ReturnType<typeof getServiceSupabase>,
  profileId: string,
  kind: "headshot" | "logo",
  entry: FormDataEntryValue | null,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  if (!(entry instanceof File) || entry.size === 0) {
    return { ok: true, url: null };
  }
  if (entry.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Images must be 5 MB or smaller." };
  }
  if (!ALLOWED_IMAGE_TYPES.has(entry.type)) {
    return {
      ok: false,
      error: "Use a JPG, PNG, WebP, or GIF image.",
    };
  }

  const extension = extensionFor(entry);
  const path = `realtors/${profileId}/${kind}-${Date.now()}-${randomUUID()}.${extension}`;
  const bytes = Buffer.from(await entry.arrayBuffer());

  const { error } = await service.storage
    .from(PROFILE_MEDIA_BUCKET)
    .upload(path, bytes, {
      contentType: entry.type,
      cacheControl: "3600",
      upsert: true,
    });

  if (error) return { ok: false, error: error.message };

  const { data } = service.storage.from(PROFILE_MEDIA_BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}
