"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/require-user";
import { cancelBooking } from "@/lib/booking/cancel";
import { getServerSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

export interface CancelOwnResult {
  ok: boolean;
  error?: string;
}

/**
 * Realtor self-serve cancel from /portal/[propertyId].
 *
 * Authorization: the caller must own the booking (checked against
 * `bookings.owner_id`). RLS already restricts what a realtor can see,
 * but we belt-and-braces the ownership check here before touching the
 * service-role path in `cancelBooking`.
 */
export async function cancelOwnBooking(
  bookingId: string,
): Promise<CancelOwnResult> {
  const user = await requireUser();

  const supabase = getServerSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, owner_id, property_id")
    .eq("id", bookingId)
    .maybeSingle<{
      id: string;
      owner_id: string;
      property_id: string;
      status: BookingStatus;
    }>();

  if (error || !booking) {
    return { ok: false, error: "Booking not found." };
  }
  if (booking.owner_id !== user.userId) {
    return {
      ok: false,
      error: "You can't cancel a booking that isn't yours.",
    };
  }

  const result = await cancelBooking(bookingId, "realtor");
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/portal/${booking.property_id}`);
  revalidatePath("/portal");
  return { ok: true };
}
