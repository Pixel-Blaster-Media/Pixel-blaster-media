"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/require-user";
import {
  BUSINESS_TZ,
  isSlotAvailable,
} from "@/lib/booking/availability";
import {
  isValidAddOnId,
  isValidServiceId,
  totalDurationMinutes,
} from "@/lib/booking/services";
import { sendEmail } from "@/lib/email/resend";
import { getServiceSupabase } from "@/lib/supabase/server";

interface InsertedRow {
  id: string;
}

export interface SelfBookResult {
  ok: boolean;
  error?: string;
}

/**
 * Self-service booking action invoked by the realtor calendar form.
 *
 * Defense in depth: we re-validate the service ids, re-check slot
 * availability, and read the owner_id from the authenticated session
 * rather than anything the client sent. Auto-confirms the booking
 * (status = 'confirmed') per admin's configured default.
 */
export async function createSelfBooking(
  _prev: SelfBookResult | null,
  formData: FormData,
): Promise<SelfBookResult> {
  const user = await requireUser("/portal/book");

  const services = ((formData.getAll("services") as string[]) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const addOns = ((formData.getAll("add_ons") as string[]) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const slotStartRaw = ((formData.get("slot") as string | null) ?? "").trim();
  const streetAddress = ((formData.get("street_address") as string | null) ?? "").trim();
  const city = ((formData.get("city") as string | null) ?? "").trim();
  const postalCode = ((formData.get("postal_code") as string | null) ?? "").trim();
  const notes = ((formData.get("notes") as string | null) ?? "").trim();

  if (services.length === 0 || !services.every(isValidServiceId)) {
    return { ok: false, error: "Pick at least one valid service." };
  }
  if (addOns.length && !addOns.every(isValidAddOnId)) {
    return { ok: false, error: "One of the selected add-ons isn't recognized." };
  }
  if (!streetAddress) {
    return { ok: false, error: "Property address is required." };
  }
  if (!slotStartRaw) {
    return { ok: false, error: "Pick a time slot first." };
  }

  const slotStart = new Date(slotStartRaw);
  if (Number.isNaN(slotStart.getTime())) {
    return { ok: false, error: "That time doesn't look valid — try picking again." };
  }

  const duration = Math.max(totalDurationMinutes(services, addOns), 60);

  // Belt and braces: the browser showed this slot as free a few seconds
  // ago, but another realtor may have grabbed it in the meantime.
  const stillFree = await isSlotAvailable(slotStart, duration);
  if (!stillFree) {
    return {
      ok: false,
      error:
        "That slot was just taken. Please pick another — the calendar has been refreshed.",
    };
  }

  const supabase = getServiceSupabase();

  // Find or create a property for this address under the realtor.
  const { data: existing } = await supabase
    .from("properties")
    .select("id")
    .eq("owner_id", user.userId)
    .eq("street_address", streetAddress)
    .limit(1)
    .maybeSingle<InsertedRow>();

  let propertyId: string | null = existing?.id ?? null;
  if (!propertyId) {
    const { data: created, error: propErr } = await supabase
      .from("properties")
      .insert({
        owner_id: user.userId,
        street_address: streetAddress,
        city: city || null,
        postal_code: postalCode || null,
      })
      .select("id")
      .single<InsertedRow>();
    if (propErr || !created) {
      console.error("[selfBook] property insert failed", propErr);
      return { ok: false, error: "Could not save property. Try again." };
    }
    propertyId = created.id;
  }

  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .insert({
      property_id: propertyId,
      owner_id: user.userId,
      status: "confirmed",
      scheduled_at: slotStart.toISOString(),
      services,
      add_ons: addOns,
      client_notes: notes || null,
    })
    .select("id")
    .single<InsertedRow>();

  if (bookErr || !booking) {
    console.error("[selfBook] booking insert failed", bookErr);
    return { ok: false, error: "Could not save booking. Try again." };
  }

  // Heads-up to admin. Intentionally best-effort.
  const adminTo = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (adminTo) {
    const when = new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TZ,
      dateStyle: "full",
      timeStyle: "short",
    }).format(slotStart);
    await sendEmail({
      to: adminTo,
      subject: `New self-booking — ${streetAddress}`,
      html: `
        <p><strong>${user.fullName ?? user.email}</strong> just booked a shoot.</p>
        <p>
          <strong>Address:</strong> ${escapeHtml(streetAddress)}<br>
          <strong>When:</strong> ${escapeHtml(when)}<br>
          <strong>Services:</strong> ${services.join(", ")}<br>
          ${addOns.length ? `<strong>Add-ons:</strong> ${addOns.join(", ")}<br>` : ""}
          ${notes ? `<strong>Notes:</strong> ${escapeHtml(notes)}<br>` : ""}
        </p>
        <p>Open in admin: ${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin/bookings/${booking.id}</p>
      `,
      replyTo: user.email,
    });
  }

  redirect(`/portal/${propertyId}?booked=1`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
