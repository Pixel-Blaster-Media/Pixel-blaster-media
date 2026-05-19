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
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

interface OrganizationLogoRow {
  logo_url: string | null;
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
        .select("logo_url")
        .eq("id", admin.organizationId)
        .maybeSingle<OrganizationLogoRow>(),
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

  const logo = await resolveLogoField({
    organizationId: admin.organizationId,
    currentUrl: currentOrg.logo_url,
    fileEntry: formData.get("logo_file"),
    clear: formData.get("clear_logo") === "on",
  });
  if (!logo.ok) return { ok: false, error: logo.error };

  const { error } = await service
    .from("organizations")
    .update({
      name,
      slug,
      primary_color: primaryColor,
      accent_color: accentColor,
      logo_url: logo.url,
    })
    .eq("id", admin.organizationId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/settings/business");
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

async function resolveLogoField({
  organizationId,
  currentUrl,
  fileEntry,
  clear,
}: {
  organizationId: string;
  currentUrl: string | null;
  fileEntry: FormDataEntryValue | null;
  clear: boolean;
}): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  if (clear) return { ok: true, url: null };

  const uploaded = await uploadLogoIfPresent(organizationId, fileEntry);
  if (!uploaded.ok) return uploaded;
  if (uploaded.url) return uploaded;

  return { ok: true, url: currentUrl };
}

async function uploadLogoIfPresent(
  organizationId: string,
  entry: FormDataEntryValue | null,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  if (!(entry instanceof File) || entry.size === 0) {
    return { ok: true, url: null };
  }
  if (entry.size > MAX_LOGO_BYTES) {
    return { ok: false, error: "Logo files must be 5 MB or smaller." };
  }
  if (!ALLOWED_LOGO_TYPES.has(entry.type)) {
    return { ok: false, error: "Use a JPG, PNG, WebP, GIF, or SVG logo." };
  }

  const extension = extensionFor(entry);
  const bytes = Buffer.from(await entry.arrayBuffer());
  const path = `organizations/${organizationId}/brand/logo-${Date.now()}-${randomUUID()}.${extension}`;
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
