import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import {
  FotelloError,
  getEnhance,
  type FotelloEnhance,
  type FotelloShotType,
} from "./client";

type DeliverableInsert =
  Database["public"]["Tables"]["deliverables"]["Insert"];

export interface SyncFotelloResult {
  ok: boolean;
  /** Enhance status as reported by Fotello — "completed" means gallery is live. */
  status?: FotelloEnhance["status"];
  /** True if we wrote/updated a deliverable row for this enhance. */
  upserted: boolean;
  error?: string;
}

export interface TrackEnhanceArgs {
  enhanceId: string;
  booking: { id: string; property_id: string; fotello_listing_id: string | null };
  shotType?: FotelloShotType;
}

/**
 * Poll /getEnhance for one enhance and upsert a photo_gallery deliverable
 * when it's completed. Idempotent via the (source, external_id) unique
 * index — running this repeatedly just refreshes the stored URL +
 * expires timestamp in metadata.
 *
 * Intended callers:
 *   - Admin "Refresh" button on the Fotello section
 *   - /api/fotello/embed proxy when the cached URL is stale
 *   - (later) a Vercel cron for auto-polling in-progress enhances
 */
export async function syncEnhance({
  enhanceId,
  booking,
  shotType,
}: TrackEnhanceArgs): Promise<SyncFotelloResult> {
  let enhance: FotelloEnhance;
  try {
    enhance = await getEnhance(enhanceId);
  } catch (err) {
    if (err instanceof FotelloError) {
      return { ok: false, upserted: false, error: err.message };
    }
    return {
      ok: false,
      upserted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const supabase = getServiceSupabase();

  // Always upsert a placeholder deliverable row — even for in-progress
  // enhances — so the admin UI has something to render status against.
  // For in-progress, url is an empty-string sentinel (deliverables.url
  // is NOT NULL in schema); we never expose in-progress deliverables on
  // the realtor portal because we filter by ready_at there.
  const isReady = enhance.status === "completed" && !!enhance.enhanced_image_url;

  const row: DeliverableInsert = {
    booking_id: booking.id,
    property_id: booking.property_id,
    type: "photo_gallery",
    source: "fotello",
    external_id: enhance.id,
    url: enhance.enhanced_image_url ?? "about:blank",
    embed_html: null, // we build an iframe ourselves from the URL
    thumbnail_url: null, // Fotello doesn't expose one in the current spec
    metadata: {
      fotello_listing_id: booking.fotello_listing_id,
      status: enhance.status,
      shot_type: shotType ?? null,
      url_expires_at: enhance.enhanced_image_url_expires,
      last_synced_at: new Date().toISOString(),
    },
    ready_at: isReady ? new Date().toISOString() : null,
  };

  const { error } = await supabase
    .from("deliverables")
    .upsert(row, { onConflict: "source,external_id" });

  if (error) {
    console.error("[fotello.sync] upsert failed", error);
    return {
      ok: false,
      upserted: false,
      status: enhance.status,
      error: error.message,
    };
  }

  return {
    ok: true,
    upserted: true,
    status: enhance.status,
  };
}

/**
 * Return a fresh gallery URL for an existing deliverable, refreshing
 * from Fotello if the cached URL is within the 5-minute expiry margin.
 * Used by /api/fotello/embed to serve iframe src values.
 */
export async function getFreshGalleryUrl(
  deliverableId: string,
): Promise<{ url: string | null; status?: string; error?: string }> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("deliverables")
    .select("id, booking_id, property_id, external_id, url, metadata")
    .eq("id", deliverableId)
    .maybeSingle<{
      id: string;
      booking_id: string;
      property_id: string;
      external_id: string | null;
      url: string;
      metadata: {
        url_expires_at?: string | null;
        status?: string;
        fotello_listing_id?: string | null;
      } | null;
    }>();

  if (error || !data) return { url: null, error: "Deliverable not found." };
  if (!data.external_id) return { url: null, error: "No Fotello enhance id on this deliverable." };

  const cachedUrl = data.url;
  const expiresAt = data.metadata?.url_expires_at
    ? Date.parse(data.metadata.url_expires_at)
    : NaN;
  const EXPIRY_MARGIN_MS = 5 * 60 * 1000; // refresh when within 5 min of expiry

  const fresh =
    cachedUrl &&
    cachedUrl !== "about:blank" &&
    !Number.isNaN(expiresAt) &&
    Date.now() + EXPIRY_MARGIN_MS < expiresAt;

  if (fresh) {
    return { url: cachedUrl, status: data.metadata?.status };
  }

  // Refresh via /getEnhance.
  const result = await syncEnhance({
    enhanceId: data.external_id,
    booking: {
      id: data.booking_id,
      property_id: data.property_id,
      fotello_listing_id: data.metadata?.fotello_listing_id ?? null,
    },
  });

  if (!result.ok) {
    return {
      url: null,
      status: result.status,
      error: result.error,
    };
  }
  if (result.status !== "completed") {
    return { url: null, status: result.status };
  }

  // Re-load the freshly-upserted row.
  const { data: refreshed } = await supabase
    .from("deliverables")
    .select("url")
    .eq("id", deliverableId)
    .maybeSingle<{ url: string }>();

  return {
    url: refreshed?.url && refreshed.url !== "about:blank" ? refreshed.url : null,
    status: "completed",
  };
}
