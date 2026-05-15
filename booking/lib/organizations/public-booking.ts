import "server-only";

import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_ORGANIZATION_NAME,
  DEFAULT_ORGANIZATION_SLUG,
} from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";

export interface PublicBookingOrganization {
  id: string;
  name: string;
  slug: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  primary_color: string | null;
  accent_color: string | null;
  logo_url: string | null;
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
    .select("id, name, slug, primary_color, accent_color, logo_url");

  const { data, error } = slug
    ? await query.eq("slug", slug).maybeSingle<OrganizationRow>()
    : await query.eq("id", DEFAULT_ORGANIZATION_ID).maybeSingle<OrganizationRow>();

  if (error) {
    throw new Error(`Failed to load booking company: ${error.message}`);
  }

  if (!data) {
    if (slug) return null;
    return {
      id: DEFAULT_ORGANIZATION_ID,
      name: DEFAULT_ORGANIZATION_NAME,
      slug: DEFAULT_ORGANIZATION_SLUG,
      primaryColor: null,
      accentColor: null,
      logoUrl: null,
    };
  }

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    primaryColor: data.primary_color,
    accentColor: data.accent_color,
    logoUrl: data.logo_url,
  };
}

export function cleanOrganizationSlug(rawSlug?: string | null): string | null {
  const slug = (rawSlug ?? "").trim().toLowerCase();
  if (!slug) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  return slug.slice(0, 60);
}
