import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import {
  fetchIGuideRESO,
  findMediaByCategory,
  type IGuideRESOResponse,
} from "./client";
import {
  iguideEmbedHtml,
  iguideFloorplanPdfUrl,
  iguideUnbrandedUrl,
  iguideViewerUrl,
} from "./parse-id";

type DeliverableInsert =
  Database["public"]["Tables"]["deliverables"]["Insert"];

export interface SyncIGuideResult {
  ok: boolean;
  /** Number of deliverables created or refreshed. */
  upserts: number;
  error?: string;
  /** Useful surface in admin UI when sync ran successfully. */
  address?: string;
}

interface BookingTarget {
  id: string;
  property_id: string;
}

/**
 * Sync the iGuide-derived deliverables (virtual tour + floor plan) onto
 * a booking. Idempotent — re-running on the same booking just refreshes
 * the rows in place via the (source, external_id) unique index, so it's
 * safe to call from both the admin "Sync" button and the webhook.
 */
export async function syncIGuideForBooking(
  iguideId: string,
  booking: BookingTarget,
): Promise<SyncIGuideResult> {
  const fetched = await fetchIGuideRESO(iguideId);
  if (!fetched.ok || !fetched.data) {
    return {
      ok: false,
      upserts: 0,
      error: fetched.error ?? `iGuide fetch failed (${fetched.status}).`,
    };
  }

  const rows = buildDeliverableRows(iguideId, booking, fetched.data);

  const supabase = getServiceSupabase();
  let upserts = 0;
  for (const row of rows) {
    const { error } = await supabase
      .from("deliverables")
      .upsert(row, { onConflict: "source,external_id" });
    if (error) {
      console.error("[iguide.sync] upsert failed", row.type, error);
      return {
        ok: false,
        upserts,
        error: `Saved ${upserts} of ${rows.length} (${row.type} failed: ${error.message}).`,
      };
    }
    upserts += 1;
  }

  return {
    ok: true,
    upserts,
    address: formatAddressFromRESO(fetched.data),
  };
}

/**
 * Look up a booking by its iguide_id and (if found) sync. Used by the
 * webhook handler — the inbound `ready` event tells us which iGuide ID
 * just published, and we map it to whichever booking we previously
 * tagged.
 */
export async function syncIGuideById(
  iguideId: string,
): Promise<SyncIGuideResult & { bookingId?: string }> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .select("id, property_id")
    .eq("iguide_id", iguideId)
    .maybeSingle<BookingTarget>();

  if (error) {
    return { ok: false, upserts: 0, error: error.message };
  }
  if (!data) {
    return {
      ok: false,
      upserts: 0,
      error: `No booking is tagged with iguide_id "${iguideId}" yet.`,
    };
  }

  const result = await syncIGuideForBooking(iguideId, data);
  return { ...result, bookingId: data.id };
}

/**
 * Translate one RESO autofill payload into the rows we want to upsert.
 * Each row carries `source: 'iguide'` and a stable `external_id` so the
 * unique index dedupes re-syncs.
 */
function buildDeliverableRows(
  iguideId: string,
  booking: BookingTarget,
  reso: IGuideRESOResponse,
): DeliverableInsert[] {
  const now = new Date().toISOString();
  const rows: DeliverableInsert[] = [];

  // ---- Virtual tour ----
  const tourMedia =
    findMediaByCategory(reso.Media, "virtual tour") ??
    findMediaByCategory(reso.Media, "tour");
  const tourUrl = tourMedia?.MediaURL ?? iguideViewerUrl(iguideId);

  rows.push({
    booking_id: booking.id,
    property_id: booking.property_id,
    type: "virtual_tour",
    source: "iguide",
    external_id: `${iguideId}/tour`,
    url: tourUrl,
    embed_html: iguideEmbedHtml(iguideId),
    thumbnail_url: pickPreferredPhotoUrl(reso),
    metadata: {
      branded_url: iguideViewerUrl(iguideId),
      unbranded_url: iguideUnbrandedUrl(iguideId),
      living_area: reso.LivingArea ?? null,
      above_grade_interior_area: reso.AboveGradeInteriorArea ?? null,
    },
    ready_at: now,
  });

  // ---- Floor plan ----
  const floorPlanMedia = findMediaByCategory(reso.Media, "floor plan");
  const floorPlanUrl =
    floorPlanMedia?.MediaURL ?? iguideFloorplanPdfUrl(iguideId);

  rows.push({
    booking_id: booking.id,
    property_id: booking.property_id,
    type: "floor_plan",
    source: "iguide",
    external_id: `${iguideId}/floorplan`,
    url: floorPlanUrl,
    thumbnail_url: pickPreferredPhotoUrl(reso),
    metadata: {
      living_area: reso.LivingArea ?? null,
      above_grade_interior_area: reso.AboveGradeInteriorArea ?? null,
      below_grade_interior_area: reso.BelowGradeInteriorArea ?? null,
    },
    ready_at: now,
  });

  return rows;
}

function pickPreferredPhotoUrl(reso: IGuideRESOResponse): string | null {
  const photos = (reso.Media ?? []).filter((m) =>
    (m.MediaCategory ?? m.MediaType ?? "").toLowerCase().includes("photo"),
  );
  if (photos.length === 0) return null;
  const preferred =
    photos.find((p) => p.PreferredPhotoYN === true) ?? photos[0];
  return preferred?.MediaURL ?? null;
}

function formatAddressFromRESO(reso: IGuideRESOResponse): string {
  const street = [reso.StreetNumber, reso.StreetName]
    .filter(Boolean)
    .join(" ");
  const cityProv = [reso.City, reso.StateOrProvince]
    .filter(Boolean)
    .join(", ");
  return [street, cityProv, reso.PostalCode].filter(Boolean).join(" · ");
}
