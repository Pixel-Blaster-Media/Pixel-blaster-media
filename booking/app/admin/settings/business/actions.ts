"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getServiceSupabase } from "@/lib/supabase/server";

export interface BusinessSettingsResult {
  ok: boolean;
  error?: string;
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BRAND_MEDIA_BUCKET = "profile-media";
const MAX_BRAND_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_BRAND_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

interface OrganizationMediaRow {
  logo_url: string | null;
  booking_hero_image_url: string | null;
  booking_hero_secondary_image_url: string | null;
}

export async function saveBusinessSettings(
  _prev: BusinessSettingsResult | null,
  formData: FormData,
): Promise<BusinessSettingsResult> {
  const admin = await requireAdmin();

  const name = cleanText(formData.get("name"));
  const slug = normalizeSlug(cleanText(formData.get("slug")));
  const primaryColor = cleanText(formData.get("primary_color")) || null;
  const accentColor = cleanText(formData.get("accent_color")) || null;
  const emailFromName = cleanText(formData.get("email_from_name")) || name;
  const replyToEmail = cleanText(formData.get("reply_to_email")) || null;
  const adminNotificationEmail =
    cleanText(formData.get("admin_notification_email")) || null;

  if (!name) {
    return { ok: false, error: "Business name is required." };
  }
  if (name.length > 80) {
    return { ok: false, error: "Business name must be 80 characters or fewer." };
  }
  if (!slug || !SLUG_RE.test(slug)) {
    return {
      ok: false,
      error: "Use a simple handle like pixel-blaster-media.",
    };
  }
  if (slug.length > 60) {
    return { ok: false, error: "Booking handle must be 60 characters or fewer." };
  }
  if (primaryColor && !HEX_COLOR_RE.test(primaryColor)) {
    return { ok: false, error: "Primary color must look like #3f7f5f." };
  }
  if (accentColor && !HEX_COLOR_RE.test(accentColor)) {
    return { ok: false, error: "Accent color must look like #c9a35b." };
  }
  if (emailFromName.length > 80) {
    return { ok: false, error: "Email sender name must be 80 characters or fewer." };
  }
  if (replyToEmail && !isEmail(replyToEmail)) {
    return { ok: false, error: "Reply-to email does not look valid." };
  }
  if (adminNotificationEmail && !isEmail(adminNotificationEmail)) {
    return { ok: false, error: "Admin notification email does not look valid." };
  }
  const service = getServiceSupabase();
  const [{ data: slugOwner, error: slugError }, { data: currentOrg, error: currentError }] =
    await Promise.all([
      service
        .from("organizations")
        .select("id")
        .eq("slug", slug)
        .maybeSingle<{ id: string }>(),
      service
        .from("organizations")
        .select("logo_url, booking_hero_image_url, booking_hero_secondary_image_url")
        .eq("id", admin.organizationId)
        .maybeSingle<OrganizationMediaRow>(),
    ]);
  if (slugError) return { ok: false, error: slugError.message };
  if (currentError) return { ok: false, error: currentError.message };
  if (!currentOrg) return { ok: false, error: "Business profile not found." };
  if (slugOwner && slugOwner.id !== admin.organizationId) {
    return {
      ok: false,
      error: "That booking handle is already taken by another company.",
    };
  }

  const logo = await resolveBrandImageField({
    organizationId: admin.organizationId,
    currentUrl: currentOrg.logo_url,
    fileEntry: formData.get("logo_file"),
    clear: formData.get("clear_logo") === "on",
    label: "Logo",
    pathPrefix: "logo",
  });
  if (!logo.ok) return { ok: false, error: logo.error };
  const heroImage = await resolveBrandImageField({
    organizationId: admin.organizationId,
    currentUrl: currentOrg.booking_hero_image_url,
    fileEntry: formData.get("booking_hero_image_file"),
    clear: formData.get("clear_booking_hero_image") === "on",
    label: "Booking page image",
    pathPrefix: "booking-hero",
  });
  if (!heroImage.ok) return { ok: false, error: heroImage.error };
  const heroSecondaryImage = await resolveBrandImageField({
    organizationId: admin.organizationId,
    currentUrl: currentOrg.booking_hero_secondary_image_url,
    fileEntry: formData.get("booking_hero_secondary_image_file"),
    clear: formData.get("clear_booking_hero_secondary_image") === "on",
    label: "Secondary booking page image",
    pathPrefix: "booking-hero-secondary",
  });
  if (!heroSecondaryImage.ok) {
    return { ok: false, error: heroSecondaryImage.error };
  }

  const { error } = await service
    .from("organizations")
    .update({
      name,
      slug,
      primary_color: primaryColor,
      accent_color: accentColor,
      logo_url: logo.url,
      booking_hero_image_url: heroImage.url,
      booking_hero_secondary_image_url: heroSecondaryImage.url,
      email_from_name: emailFromName,
      reply_to_email: replyToEmail,
      admin_notification_email: adminNotificationEmail,
    })
    .eq("id", admin.organizationId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/settings/business");
  revalidatePath("/book");
  return { ok: true };
}

function cleanText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function resolveBrandImageField({
  organizationId,
  currentUrl,
  fileEntry,
  clear,
  label,
  pathPrefix,
}: {
  organizationId: string;
  currentUrl: string | null;
  fileEntry: FormDataEntryValue | null;
  clear: boolean;
  label: string;
  pathPrefix: string;
}): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  if (clear) return { ok: true, url: null };

  const uploaded = await uploadBrandImageIfPresent({
    organizationId,
    entry: fileEntry,
    label,
    pathPrefix,
  });
  if (!uploaded.ok) return uploaded;
  if (uploaded.url) return uploaded;

  return { ok: true, url: currentUrl };
}

async function uploadBrandImageIfPresent({
  organizationId,
  entry,
  label,
  pathPrefix,
}: {
  organizationId: string;
  entry: FormDataEntryValue | null;
  label: string;
  pathPrefix: string;
}): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  if (!(entry instanceof File) || entry.size === 0) {
    return { ok: true, url: null };
  }
  if (entry.size > MAX_BRAND_IMAGE_BYTES) {
    return { ok: false, error: `${label} files must be 5 MB or smaller.` };
  }
  if (!ALLOWED_BRAND_IMAGE_TYPES.has(entry.type)) {
    return {
      ok: false,
      error: `Use a JPG, PNG, WebP, GIF, or SVG for ${label.toLowerCase()}.`,
    };
  }

  const extension = extensionFor(entry);
  const bytes = Buffer.from(await entry.arrayBuffer());
  const path = `organizations/${organizationId}/brand/${pathPrefix}-${Date.now()}-${randomUUID()}.${extension}`;
  const service = getServiceSupabase();
  const { error } = await service.storage
    .from(BRAND_MEDIA_BUCKET)
    .upload(path, bytes, {
      contentType: entry.type,
      cacheControl: "3600",
      upsert: true,
    });
  if (error) return { ok: false, error: error.message };

  const { data } = service.storage.from(BRAND_MEDIA_BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  if (file.type === "image/svg+xml") return "svg";
  return "jpg";
}
