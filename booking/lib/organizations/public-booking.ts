import "server-only";

import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";

export interface PublicBookingOrganization {
  id: string;
  name: string;
  slug: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  bookingHeroImageUrl: string | null;
  bookingHeroSecondaryImageUrl: string | null;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  primary_color: string | null;
  accent_color: string | null;
  logo_url: string | null;
  booking_hero_image_url: string | null;
  booking_hero_secondary_image_url: string | null;
}

/**
 * Resolve the company whose public booking flow is being used.
 *
 * `/book` remains the default Pixel Blaster flow. `/book?org=some-company`
 * scopes catalog, availability, credentials, and booking inserts to that
 * company without exposing tenant ids to the browser.
 */
export async function resolvePublicBookingOrganization(
  rawSlug?: string | null,
): Promise<PublicBookingOrganization | null> {
  const slug = cleanOrganizationSlug(rawSlug);
  const supabase = getServiceSupabase();
  const query = supabase
    .from("organizations")
    .select(
      "id, name, slug, primary_color, accent_color, logo_url, booking_hero_image_url, booking_hero_secondary_image_url",
    )
    .eq("lifecycle_status", "active");

  const { data, error } = slug
    ? await query.eq("slug", slug).maybeSingle<OrganizationRow>()
    : await query.eq("id", DEFAULT_ORGANIZATION_ID).maybeSingle<OrganizationRow>();

  if (error) {
    throw new Error(`Failed to load booking company: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    primaryColor: data.primary_color,
    accentColor: data.accent_color,
    logoUrl: data.logo_url,
    bookingHeroImageUrl: data.booking_hero_image_url,
    bookingHeroSecondaryImageUrl: data.booking_hero_secondary_image_url,
  };
}

function cleanOrganizationSlug(rawSlug?: string | null): string | null {
  const slug = (rawSlug ?? "").trim().toLowerCase();
  if (!slug) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  return slug.slice(0, 60);
}
