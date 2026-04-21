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
import {
  getAssetUrls,
  getReadyEventObject,
  hasPortalCredentials,
  type IGuideMediaUrls,
  type IGuideReadyEvent,
} from "./portal-client";

type BookingUpdate = Database["public"]["Tables"]["bookings"]["Update"];

type DeliverableInsert =
  Database["public"]["Tables"]["deliverables"]["Insert"];

export interface SyncIGuideResult {
  ok: boolean;
  /** Number of deliverables created or refreshed. */
  upserts: number;
  error?: string;
  /** Useful surface in admin UI when sync ran successfully. */
  address?: string;
  /** Portal ID we discovered during sync (if the booking only knew the alias). */
  portalId?: string;
}

interface BookingTarget {
  id: string;
  property_id: string;
  iguide_id: string | null;
  iguide_portal_id: string | null;
}

/**
 * Sync iGuide-derived deliverables onto a booking.
 *
 * Resolution order:
 *   1. If the booking has an `iguide_portal_id` (set by a prior webhook
 *      delivery), use the authenticated Portal API. That's the richest
 *      source and keeps us on supported endpoints.
 *   2. Otherwise fall back to the public RESO autofill endpoint keyed by
 *      the alias slug. Works without credentials — used for tours that
 *      were pasted in manually before we ever saw a webhook for them.
 *
 * Idempotent — the (source, external_id) unique index dedupes re-syncs.
 */
export async function syncIGuideForBooking(
  booking: BookingTarget,
): Promise<SyncIGuideResult> {
  const alias = booking.iguide_id?.trim() || null;
  const portalId = booking.iguide_portal_id?.trim() || null;

  if (!alias && !portalId) {
    return {
      ok: false,
      upserts: 0,
      error: "Booking has no iGuide alias or portal ID yet.",
    };
  }

  // Prefer the Portal API when we have the portal id + credentials.
  if (portalId && hasPortalCredentials()) {
    const res = await getAssetUrls(portalId);
    if (res.ok && res.data) {
      return persistFromAssetUrls({
        booking,
        portalId,
        alias: alias ?? portalId,
        data: res.data,
      });
    }
    // Portal API failed — log and fall through to RESO if we have an alias.
    console.warn(
      `[iguide.sync] Portal API asset-urls failed for ${portalId}: ${res.error}. Falling back to RESO.`,
    );
  }

  // Fallback: public RESO autofill keyed by alias.
  if (!alias) {
    return {
      ok: false,
      upserts: 0,
      error:
        "No alias on record and Portal API unavailable — re-save the iGuide URL on this booking.",
    };
  }
  const fetched = await fetchIGuideRESO(alias);
  if (!fetched.ok || !fetched.data) {
    return {
      ok: false,
      upserts: 0,
      error: fetched.error ?? `iGuide fetch failed (${fetched.status}).`,
    };
  }

  return persistFromRESO({ booking, alias, data: fetched.data });
}

/**
 * Apply a full ready-event payload (from webhook delivery or Portal API
 * on-demand fetch) to a booking. Also backfills the booking's
 * `iguide_portal_id` if it wasn't set yet — this is how we promote a
 * pasted-alias booking into a Portal-API-first booking.
 */
export async function syncIGuideFromReadyEvent(
  booking: BookingTarget,
  event: IGuideReadyEvent,
): Promise<SyncIGuideResult> {
  const supabase = getServiceSupabase();

  const portalId = event.iguideId;
  const alias = event.iguideAlias ?? booking.iguide_id ?? portalId;

  // Backfill portal id / alias onto the booking row when we learn them.
  const updates: BookingUpdate = {};
  if (portalId && booking.iguide_portal_id !== portalId) {
    updates.iguide_portal_id = portalId;
  }
  if (alias && booking.iguide_id !== alias) {
    updates.iguide_id = alias;
  }
  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", booking.id);
    if (error) {
      console.warn(
        `[iguide.sync] Failed to backfill ids on booking ${booking.id}: ${error.message}`,
      );
    }
  }

  const rows = buildDeliverableRowsFromReady(booking, alias, event);
  const { upserts, error } = await upsertDeliverables(rows);
  if (error) return { ok: false, upserts, error, portalId };

  return {
    ok: true,
    upserts,
    address: event.property?.fullAddress,
    portalId,
  };
}

// ---------------------------------------------------------------------------
// Internal: Portal-API path (asset-urls)
// ---------------------------------------------------------------------------

async function persistFromAssetUrls({
  booking,
  portalId,
  alias,
  data,
}: {
  booking: BookingTarget;
  portalId: string;
  alias: string;
  data: { languages?: Record<string, IGuideMediaUrls | undefined> };
}): Promise<SyncIGuideResult> {
  const media = pickPreferredLanguage(data.languages);
  const rows = buildDeliverableRowsFromMedia({
    bookingId: booking.id,
    propertyId: booking.property_id,
    alias,
    portalId,
    media,
  });
  const { upserts, error } = await upsertDeliverables(rows);
  if (error) return { ok: false, upserts, error, portalId };
  return { ok: true, upserts, portalId };
}

function pickPreferredLanguage(
  languages: Record<string, IGuideMediaUrls | undefined> | undefined,
): IGuideMediaUrls {
  if (!languages) return {};
  // English when available; otherwise any first entry we find.
  return languages.en ?? Object.values(languages).find((v): v is IGuideMediaUrls => !!v) ?? {};
}

function buildDeliverableRowsFromMedia({
  bookingId,
  propertyId,
  alias,
  portalId,
  media,
}: {
  bookingId: string;
  propertyId: string;
  alias: string;
  portalId: string;
  media: IGuideMediaUrls;
}): DeliverableInsert[] {
  const now = new Date().toISOString();

  const tourRow: DeliverableInsert = {
    booking_id: bookingId,
    property_id: propertyId,
    type: "virtual_tour",
    source: "iguide",
    external_id: `${portalId}/tour`,
    url: iguideViewerUrl(alias),
    embed_html: iguideEmbedHtml(alias),
    thumbnail_url: media.galleryFrontImage ?? media.embedImage ?? null,
    metadata: {
      portal_id: portalId,
      alias,
      branded_url: iguideViewerUrl(alias),
      unbranded_url: iguideUnbrandedUrl(alias),
    },
    ready_at: now,
  };

  const floorPlanUrl = media.pdfImperial ?? media.pdfMetric ?? iguideFloorplanPdfUrl(alias);
  const floorPlanRow: DeliverableInsert = {
    booking_id: bookingId,
    property_id: propertyId,
    type: "floor_plan",
    source: "iguide",
    external_id: `${portalId}/floorplan`,
    url: floorPlanUrl,
    thumbnail_url: media.galleryFrontImage ?? null,
    metadata: {
      portal_id: portalId,
      alias,
      pdf_imperial: media.pdfImperial ?? null,
      pdf_metric: media.pdfMetric ?? null,
    },
    ready_at: now,
  };

  return [tourRow, floorPlanRow];
}

// ---------------------------------------------------------------------------
// Internal: webhook-payload path (ready event)
// ---------------------------------------------------------------------------

function buildDeliverableRowsFromReady(
  booking: BookingTarget,
  alias: string,
  event: IGuideReadyEvent,
): DeliverableInsert[] {
  const now = new Date().toISOString();
  const media = pickPreferredLanguage(event.urls?.mediaUrls);
  const portalId = event.iguideId;

  const publicUrl = event.urls?.publicUrl ?? iguideViewerUrl(alias);
  const unbrandedUrl = event.urls?.unbrandedUrl ?? iguideUnbrandedUrl(alias);
  const embedUrl = event.urls?.embeddedUrl ?? null;
  const thumbnail = media.galleryFrontImage ?? media.embedImage ?? null;

  const tourRow: DeliverableInsert = {
    booking_id: booking.id,
    property_id: booking.property_id,
    type: "virtual_tour",
    source: "iguide",
    external_id: `${portalId}/tour`,
    url: publicUrl,
    embed_html: iguideEmbedHtml(alias),
    thumbnail_url: thumbnail,
    metadata: {
      portal_id: portalId,
      alias,
      branded_url: publicUrl,
      unbranded_url: unbrandedUrl,
      embed_url: embedUrl,
      iguide_type: event.billingInfo?.iguideType ?? null,
      addons: event.billingInfo?.addons ?? [],
      billable_area_sqft: event.billingInfo?.billableAreaSqFeet ?? null,
      billable_area_sqm: event.billingInfo?.billableAreaSqMeters ?? null,
      address: event.property?.fullAddress ?? null,
    },
    ready_at: now,
  };

  const floorPlanUrl =
    media.pdfImperial ?? media.pdfMetric ?? iguideFloorplanPdfUrl(alias);
  const floorPlanRow: DeliverableInsert = {
    booking_id: booking.id,
    property_id: booking.property_id,
    type: "floor_plan",
    source: "iguide",
    external_id: `${portalId}/floorplan`,
    url: floorPlanUrl,
    thumbnail_url: thumbnail,
    metadata: {
      portal_id: portalId,
      alias,
      pdf_imperial: media.pdfImperial ?? null,
      pdf_metric: media.pdfMetric ?? null,
    },
    ready_at: now,
  };

  return [tourRow, floorPlanRow];
}

// ---------------------------------------------------------------------------
// Internal: fallback RESO-autofill path (used when we only know the alias
// and have no Portal credentials). This is a subset of the old behaviour.
// ---------------------------------------------------------------------------

async function persistFromRESO({
  booking,
  alias,
  data,
}: {
  booking: BookingTarget;
  alias: string;
  data: IGuideRESOResponse;
}): Promise<SyncIGuideResult> {
  const rows = buildDeliverableRowsFromRESO(booking, alias, data);
  const { upserts, error } = await upsertDeliverables(rows);
  if (error) return { ok: false, upserts, error };
  return {
    ok: true,
    upserts,
    address: formatAddressFromRESO(data),
  };
}

function buildDeliverableRowsFromRESO(
  booking: BookingTarget,
  alias: string,
  reso: IGuideRESOResponse,
): DeliverableInsert[] {
  const now = new Date().toISOString();

  const tourMedia =
    findMediaByCategory(reso.Media, "virtual tour") ??
    findMediaByCategory(reso.Media, "tour");
  const tourUrl = tourMedia?.MediaURL ?? iguideViewerUrl(alias);

  const floorPlanMedia = findMediaByCategory(reso.Media, "floor plan");
  const floorPlanUrl =
    floorPlanMedia?.MediaURL ?? iguideFloorplanPdfUrl(alias);

  return [
    {
      booking_id: booking.id,
      property_id: booking.property_id,
      type: "virtual_tour",
      source: "iguide",
      // No portal_id here — key off the alias, which is at least stable
      // within the lifetime of the tour.
      external_id: `alias:${alias}/tour`,
      url: tourUrl,
      embed_html: iguideEmbedHtml(alias),
      thumbnail_url: pickPreferredPhotoUrl(reso),
      metadata: {
        alias,
        source_api: "reso_autofill",
        branded_url: iguideViewerUrl(alias),
        unbranded_url: iguideUnbrandedUrl(alias),
        living_area: reso.LivingArea ?? null,
      },
      ready_at: now,
    },
    {
      booking_id: booking.id,
      property_id: booking.property_id,
      type: "floor_plan",
      source: "iguide",
      external_id: `alias:${alias}/floorplan`,
      url: floorPlanUrl,
      thumbnail_url: pickPreferredPhotoUrl(reso),
      metadata: {
        alias,
        source_api: "reso_autofill",
      },
      ready_at: now,
    },
  ];
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

// ---------------------------------------------------------------------------
// Shared DB helpers
// ---------------------------------------------------------------------------

async function upsertDeliverables(
  rows: DeliverableInsert[],
): Promise<{ upserts: number; error?: string }> {
  const supabase = getServiceSupabase();
  let upserts = 0;
  for (const row of rows) {
    const { error } = await supabase
      .from("deliverables")
      .upsert(row, { onConflict: "source,external_id" });
    if (error) {
      console.error("[iguide.sync] upsert failed", row.type, error);
      return {
        upserts,
        error: `Saved ${upserts} of ${rows.length} (${row.type} failed: ${error.message}).`,
      };
    }
    upserts += 1;
  }
  return { upserts };
}

/**
 * Look up a booking by either its portal id (preferred) or alias and
 * sync deliverables. Used by the webhook handler.
 */
export async function syncIGuideFromWebhook(
  event: IGuideReadyEvent,
): Promise<SyncIGuideResult & { bookingId?: string }> {
  const supabase = getServiceSupabase();

  const portalId = event.iguideId?.trim();
  const alias = event.iguideAlias?.trim();

  if (!portalId && !alias) {
    return {
      ok: false,
      upserts: 0,
      error: "Event carried neither iguideId nor iguideAlias.",
    };
  }

  // Prefer lookup by portal id (immutable). Fall back to alias only if
  // the booking was tagged via paste before the webhook fired.
  let booking: BookingTarget | null = null;
  if (portalId) {
    const { data } = await supabase
      .from("bookings")
      .select("id, property_id, iguide_id, iguide_portal_id")
      .eq("iguide_portal_id", portalId)
      .maybeSingle<BookingTarget>();
    booking = data ?? null;
  }
  if (!booking && alias) {
    const { data } = await supabase
      .from("bookings")
      .select("id, property_id, iguide_id, iguide_portal_id")
      .eq("iguide_id", alias)
      .maybeSingle<BookingTarget>();
    booking = data ?? null;
  }

  if (!booking) {
    return {
      ok: false,
      upserts: 0,
      error: `No booking is tagged with iGuide ${portalId ?? alias} yet.`,
    };
  }

  const result = await syncIGuideFromReadyEvent(booking, event);
  return { ...result, bookingId: booking.id };
}
