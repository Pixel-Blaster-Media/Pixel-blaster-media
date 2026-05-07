"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/require-user";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { ListingWebsiteTemplate } from "@/lib/supabase/database.types";

interface PropertyOwnerRow {
  id: string;
  owner_id: string;
  street_address: string;
  city: string | null;
  bookings: { id: string; created_at: string; scheduled_at: string | null }[];
}

export interface ListingWebsiteSaveResult {
  ok: boolean;
  error?: string;
  slug?: string;
}

const TEMPLATES: ListingWebsiteTemplate[] = [
  "estate_cinematic",
  "clean_mls_plus",
  "modern_forest",
  "editorial_magazine",
];

const INCLUDED_SECTION_OPTIONS = [
  "photos",
  "tour",
  "floor_plans",
  "video",
  "property_websites",
] as const;

export async function savePortalListingWebsite(
  propertyId: string,
  formData: FormData,
): Promise<ListingWebsiteSaveResult> {
  const user = await requireUser(`/portal/${propertyId}`);
  const service = getServiceSupabase();

  const { data: property, error: propertyError } = await service
    .from("properties")
    .select("id, owner_id, street_address, city, bookings(id, created_at, scheduled_at)")
    .eq("id", propertyId)
    .eq("owner_id", user.userId)
    .single<PropertyOwnerRow>();

  if (propertyError || !property) {
    return { ok: false, error: "Listing not found." };
  }

  const template = ((formData.get("template") as string | null) ??
    "clean_mls_plus") as ListingWebsiteTemplate;
  if (!TEMPLATES.includes(template)) {
    return { ok: false, error: "Pick a valid template." };
  }

  const existingSlug = cleanOptional(formData.get("existing_slug"));
  const requestedSlug = cleanOptional(formData.get("slug"));
  const slug = normalizeSlug(
    requestedSlug ??
      existingSlug ??
      [property.street_address, property.city].filter(Boolean).join(" "),
  );
  if (!slug) return { ok: false, error: "Public URL slug is required." };

  const heroImageUrl = cleanOptional(formData.get("hero_image_url"));
  const ctaUrl = cleanOptional(formData.get("cta_url"));
  for (const [label, value] of [
    ["Hero image URL", heroImageUrl],
    ["CTA URL", ctaUrl],
  ] as const) {
    if (value && !isSafePublicUrl(value)) {
      return {
        ok: false,
        error: `${label} must start with https://, mailto:, or tel:.`,
      };
    }
  }

  const { data: slugOwner, error: slugError } = await service
    .from("listing_websites")
    .select("property_id")
    .eq("slug", slug)
    .maybeSingle<{ property_id: string }>();
  if (slugError) return { ok: false, error: slugError.message };
  if (slugOwner && slugOwner.property_id !== property.id) {
    return {
      ok: false,
      error: "That public URL is already in use. Try a slightly different slug.",
    };
  }

  const latestBooking = pickLatest(property.bookings);
  const { error } = await service.from("listing_websites").upsert(
    {
      property_id: property.id,
      booking_id: latestBooking?.id ?? null,
      owner_id: user.userId,
      template,
      slug,
      is_published: formData.get("is_published") === "on",
      headline: cleanOptional(formData.get("headline")),
      description: cleanOptional(formData.get("description")),
      feature_bullets: parseFeatureBullets(
        (formData.get("feature_bullets") as string | null) ?? "",
      ),
      included_sections: parseIncludedSections(formData),
      gallery_image_urls: parseGalleryImageUrls(formData),
      hero_image_url: heroImageUrl,
      agent_name: cleanOptional(formData.get("agent_name")) ?? user.fullName,
      agent_email: cleanOptional(formData.get("agent_email")) ?? user.email,
      agent_phone: cleanOptional(formData.get("agent_phone")),
      brokerage_name: cleanOptional(formData.get("brokerage_name")),
      cta_text: cleanOptional(formData.get("cta_text")) ?? "Contact agent",
      cta_url: ctaUrl,
    },
    { onConflict: "property_id" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/portal/${property.id}`);
  revalidatePath(`/listings/${slug}`);
  return { ok: true, slug };
}

function pickLatest(
  bookings: PropertyOwnerRow["bookings"],
): PropertyOwnerRow["bookings"][number] | null {
  if (!bookings || bookings.length === 0) return null;
  return [...bookings].sort((a, b) => {
    const aT = new Date(a.scheduled_at ?? a.created_at).getTime() || 0;
    const bT = new Date(b.scheduled_at ?? b.created_at).getTime() || 0;
    return bT - aT;
  })[0];
}

function cleanOptional(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseFeatureBullets(input: string): string[] {
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const line of input.split(/\r?\n/)) {
    const cleaned = line.replace(/^[-*•]\s*/, "").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(cleaned);
    if (bullets.length >= 8) break;
  }
  return bullets;
}

function parseIncludedSections(formData: FormData): string[] {
  const selected = formData
    .getAll("included_sections")
    .filter((value): value is string => typeof value === "string")
    .filter((value) =>
      (INCLUDED_SECTION_OPTIONS as readonly string[]).includes(value),
    );
  return selected.length > 0 ? selected : [...INCLUDED_SECTION_OPTIONS];
}

function parseGalleryImageUrls(formData: FormData): string[] {
  return formData
    .getAll("gallery_image_urls")
    .filter((value): value is string => typeof value === "string")
    .filter(isSafePublicUrl)
    .slice(0, 48);
}

function isSafePublicUrl(url: string): boolean {
  try {
    if (url.startsWith("mailto:") || url.startsWith("tel:")) return true;
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
