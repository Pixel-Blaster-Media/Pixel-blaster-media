import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";

import {
  fetchIGuideRESO,
  findMediaByCategory,
  type IGuideRESOMedia,
  type IGuideRESOResponse,
} from "./client";
import {
  iguideEmbedHtml,
  iguideFloorplanPdfUrl,
  iguideUnbrandedUrl,
  iguideViewerUrl,
  parseIGuideAlias,
} from "./parse-id";
import { isIGuidePhotoZipUrl, type IGuidePhotoZipKind } from "./photo-downloads";
import {
  getAssetUrls,
  getReadyEventObject,
  hasPortalCredentials,
  type IGuideMediaUrls,
  type IGuideReadyEvent,
} from "./portal-client";

type BookingUpdate = Database["public"]["Tables"]["bookings"]["Update"];
type IGuideJobInsert = Database["public"]["Tables"]["iguide_jobs"]["Insert"];
type IGuideJobUpdate = Database["public"]["Tables"]["iguide_jobs"]["Update"];
type IGuideWebhookEventInsert =
  Database["public"]["Tables"]["iguide_webhook_events"]["Insert"];

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

interface PropertyMatchBooking extends BookingTarget {
  scheduled_at: string | null;
  status: string;
  properties: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
  } | null;
}

interface WebhookRecord {
  id: string;
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
  if (portalId && (await hasPortalCredentials())) {
    const res = await getAssetUrls(portalId);
    if (res.ok && res.data) {
      return persistFromAssetUrls({
        booking,
        portalId,
        fallbackAlias: alias ?? portalId,
        data: res.data,
      });
    }
    // Portal API failed — log and fall through to RESO if we have an alias.
    console.warn(
      `[iguide.sync] Portal API asset-urls failed for ${portalId}: ${res.error}. Falling back to RESO.`,
    );
    if (!alias) {
      return {
        ok: false,
        upserts: 0,
        error:
          "iGUIDE accepted the Portal ID, but the API could not read this tour's asset links. Paste the public youriguide.com tour URL too, then sync again.",
      };
    }
  }

  // Fallback: public RESO autofill keyed by alias.
  if (!alias) {
    return {
      ok: false,
      upserts: 0,
      error:
        "This booking only has an iGUIDE Portal ID. Paste the public youriguide.com tour URL so the app has a fallback link to sync.",
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
  matchSource = "manual",
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

  await upsertIGuideJobFromReadyEvent(booking, event, matchSource);

  // The ready webhook can be thinner than the authenticated asset-urls
  // response for photo ZIPs. Once we know the immutable Portal ID, do one
  // immediate Portal API refresh so the delivery page gets MLS/high-res photo
  // downloads without relying on a second manual sync.
  if (portalId && (await hasPortalCredentials())) {
    const assetRes = await getAssetUrls(portalId);
    if (assetRes.ok && assetRes.data) {
      const enriched = await persistFromAssetUrls({
        booking: {
          ...booking,
          iguide_id: alias,
          iguide_portal_id: portalId,
        },
        portalId,
        fallbackAlias: alias,
        data: assetRes.data,
      });
      if (enriched.ok) {
        return {
          ok: true,
          upserts: Math.max(upserts, enriched.upserts),
          address: event.property?.fullAddress,
          portalId,
        };
      }
      console.warn(
        `[iguide.sync] Ready-event asset enrichment failed for ${portalId}: ${enriched.error}`,
      );
    } else {
      console.warn(
        `[iguide.sync] Ready-event asset-urls refresh failed for ${portalId}: ${assetRes.error}`,
      );
    }
  }

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
  fallbackAlias,
  data,
}: {
  booking: BookingTarget;
  portalId: string;
  fallbackAlias: string;
  data: { languages?: Record<string, IGuideMediaUrls | undefined> };
}): Promise<SyncIGuideResult> {
  const media = pickPreferredLanguage(data.languages);
  const alias = deriveAliasFromMedia(media) ?? fallbackAlias;
  if (alias !== fallbackAlias && booking.iguide_id !== alias) {
    const { error } = await getServiceSupabase()
      .from("bookings")
      .update({ iguide_id: alias })
      .eq("id", booking.id);
    if (error) {
      console.warn(
        `[iguide.sync] Failed to backfill alias on booking ${booking.id}: ${error.message}`,
      );
    }
  }
  const rows = buildDeliverableRowsFromMedia({
    bookingId: booking.id,
    propertyId: booking.property_id,
    alias,
    portalId,
    media,
    photoUrls: await fetchRESOPhotoUrls(alias),
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

function deriveAliasFromMedia(media: IGuideMediaUrls): string | null {
  const candidates = [
    media.pdfImperial,
    media.pdfMetric,
    media.galleryFrontImage,
    media.embedImage,
    media.galleryZip,
    media.galleryLowResZip,
    media.offlineZip,
    media.sphereZip,
    media.svgZip,
    media.dxfZip,
    ...(media.jpgImperial ?? []).map((item) => item.url),
    ...(media.jpgMetric ?? []).map((item) => item.url),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const alias = parseIGuideAlias(candidate);
    if (alias) return alias;
  }
  return null;
}

function buildDeliverableRowsFromMedia({
  bookingId,
  propertyId,
  alias,
  portalId,
  media,
  photoUrls,
}: {
  bookingId: string;
  propertyId: string;
  alias: string;
  portalId: string;
  media: IGuideMediaUrls;
  photoUrls: string[];
}): DeliverableInsert[] {
  const now = new Date().toISOString();
  const galleryPhotoUrls = uniqueStrings([
    ...photoUrls,
    media.galleryFrontImage,
    media.embedImage,
  ]);
  const photoDownloads = photoDownloadUrlsFromMedia(media);

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

  const rows: DeliverableInsert[] = [tourRow, floorPlanRow];
  if (galleryPhotoUrls.length > 0 || photoDownloads.mls || photoDownloads.highRes) {
    rows.push({
      booking_id: bookingId,
      property_id: propertyId,
      type: "photo_gallery",
      source: "iguide",
      external_id: `${portalId}/photos`,
      url: galleryPhotoUrls[0] ?? photoDownloads.mls ?? photoDownloads.highRes ?? iguideViewerUrl(alias),
      thumbnail_url: galleryPhotoUrls[0] ?? media.galleryFrontImage ?? media.embedImage ?? null,
      metadata: {
        portal_id: portalId,
        alias,
        delivery_label: "iGUIDE photo gallery",
        image_urls: galleryPhotoUrls,
        mls_photo_zip_url: photoDownloads.mls ?? null,
        high_res_photo_zip_url: photoDownloads.highRes ?? null,
      },
      ready_at: now,
    });
  }

  return rows;
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
  const galleryPhotoUrls = uniqueStrings([media.galleryFrontImage, media.embedImage]);
  const photoDownloads = photoDownloadUrlsFromMedia(media, event.authtoken);

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

  const rows: DeliverableInsert[] = [tourRow, floorPlanRow];
  if (galleryPhotoUrls.length > 0 || photoDownloads.mls || photoDownloads.highRes) {
    rows.push({
      booking_id: booking.id,
      property_id: booking.property_id,
      type: "photo_gallery",
      source: "iguide",
      external_id: `${portalId}/photos`,
      url: galleryPhotoUrls[0] ?? photoDownloads.mls ?? photoDownloads.highRes ?? publicUrl,
      thumbnail_url: thumbnail,
      metadata: {
        portal_id: portalId,
        alias,
        delivery_label: "iGUIDE photo gallery",
        image_urls: galleryPhotoUrls,
        mls_photo_zip_url: photoDownloads.mls ?? null,
        high_res_photo_zip_url: photoDownloads.highRes ?? null,
      },
      ready_at: now,
    });
  }

  return rows;
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
  const photoUrls = photoUrlsFromRESO(reso);
  const thumbnailUrl = photoUrls[0] ?? pickPreferredPhotoUrl(reso);

  const tourMedia =
    findMediaByCategory(reso.Media, "virtual tour") ??
    findMediaByCategory(reso.Media, "tour");
  const tourUrl = tourMedia?.MediaURL ?? iguideViewerUrl(alias);

  const floorPlanMedia = findMediaByCategory(reso.Media, "floor plan");
  const floorPlanUrl =
    floorPlanMedia?.MediaURL ?? iguideFloorplanPdfUrl(alias);

  const rows: DeliverableInsert[] = [
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
      thumbnail_url: thumbnailUrl,
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
      thumbnail_url: thumbnailUrl,
      metadata: {
        alias,
        source_api: "reso_autofill",
      },
      ready_at: now,
    },
  ];

  if (photoUrls.length > 0) {
    rows.push({
      booking_id: booking.id,
      property_id: booking.property_id,
      type: "photo_gallery",
      source: "iguide",
      external_id: `alias:${alias}/photos`,
      url: photoUrls[0],
      thumbnail_url: thumbnailUrl,
      metadata: {
        alias,
        source_api: "reso_autofill",
        delivery_label: "iGUIDE photo gallery",
        image_urls: photoUrls,
      },
      ready_at: now,
    });
  }

  return rows;
}

function pickPreferredPhotoUrl(reso: IGuideRESOResponse): string | null {
  const photos = (reso.Media ?? []).filter(isPhotoMedia);
  if (photos.length === 0) return null;
  const preferred =
    photos.find((p) => p.PreferredPhotoYN === true) ?? photos[0];
  return preferred?.MediaURL ?? null;
}

function photoUrlsFromRESO(reso: IGuideRESOResponse): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const media of reso.Media ?? []) {
    if (!isPhotoMedia(media) || !media.MediaURL) continue;
    if (seen.has(media.MediaURL)) continue;
    seen.add(media.MediaURL);
    urls.push(media.MediaURL);
  }
  return urls;
}

function photoDownloadUrlsFromMedia(
  media: IGuideMediaUrls,
  accessToken?: string | null,
): {
  mls: string | null;
  highRes: string | null;
} {
  return {
    mls: usableIGuidePhotoZipUrl(
      media.galleryMlsZip ?? media.galleryLowResZip ?? media.galleryLowRes,
      accessToken,
      "mls",
    ),
    highRes: usableIGuidePhotoZipUrl(media.galleryZip, accessToken, "high_res"),
  };
}

function usableIGuidePhotoZipUrl(
  url: string | null | undefined,
  accessToken?: string | null,
  kind?: IGuidePhotoZipKind,
): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!isIGuidePhotoZipUrl(url, kind)) return null;
    if (accessToken && !parsed.searchParams.has("accessToken")) {
      parsed.searchParams.set("accessToken", accessToken);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchRESOPhotoUrls(alias: string): Promise<string[]> {
  const fetched = await fetchIGuideRESO(alias);
  if (!fetched.ok || !fetched.data) return [];
  return photoUrlsFromRESO(fetched.data);
}

function isPhotoMedia(media: IGuideRESOMedia): boolean {
  const haystack = [media.MediaCategory, media.MediaType, media.ResourceName]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  if (haystack.includes("photo") || haystack.includes("image")) return true;
  return Boolean(media.MediaURL && /\.(jpg|jpeg|png|webp)$/i.test(media.MediaURL));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
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

  const webhookRecord = await saveWebhookEvent(event);
  const matched = await findBookingForReadyEvent(event);
  const booking = matched.booking;

  if (!booking) {
    if (webhookRecord) {
      await updateWebhookEvent(webhookRecord.id, {
        match_status: "unmatched",
        last_error: `No booking matched iGuide ${portalId ?? alias}.`,
      });
    }
    return {
      ok: false,
      upserts: 0,
      error: `No booking is tagged with iGuide ${portalId ?? alias} yet.`,
    };
  }

  const result = await syncIGuideFromReadyEvent(booking, event, matched.source);
  if (webhookRecord) {
    await updateWebhookEvent(webhookRecord.id, {
      match_status: result.ok ? "processed" : "failed",
      matched_booking_id: booking.id,
      match_source: matched.source,
      processed_at: result.ok ? new Date().toISOString() : null,
      last_error: result.ok ? null : result.error ?? "Sync failed.",
    });
  }
  return { ...result, bookingId: booking.id };
}

async function saveWebhookEvent(
  event: IGuideReadyEvent,
): Promise<WebhookRecord | null> {
  const supabase = getServiceSupabase();
  const eventType = event.type ?? "ready";
  const portalId = event.iguideId;
  const workOrderId = event.workOrderId ?? null;

  const existingQuery = supabase
    .from("iguide_webhook_events")
    .select("id")
    .eq("event_type", eventType)
    .eq("iguide_id", portalId);

  const { data: existing } = workOrderId
    ? await existingQuery.eq("work_order_id", workOrderId).maybeSingle<WebhookRecord>()
    : await existingQuery.is("work_order_id", null).maybeSingle<WebhookRecord>();

  const payload: IGuideWebhookEventInsert = {
    event_type: eventType,
    iguide_id: portalId,
    work_order_id: workOrderId,
    alias: event.iguideAlias ?? null,
    payload_json: redactReadyEvent(event),
    match_status: "received",
  };

  if (existing) {
    const { error } = await supabase
      .from("iguide_webhook_events")
      .update(payload)
      .eq("id", existing.id);
    if (error) {
      console.warn("[iguide.webhook] failed to update event inbox", error);
      return null;
    }
    return existing;
  }

  const { data, error } = await supabase
    .from("iguide_webhook_events")
    .insert(payload)
    .select("id")
    .single<WebhookRecord>();
  if (error) {
    console.warn("[iguide.webhook] failed to save event inbox", error);
    return null;
  }
  return data;
}

async function updateWebhookEvent(
  id: string,
  updates: Database["public"]["Tables"]["iguide_webhook_events"]["Update"],
) {
  const { error } = await getServiceSupabase()
    .from("iguide_webhook_events")
    .update(updates)
    .eq("id", id);
  if (error) console.warn("[iguide.webhook] failed to update event status", error);
}

async function findBookingForReadyEvent(
  event: IGuideReadyEvent,
): Promise<{ booking: BookingTarget | null; source: string }> {
  const supabase = getServiceSupabase();
  const portalId = event.iguideId?.trim();
  const alias = event.iguideAlias?.trim();

  if (portalId) {
    const { data: job } = await supabase
      .from("iguide_jobs")
      .select("booking_id, bookings(id, property_id, iguide_id, iguide_portal_id)")
      .eq("iguide_id", portalId)
      .maybeSingle<{
        booking_id: string;
        bookings: BookingTarget | null;
      }>();
    if (job?.bookings) return { booking: job.bookings, source: "job_iguide_id" };

    const { data } = await supabase
      .from("bookings")
      .select("id, property_id, iguide_id, iguide_portal_id")
      .eq("iguide_portal_id", portalId)
      .maybeSingle<BookingTarget>();
    if (data) return { booking: data, source: "booking_portal_id" };
  }

  if (alias) {
    const { data } = await supabase
      .from("bookings")
      .select("id, property_id, iguide_id, iguide_portal_id")
      .eq("iguide_id", alias)
      .maybeSingle<BookingTarget>();
    if (data) return { booking: data, source: "booking_alias" };
  }

  const addressMatch = await findSingleBookingByAddress(event.property);
  if (addressMatch) return { booking: addressMatch, source: "exact_address" };

  return { booking: null, source: "unmatched" };
}

async function findSingleBookingByAddress(
  property: IGuideReadyEvent["property"],
): Promise<BookingTarget | null> {
  const target = normalizeAddress(
    [
      property?.streetNumber,
      property?.streetName,
      property?.unit,
      property?.city,
      property?.postalCode,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const postal = normalizePostalCode(property?.postalCode);
  if (!target || !postal) return null;

  const { data, error } = await getServiceSupabase()
    .from("bookings")
    .select(
      "id, property_id, iguide_id, iguide_portal_id, scheduled_at, status, properties(street_address, city, postal_code)",
    )
    .in("status", ["requested", "confirmed", "shot", "editing", "delivered"])
    .returns<PropertyMatchBooking[]>();

  if (error || !data) {
    if (error) console.warn("[iguide.sync] address match query failed", error);
    return null;
  }

  const matches = data.filter((booking) => {
    const dbPostal = normalizePostalCode(booking.properties?.postal_code);
    if (dbPostal !== postal) return false;
    const dbAddress = normalizeAddress(
      [
        booking.properties?.street_address,
        booking.properties?.city,
        booking.properties?.postal_code,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return dbAddress === target || dbAddress.includes(target) || target.includes(dbAddress);
  });

  if (matches.length !== 1) return null;
  const match = matches[0];
  return {
    id: match.id,
    property_id: match.property_id,
    iguide_id: match.iguide_id,
    iguide_portal_id: match.iguide_portal_id,
  };
}

async function upsertIGuideJobFromReadyEvent(
  booking: BookingTarget,
  event: IGuideReadyEvent,
  matchSource: string,
) {
  const supabase = getServiceSupabase();
  const row: IGuideJobInsert = {
    booking_id: booking.id,
    property_id: booking.property_id,
    iguide_id: event.iguideId,
    alias: event.iguideAlias ?? booking.iguide_id ?? null,
    work_order_id: event.workOrderId ?? null,
    default_view_id: event.defaultViewId ?? null,
    status: "ready",
    match_source: matchSource,
    raw_ready_event: redactReadyEvent(event),
  };
  const { error } = await supabase
    .from("iguide_jobs")
    .upsert(row, { onConflict: "iguide_id" });
  if (error) console.warn("[iguide.sync] failed to upsert job", error);
}

export async function recordIGuideCreateJob(input: {
  bookingId: string;
  propertyId: string;
  iguideId: string;
  alias?: string | null;
  workOrderId?: string | null;
  defaultViewId?: string | null;
  rawCreateResponse: unknown;
}): Promise<{ ok: boolean; error?: string }> {
  const row: IGuideJobInsert = {
    booking_id: input.bookingId,
    property_id: input.propertyId,
    iguide_id: input.iguideId,
    alias: input.alias ?? null,
    work_order_id: input.workOrderId ?? null,
    default_view_id: input.defaultViewId ?? null,
    status: "created",
    match_source: "booking_created",
    raw_create_response: asJsonObject(input.rawCreateResponse),
  };
  const { error } = await getServiceSupabase()
    .from("iguide_jobs")
    .upsert(row, { onConflict: "iguide_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateIGuideJobStatus(
  iguideId: string,
  updates: IGuideJobUpdate,
) {
  const { error } = await getServiceSupabase()
    .from("iguide_jobs")
    .update(updates)
    .eq("iguide_id", iguideId);
  if (error) console.warn("[iguide.sync] failed to update job status", error);
}

function redactReadyEvent(event: IGuideReadyEvent): Json {
  const copy = { ...event } as Record<string, unknown>;
  if ("authtoken" in copy) copy.authtoken = "[redacted]";
  return copy as Json;
}

function asJsonObject(value: unknown): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Json;
  }
  return {};
}

function normalizePostalCode(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toUpperCase();
}

function normalizeAddress(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(court|ct)\b/g, "ct")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
