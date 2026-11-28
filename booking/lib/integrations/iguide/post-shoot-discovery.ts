import "server-only";
import { unstable_cache } from "next/cache";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";
import { listIGuides } from "./portal-client";
import {
  DISCOVERY_WINDOW_MS, discoveryBookingStatuses, discoveryDue, eligibleIGuideServices,
  projectDiscoveryTour, selectDiscoveryTour, type DiscoveryBooking, type DiscoveryTour,
} from "./post-shoot-discovery-core";

const LIMIT = 150;
const discoveryEnabled = (organizationId: string) =>
  process.env.IGUIDE_POST_SHOOT_DISCOVERY_ENABLED === "true" && organizationId === DEFAULT_ORGANIZATION_ID;

// Periodically warm a small, tenant-scoped cache. Never cache raw Portal
// responses, URLs, credentials or access tokens.
const getRecentIGuideTours = unstable_cache(async (organizationId: string, _bucket: number) => {
  void _bucket;
  const result = await listIGuides({ organizationId });
  if (!result.ok || !result.data) throw new Error("iGUIDE list unavailable");
  return result.data.map(projectDiscoveryTour).filter((t): t is DiscoveryTour => t !== null);
}, ["iguide-post-shoot-v1"], { revalidate: 600 });

async function discover(organizationId: string, now: number) {
  if (!discoveryEnabled(organizationId)) return { enabled: false, due: 0, matches: new Map<string, DiscoveryTour>() };
  const horizon = 2 * DISCOVERY_WINDOW_MS;
  const { data, error } = await getServiceSupabase().from("bookings")
    .select("id, status, scheduled_at, scheduled_ends_at, iguide_id, iguide_portal_id, unit_number, properties(street_address, city, postal_code)")
    .eq("organization_id", organizationId)
    .in("status", [...discoveryBookingStatuses, "delivered"])
    .or("services.ov.{" + eligibleIGuideServices.join(",") + "},add_ons.ov.{" + eligibleIGuideServices.join(",") + "}")
    .gte("scheduled_at", new Date(now - horizon).toISOString())
    .lte("scheduled_at", new Date(now + DISCOVERY_WINDOW_MS).toISOString())
    .limit(LIMIT + 1).returns<DiscoveryBooking[]>();
  if (error || !data || data.length > LIMIT) throw new Error("iGUIDE booking scan unavailable");
  const due = data.filter((booking) => discoveryDue(booking, now));
  const matches = new Map<string, DiscoveryTour>();
  if (due.length) {
    const tours = await getRecentIGuideTours(organizationId, Math.floor(now / 600000));
    for (const booking of due) {
      const match = selectDiscoveryTour(booking, data, tours, now);
      if (match) matches.set(booking.id, match);
    }
  }
  return { enabled: true, due: due.length, matches };
}

export async function runPostShootIGuideDiscovery() {
  const { enabled, due, matches } = await discover(DEFAULT_ORGANIZATION_ID, Date.now());
  return { enabled, due, found: matches.size }; // counts only; no external or booking writes
}

export async function getPostShootIGuideStage(organizationId: string, bookingId: string): Promise<DiscoveryTour["stage"] | null> {
  if (!discoveryEnabled(organizationId)) return null;
  try {
    return (await discover(organizationId, Date.now())).matches.get(bookingId)?.stage ?? null;
  } catch {
    return null; // never block the booking workspace on an unavailable provider
  }
}
