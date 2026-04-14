"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { nextBookingStatuses } from "@/lib/booking/booking-status";
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
  const supabase = getServerSupabase();

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
    new URL(url);
  } catch {
    return { ok: false, error: "URL doesn't look valid." };
  }

  const supabase = getServerSupabase();
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
