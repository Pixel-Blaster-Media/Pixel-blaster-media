"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getServiceSupabase } from "@/lib/supabase/server";

export interface BusinessSettingsResult {
  ok: boolean;
  error?: string;
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function saveBusinessSettings(
  _prev: BusinessSettingsResult | null,
  formData: FormData,
): Promise<BusinessSettingsResult> {
  const admin = await requireAdmin();

  const name = cleanText(formData.get("name"));
  const slug = normalizeSlug(cleanText(formData.get("slug")));
  const primaryColor = cleanText(formData.get("primary_color")) || null;
  const accentColor = cleanText(formData.get("accent_color")) || null;
  const logoUrl = cleanText(formData.get("logo_url")) || null;

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
  if (logoUrl && !isSafeHttpUrl(logoUrl)) {
    return { ok: false, error: "Logo URL must start with https:// or http://." };
  }

  const service = getServiceSupabase();
  const { data: slugOwner, error: slugError } = await service
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();
  if (slugError) return { ok: false, error: slugError.message };
  if (slugOwner && slugOwner.id !== admin.organizationId) {
    return {
      ok: false,
      error: "That booking handle is already taken by another company.",
    };
  }

  const { error } = await service
    .from("organizations")
    .update({
      name,
      slug,
      primary_color: primaryColor,
      accent_color: accentColor,
      logo_url: logoUrl,
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

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
