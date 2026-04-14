"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type BookingRequestRow =
  Database["public"]["Tables"]["booking_requests"]["Row"];

interface InsertedRow {
  id: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Mark a request as `reviewing`. Lightweight — no side effects beyond the
 * status flip, used so the inbox shows "someone's looking at this."
 */
export async function markReviewing(requestId: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("booking_requests")
    .update({ status: "reviewing" })
    .eq("id", requestId)
    .in("status", ["new"]);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/inbox");
  revalidatePath(`/admin/inbox/${requestId}`);
  return { ok: true };
}

/**
 * Reject a request. Doesn't notify the realtor automatically — assumption
 * is the admin will reply by email manually if needed.
 */
export async function declineRequest(requestId: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("booking_requests")
    .update({ status: "declined" })
    .eq("id", requestId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/inbox");
  revalidatePath(`/admin/inbox/${requestId}`);
  return { ok: true };
}

/**
 * Promote a `booking_request` into a real booking.
 *
 * Steps (in order, each gated by the previous):
 *   1. Load the request, refuse if already accepted.
 *   2. Find or create the realtor's auth.users row (service-role).
 *      The DB trigger inserts a matching `profiles` row automatically;
 *      we then fill in name/phone/brokerage from the request.
 *   3. Insert a new `properties` row owned by the realtor.
 *   4. Insert a new `bookings` row, status=confirmed, scheduled_at as given.
 *   5. Update the original request: status=accepted, booking_id linked.
 *
 * NOTE: This is a multi-step write that's not strictly atomic — if step 4
 * fails after step 3 succeeds, you'll have an orphaned property. Acceptable
 * for now (low-volume, manual operation). A future improvement is to wrap
 * 3-5 in a Postgres function called via RPC.
 */
export async function acceptRequest(
  requestId: string,
  scheduledAt: string | null,
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = getServiceSupabase();

  // 1. Load the request.
  const { data: req, error: loadErr } = await supabase
    .from("booking_requests")
    .select("*")
    .eq("id", requestId)
    .single<BookingRequestRow>();

  if (loadErr || !req) {
    return { ok: false, error: "Request not found." };
  }
  if (req.status === "accepted") {
    return { ok: false, error: "Already accepted." };
  }

  // 2. Find or create the auth user.
  let userId: string | null = null;
  try {
    const { data: list } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const found = list?.users.find(
      (u) => u.email?.toLowerCase() === req.contact_email.toLowerCase(),
    );
    if (found) {
      userId = found.id;
    } else {
      const { data: created, error: createErr } =
        await supabase.auth.admin.createUser({
          email: req.contact_email,
          email_confirm: true,
          user_metadata: { full_name: req.contact_name },
        });
      if (createErr || !created.user) {
        console.error("[accept] createUser failed", createErr);
        return { ok: false, error: "Could not create realtor account." };
      }
      userId = created.user.id;
    }
  } catch (err) {
    console.error("[accept] auth lookup threw", err);
    return { ok: false, error: "Auth admin call failed." };
  }

  // Backfill profile fields from the request. The trigger created an
  // empty-ish profile row, so this is an UPDATE not an INSERT.
  await supabase
    .from("profiles")
    .update({
      full_name: req.contact_name,
      phone: req.contact_phone,
      brokerage: req.brokerage,
    })
    .eq("id", userId);

  // 3. Property.
  const { data: property, error: propErr } = await supabase
    .from("properties")
    .insert({
      owner_id: userId,
      street_address: req.street_address,
      city: req.city,
      postal_code: req.postal_code,
    })
    .select("id")
    .single<InsertedRow>();

  if (propErr || !property) {
    console.error("[accept] property insert failed", propErr);
    return { ok: false, error: "Could not create property record." };
  }

  // 4. Booking.
  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .insert({
      property_id: property.id,
      owner_id: userId,
      status: "confirmed",
      scheduled_at: scheduledAt,
      services: req.services,
      add_ons: req.add_ons,
      square_footage: req.square_footage,
      client_notes: req.notes,
    })
    .select("id")
    .single<InsertedRow>();

  if (bookErr || !booking) {
    console.error("[accept] booking insert failed", bookErr);
    return { ok: false, error: "Could not create booking record." };
  }

  // 5. Link the original request.
  const { error: updErr } = await supabase
    .from("booking_requests")
    .update({ status: "accepted", booking_id: booking.id })
    .eq("id", requestId);

  if (updErr) {
    console.warn("[accept] booking_request update failed", updErr);
    // Booking still exists — just log; don't roll the whole thing back.
  }

  revalidatePath("/admin/inbox");
  revalidatePath("/admin/bookings");
  redirect(`/admin/bookings/${booking.id}`);
}
