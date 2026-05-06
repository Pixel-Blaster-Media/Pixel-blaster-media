"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { nextBookingStatuses } from "@/lib/booking/booking-status";
import { cancelBooking } from "@/lib/booking/cancel";
import {
  createEnhance,
  createListing,
  createUpload,
  type FotelloShotType,
} from "@/lib/integrations/fotello/client";
import { syncEnhance } from "@/lib/integrations/fotello/sync";
import {
  parseIGuideAlias,
  parseIGuidePortalId,
} from "@/lib/integrations/iguide/parse-id";
import { createIGuide as createIGuideInPortal } from "@/lib/integrations/iguide/portal-client";
import {
  recordIGuideCreateJob,
  syncIGuideForBooking,
} from "@/lib/integrations/iguide/sync";
import {
  createInvoiceForBooking,
  refreshInvoiceStatus as refreshInvoiceInQBO,
} from "@/lib/integrations/quickbooks/invoice";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableType,
} from "@/lib/supabase/database.types";

interface BookingStatusRow {
  status: BookingStatus;
}

interface BookingMinimalRow {
  id: string;
  property_id: string;
}

interface BookingFotelloRow {
  id: string;
  property_id: string;
  fotello_listing_id: string | null;
  properties: {
    street_address: string;
    city: string | null;
  } | null;
}

interface BookingWithIGuideRow {
  id: string;
  property_id: string;
  iguide_id: string | null;
  iguide_portal_id: string | null;
}

interface BookingForIGuideCreateRow {
  id: string;
  property_id: string;
  unit_number: string | null;
  iguide_id: string | null;
  iguide_portal_id: string | null;
  properties: {
    street_address: string;
    city: string | null;
    province: string | null;
    postal_code: string | null;
  } | null;
}

interface BookingForInvoiceRow {
  id: string;
  services: string[];
  add_ons: string[];
  property_id: string;
  owner_id: string;
  properties: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
  } | null;
  profiles: {
    email: string;
    full_name: string | null;
    phone: string | null;
    brokerage: string | null;
  } | null;
}

const VALID_DELIVERABLE_TYPES: DeliverableType[] = [
  "photo_gallery",
  "virtual_tour",
  "floor_plan",
  "video",
  "aerial",
];

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Move a booking forward in the status pipeline.
 *
 * The set of allowed transitions lives in `nextBookingStatuses` and is
 * re-validated server-side here so a manipulated client can't jump
 * straight from `confirmed` → `delivered`.
 */
export async function updateBookingStatus(
  bookingId: string,
  next: BookingStatus,
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await getServerSupabase();

  const { data: current, error: loadErr } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .single<BookingStatusRow>();

  if (loadErr || !current) return { ok: false, error: "Booking not found." };

  const allowed = nextBookingStatuses(current.status);
  if (!allowed.includes(next)) {
    return {
      ok: false,
      error: `Can't move from ${current.status} to ${next}.`,
    };
  }

  const service = getServiceSupabase();
  const { error } = await service
    .from("bookings")
    .update({ status: next })
    .eq("id", bookingId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true };
}

/**
 * Admin-initiated cancel — includes side effects the pipeline button
 * doesn't (delete Google Calendar event, email the realtor). Use this
 * for user-facing "cancellations", and reserve `updateBookingStatus`
 * for normal pipeline progression.
 */
export async function cancelBookingAsAdmin(
  bookingId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const result = await cancelBooking(bookingId, "admin");
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true };
}

/**
 * Manual deliverable entry — the Phase 3 fallback before the iGuide /
 * Fotello sync goes live in Phase 4/5. Source is always 'manual' here.
 *
 * Uses the service-role client so the deliverables RLS policy
 * (admin-write-only) is bypassed via privilege rather than relying on
 * the RLS check being satisfied, which keeps this insert path simple.
 */
export async function addManualDeliverable(
  bookingId: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const type = (formData.get("type") as string | null) ?? "";
  const url = ((formData.get("url") as string | null) ?? "").trim();
  const thumbnail =
    ((formData.get("thumbnail_url") as string | null) ?? "").trim() || null;

  if (!VALID_DELIVERABLE_TYPES.includes(type as DeliverableType)) {
    return { ok: false, error: "Pick a deliverable type." };
  }
  if (!url) {
    return { ok: false, error: "URL is required." };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return { ok: false, error: "URL must start with https://." };
    }
  } catch {
    return { ok: false, error: "URL doesn't look valid." };
  }

  const supabase = await getServerSupabase();
  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .select("id, property_id")
    .eq("id", bookingId)
    .single<BookingMinimalRow>();

  if (bookErr || !booking) return { ok: false, error: "Booking not found." };

  const service = getServiceSupabase();
  const { error } = await service.from("deliverables").insert({
    booking_id: booking.id,
    property_id: booking.property_id,
    type: type as DeliverableType,
    source: "manual",
    url,
    thumbnail_url: thumbnail,
    ready_at: new Date().toISOString(),
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true };
}

export async function deleteDeliverable(
  bookingId: string,
  deliverableId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const service = getServiceSupabase();
  const { error } = await service
    .from("deliverables")
    .delete()
    .eq("id", deliverableId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true };
}

/**
 * Save (or clear) an iGuide reference on a booking. Auto-detects whether
 * the pasted value is a Portal ID (`igXXXXX…` or a manage.youriguide.com
 * URL) or a public alias/URL, and routes to the right column:
 *
 *   - Portal ID → iguide_portal_id (immutable; enables Portal API sync)
 *   - Alias/URL → iguide_id (mutable slug; enables RESO fallback)
 *
 * Clearing the field wipes both columns so they can't drift.
 */
export async function saveIGuideId(
  bookingId: string,
  rawInput: string,
): Promise<
  ActionResult & {
    iguideId?: string | null;
    portalId?: string | null;
  }
> {
  await requireAdmin();

  const trimmed = rawInput.trim();

  if (trimmed === "") {
    const service = getServiceSupabase();
    const { error } = await service
      .from("bookings")
      .update({ iguide_id: null, iguide_portal_id: null })
      .eq("id", bookingId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/admin/bookings/${bookingId}`);
    return { ok: true, iguideId: null, portalId: null };
  }

  // Try portal id first — it's the higher-signal match ("igXXXXX" is
  // unambiguous, whereas a bare alphanumeric string could be either).
  const portalId = parseIGuidePortalId(trimmed);
  const alias = portalId ? null : parseIGuideAlias(trimmed);

  if (!portalId && !alias) {
    return {
      ok: false,
      error:
        "Couldn't parse that. Paste the tour's alias (e.g. 1044_rest_acres_rd_brant_on), a youriguide.com URL, or the Portal ID from manage.youriguide.com (e.g. igYGFV5GG6V8DD1).",
    };
  }

  const service = getServiceSupabase();
  const update: BookingUpdatePayload = {};
  if (portalId) {
    update.iguide_portal_id = portalId;
  }
  if (alias) {
    update.iguide_id = alias;
  }

  const { error } = await service
    .from("bookings")
    .update(update)
    .eq("id", bookingId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true, iguideId: alias, portalId };
}

type BookingUpdatePayload = {
  iguide_id?: string | null;
  iguide_portal_id?: string | null;
};

/**
 * Sync deliverables for the iGuide tour tagged on this booking. Uses
 * the authenticated Portal API when possible (requires the booking to
 * carry an `iguide_portal_id`, which the webhook sets automatically);
 * falls back to the public RESO autofill endpoint keyed by alias when
 * the portal id isn't known yet.
 */
export async function syncIGuide(
  bookingId: string,
): Promise<ActionResult & { upserts?: number; address?: string; portalId?: string }> {
  await requireAdmin();

  const supabase = await getServerSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, property_id, iguide_id, iguide_portal_id")
    .eq("id", bookingId)
    .single<BookingWithIGuideRow>();

  if (error || !booking) return { ok: false, error: "Booking not found." };
  if (!booking.iguide_id && !booking.iguide_portal_id) {
    return {
      ok: false,
      error: "No iGuide alias or portal ID on this booking — paste a URL above first.",
    };
  }

  const result = await syncIGuideForBooking(booking);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/bookings/${bookingId}`);
  return {
    ok: true,
    upserts: result.upserts,
    address: result.address,
    portalId: result.portalId,
  };
}

export async function createIGuideForBooking(
  bookingId: string,
): Promise<
  ActionResult & {
    iguideId?: string;
    portalId?: string;
    workOrderId?: string | null;
  }
> {
  await requireAdmin();

  const supabase = await getServerSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, property_id, unit_number, iguide_id, iguide_portal_id, properties(street_address, city, province, postal_code)",
    )
    .eq("id", bookingId)
    .single<BookingForIGuideCreateRow>();

  if (error || !booking) return { ok: false, error: "Booking not found." };
  if (!booking.properties) {
    return { ok: false, error: "Booking has no property address." };
  }
  if (booking.iguide_portal_id) {
    return {
      ok: false,
      error: "This booking already has an iGuide Portal ID.",
    };
  }

  const address = buildIGuideAddress(booking.properties.street_address);
  if (!address.streetNumber || !address.streetName) {
    return {
      ok: false,
      error: "Couldn't split the street address into a number and street name.",
    };
  }

  const result = await createIGuideInPortal({
    type: "standard",
    industry: "residential",
    address: {
      country: "CA",
      provinceState: booking.properties.province ?? "ON",
      city: booking.properties.city ?? "",
      postalCode: booking.properties.postal_code ?? "",
      streetNumber: address.streetNumber,
      streetName: address.streetName,
      ...(booking.unit_number ? { unit: booking.unit_number } : {}),
    },
  });

  if (!result.ok || !result.data) {
    return {
      ok: false,
      error: result.error ?? "iGuide did not create the tour.",
    };
  }
  if (!result.data.id) {
    return { ok: false, error: "iGuide response did not include an id." };
  }

  const service = getServiceSupabase();
  const { error: updateErr } = await service
    .from("bookings")
    .update({
      iguide_portal_id: result.data.id,
      iguide_id: result.data.alias ?? booking.iguide_id,
    })
    .eq("id", bookingId);

  if (updateErr) return { ok: false, error: updateErr.message };

  const recorded = await recordIGuideCreateJob({
    bookingId: booking.id,
    propertyId: booking.property_id,
    iguideId: result.data.id,
    alias: result.data.alias ?? null,
    workOrderId: result.data.workOrderId ?? null,
    defaultViewId: result.data.defaultViewId ?? null,
    rawCreateResponse: result.data,
  });
  if (!recorded.ok) return { ok: false, error: recorded.error };

  revalidatePath(`/admin/bookings/${bookingId}`);
  return {
    ok: true,
    iguideId: result.data.alias,
    portalId: result.data.id,
    workOrderId: result.data.workOrderId ?? null,
  };
}

function buildIGuideAddress(streetAddress: string): {
  streetNumber: string;
  streetName: string;
} {
  const trimmed = streetAddress.trim().replace(/\s+/g, " ");
  const match = trimmed.match(/^([0-9]+[A-Za-z-]?)\s+(.+)$/);
  if (!match) return { streetNumber: "", streetName: trimmed };
  return { streetNumber: match[1], streetName: match[2] };
}

// ---------------------------------------------------------------------------
// QuickBooks invoicing (Phase 7)
// ---------------------------------------------------------------------------

export async function createInvoice(
  bookingId: string,
): Promise<
  ActionResult & {
    invoiceUrl?: string;
    invoiceNumber?: string;
    totalCents?: number;
  }
> {
  await requireAdmin();

  const supabase = await getServerSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, services, add_ons, property_id, owner_id, properties(street_address, city, postal_code), profiles(email, full_name, phone, brokerage)",
    )
    .eq("id", bookingId)
    .single<BookingForInvoiceRow>();

  if (error || !booking) return { ok: false, error: "Booking not found." };
  if (!booking.profiles) {
    return { ok: false, error: "Booking has no realtor — can't invoice." };
  }
  if (!booking.properties) {
    return { ok: false, error: "Booking has no property — can't invoice." };
  }

  const result = await createInvoiceForBooking({
    bookingId: booking.id,
    services: booking.services,
    addOns: booking.add_ons,
    realtor: booking.profiles,
    property: booking.properties,
  });

  revalidatePath(`/admin/bookings/${bookingId}`);
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    invoiceUrl: result.invoiceUrl,
    invoiceNumber: result.invoiceNumber,
    totalCents: result.totalCents,
  };
}

export async function refreshInvoice(
  bookingId: string,
): Promise<ActionResult & { status?: string }> {
  await requireAdmin();
  const result = await refreshInvoiceInQBO(bookingId);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true, status: result.status };
}

// ---------------------------------------------------------------------------
// Fotello (Phase 5)
// ---------------------------------------------------------------------------

export async function saveFotelloListingId(
  bookingId: string,
  rawInput: string,
): Promise<ActionResult & { listingId?: string | null }> {
  await requireAdmin();
  const trimmed = rawInput.trim();
  const listingId = trimmed === "" ? null : trimmed;
  // Fotello listing ids are Firebase-style strings; we don't enforce a
  // format beyond "not whitespace" — the API will reject bad ids when
  // we use them, and surfacing that error is fine.

  const service = getServiceSupabase();
  const { error } = await service
    .from("bookings")
    .update({ fotello_listing_id: listingId })
    .eq("id", bookingId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true, listingId };
}

export async function prepareFotelloUpload(
  bookingId: string,
  filenames: string[],
): Promise<
  ActionResult & {
    listingId?: string;
    uploads?: Array<{ id: string; url: string; expires: string }>;
  }
> {
  await requireAdmin();

  const cleanFilenames = filenames
    .map((filename) => filename.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (cleanFilenames.length === 0) {
    return { ok: false, error: "Pick at least one photo." };
  }

  const service = getServiceSupabase();
  const { data: booking, error } = await service
    .from("bookings")
    .select("id, property_id, fotello_listing_id, properties(street_address, city)")
    .eq("id", bookingId)
    .single<BookingFotelloRow>();

  if (error || !booking) return { ok: false, error: "Booking not found." };

  try {
    let listingId = booking.fotello_listing_id;
    if (!listingId) {
      const listing = await createListing(fotelloListingName(booking));
      listingId = listing.id;
      const { error: updateError } = await service
        .from("bookings")
        .update({ fotello_listing_id: listingId })
        .eq("id", booking.id);
      if (updateError) return { ok: false, error: updateError.message };
    }

    const uploads = await Promise.all(
      cleanFilenames.map((filename) => createUpload(filename)),
    );
    revalidatePath(`/admin/bookings/${bookingId}`);
    return {
      ok: true,
      listingId,
      uploads: uploads.map((upload) => ({
        id: upload.id,
        url: upload.url,
        expires: upload.expires,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Fotello could not prepare uploads.",
    };
  }
}

export async function startFotelloEnhance(
  bookingId: string,
  uploadIds: string[],
  listingId: string,
): Promise<ActionResult & { enhanceId?: string; status?: string }> {
  await requireAdmin();

  const cleanUploadIds = uploadIds.map((id) => id.trim()).filter(Boolean);
  const cleanListingId = listingId.trim();
  if (cleanUploadIds.length === 0) {
    return { ok: false, error: "No Fotello upload IDs were provided." };
  }
  if (!cleanListingId) {
    return { ok: false, error: "Missing Fotello listing ID." };
  }

  const service = getServiceSupabase();
  const { data: booking, error } = await service
    .from("bookings")
    .select("id, property_id, fotello_listing_id")
    .eq("id", bookingId)
    .single<{
      id: string;
      property_id: string;
      fotello_listing_id: string | null;
    }>();

  if (error || !booking) return { ok: false, error: "Booking not found." };
  if (booking.fotello_listing_id !== cleanListingId) {
    const { error: updateError } = await service
      .from("bookings")
      .update({ fotello_listing_id: cleanListingId })
      .eq("id", booking.id);
    if (updateError) return { ok: false, error: updateError.message };
  }

  try {
    const enhance = await createEnhance({
      uploadIds: cleanUploadIds,
      listingId: cleanListingId,
    });
    const result = await syncEnhance({
      enhanceId: enhance.id,
      booking: {
        id: booking.id,
        property_id: booking.property_id,
        fotello_listing_id: cleanListingId,
      },
    });

    revalidatePath(`/admin/bookings/${bookingId}`);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, enhanceId: enhance.id, status: result.status };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Fotello could not start enhance.",
    };
  }
}

/**
 * Track (or refresh) a Fotello enhance against the booking. If the
 * enhance is already `completed`, the sync run will upsert a
 * photo_gallery deliverable immediately. If it's in progress, we still
 * write a placeholder row so the admin can see it pending; the next
 * refresh will flip it to ready.
 */
export async function trackFotelloEnhance(
  bookingId: string,
  enhanceId: string,
  shotType: FotelloShotType,
): Promise<ActionResult & { status?: string }> {
  await requireAdmin();
  const trimmed = enhanceId.trim();
  if (!trimmed) return { ok: false, error: "Enhance ID is required." };

  const supabase = await getServerSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, property_id, fotello_listing_id")
    .eq("id", bookingId)
    .single<{
      id: string;
      property_id: string;
      fotello_listing_id: string | null;
    }>();

  if (error || !booking) return { ok: false, error: "Booking not found." };

  const result = await syncEnhance({
    enhanceId: trimmed,
    booking,
    shotType,
  });

  revalidatePath(`/admin/bookings/${bookingId}`);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, status: result.status };
}

function fotelloListingName(booking: BookingFotelloRow): string {
  const address = [
    booking.properties?.street_address,
    booking.properties?.city,
  ]
    .filter(Boolean)
    .join(", ");
  return address || `Booking ${booking.id}`;
}

/** Untrack (delete) a Fotello-sourced deliverable row. */
export async function untrackFotelloEnhance(
  bookingId: string,
  deliverableId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const service = getServiceSupabase();
  const { error } = await service
    .from("deliverables")
    .delete()
    .eq("id", deliverableId)
    .eq("source", "fotello");
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true };
}
