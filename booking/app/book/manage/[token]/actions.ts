"use server";

import { revalidatePath } from "next/cache";

import { BUSINESS_TZ } from "@/lib/booking/availability";
import { isCancellable } from "@/lib/booking/booking-status";
import { cancelBooking } from "@/lib/booking/cancel";
import { verifyManageToken } from "@/lib/booking/manage-token";
import { sendEmail } from "@/lib/email/resend";
import {
  getAdminNotificationEmail,
  getOrganizationEmailSettings,
} from "@/lib/email/settings";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

/**
 * Self-serve reschedule/cancel actions for the public manage-booking
 * page. There is NO session here — authorization comes entirely from
 * the signed token in the URL, so every action re-verifies the token
 * and derives the booking id from it. Client-passed booking ids are
 * never trusted.
 */

export interface ManageActionResult {
  ok: boolean;
  error?: string;
  /** New time label (BUSINESS_TZ) after a successful reschedule. */
  whenLabel?: string;
}

interface ManagedBookingRow {
  id: string;
  organization_id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  unit_number: string | null;
  properties: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
  } | null;
  profiles: {
    email: string;
    full_name: string | null;
  } | null;
}

const DEFAULT_DURATION_MINUTES = 60;

async function loadManagedBooking(
  token: string,
): Promise<{ booking: ManagedBookingRow } | { error: string }> {
  const bookingId = verifyManageToken(token);
  if (!bookingId) return { error: "This link is invalid or has expired." };

  const service = getServiceSupabase();
  const { data: booking, error } = await service
    .from("bookings")
    .select(
      "id, organization_id, status, scheduled_at, scheduled_ends_at, unit_number, properties(street_address, city, postal_code), profiles(email, full_name)",
    )
    .eq("id", bookingId)
    .maybeSingle<ManagedBookingRow>();

  if (error || !booking) return { error: "Booking not found." };
  return { booking };
}

function manageGuardError(booking: ManagedBookingRow): string | null {
  if (booking.status === "cancelled") {
    return "This booking has already been cancelled.";
  }
  if (!isCancellable(booking.status)) {
    return `This booking is ${booking.status} — contact the photographer to make changes.`;
  }
  if (!booking.scheduled_at) {
    return "This booking has no scheduled time — contact the photographer.";
  }
  if (new Date(booking.scheduled_at).getTime() <= Date.now()) {
    return "This shoot time has already passed — contact the photographer.";
  }
  return null;
}

function bookingAddressLine(booking: ManagedBookingRow): string {
  if (!booking.properties) return "(unknown address)";
  const streetLine = booking.unit_number
    ? `${booking.properties.street_address}, Unit ${booking.unit_number}`
    : booking.properties.street_address;
  return [streetLine, booking.properties.city, booking.properties.postal_code]
    .filter(Boolean)
    .join(", ");
}

function formatWhen(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    dateStyle: "full",
    timeStyle: "short",
  }).format(d);
}

export async function rescheduleManagedBooking(
  token: string,
  startISO: string,
): Promise<ManageActionResult> {
  const loaded = await loadManagedBooking(token);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { booking } = loaded;

  const guardError = manageGuardError(booking);
  if (guardError) return { ok: false, error: guardError };

  const newStart = new Date(startISO);
  if (Number.isNaN(newStart.getTime())) {
    return { ok: false, error: "That time doesn't look valid — pick again." };
  }
  if (newStart.getTime() <= Date.now()) {
    return { ok: false, error: "Pick a time in the future." };
  }

  // Keep the same shoot length: end - start of the existing booking,
  // falling back to a safe floor if the end was never set.
  const currentStart = new Date(booking.scheduled_at!);
  const durationMinutes = booking.scheduled_ends_at
    ? Math.max(
        Math.round(
          (new Date(booking.scheduled_ends_at).getTime() -
            currentStart.getTime()) /
            60_000,
        ),
        DEFAULT_DURATION_MINUTES,
      )
    : DEFAULT_DURATION_MINUTES;
  const newEnd = new Date(newStart.getTime() + durationMinutes * 60_000);

  const service = getServiceSupabase();

  // Conflict check against other active bookings in the same company
  // (same overlap pattern as the admin edit action).
  const { data: conflicts, error: conflictError } = await service
    .from("bookings")
    .select("id")
    .eq("organization_id", booking.organization_id)
    .neq("id", booking.id)
    .in("status", ["requested", "confirmed", "shot", "editing", "delivered"])
    .not("scheduled_at", "is", null)
    .lt("scheduled_at", newEnd.toISOString())
    .gt("scheduled_ends_at", newStart.toISOString())
    .limit(1);

  if (conflictError) return { ok: false, error: conflictError.message };
  if (conflicts && conflicts.length > 0) {
    return {
      ok: false,
      error: "That time was just taken. Please pick another slot.",
    };
  }

  const { error: updateError } = await service
    .from("bookings")
    .update({
      scheduled_at: newStart.toISOString(),
      scheduled_ends_at: newEnd.toISOString(),
    })
    .eq("id", booking.id)
    .eq("organization_id", booking.organization_id);

  if (updateError) {
    if (updateError.code === "23P01") {
      return {
        ok: false,
        error: "That time was just taken. Please pick another slot.",
      };
    }
    return { ok: false, error: updateError.message };
  }

  // NOTE: we intentionally do NOT update the Google Calendar event here —
  // the admin is notified by email below and can adjust their calendar.

  const oldWhenLabel = formatWhen(currentStart);
  const newWhenLabel = formatWhen(newStart);
  const addressLine = bookingAddressLine(booking);
  const realtorName =
    booking.profiles?.full_name ?? booking.profiles?.email ?? "realtor";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // Emails are best-effort — the reschedule already succeeded.
  const emailSettings = await getOrganizationEmailSettings(
    booking.organization_id,
  );
  const adminTo = await getAdminNotificationEmail(booking.organization_id);
  await Promise.all([
    booking.profiles?.email
      ? sendEmail({
          to: booking.profiles.email,
          subject: `Booking rescheduled — ${addressLine}`,
          organizationId: booking.organization_id,
          html: `
            <p>Hi ${escapeHtml(realtorName)},</p>
            <p>
              Your shoot at <strong>${escapeHtml(addressLine)}</strong> has
              been moved.
            </p>
            <p>
              <strong>New time:</strong> ${escapeHtml(newWhenLabel)}<br>
              <strong>Previous time:</strong> ${escapeHtml(oldWhenLabel)}
            </p>
            <p>— ${escapeHtml(emailSettings.organizationName)}</p>
          `,
        })
      : Promise.resolve(null),
    adminTo
      ? sendEmail({
          to: adminTo,
          subject: `Booking rescheduled by realtor — ${addressLine}`,
          organizationId: booking.organization_id,
          html: `
            <p>
              <strong>${escapeHtml(realtorName)}</strong>${
                booking.profiles?.email
                  ? ` (${escapeHtml(booking.profiles.email)})`
                  : ""
              }
              just rescheduled their shoot.
            </p>
            <p>
              <strong>Address:</strong> ${escapeHtml(addressLine)}<br>
              <strong>New time:</strong> ${escapeHtml(newWhenLabel)}<br>
              <strong>Previous time:</strong> ${escapeHtml(oldWhenLabel)}
            </p>
            <p>
              The Google Calendar event was not moved automatically — adjust
              it if needed.
            </p>
            <p>Open in admin: ${appUrl}/admin/bookings/${booking.id}</p>
          `,
          replyTo: booking.profiles?.email ?? undefined,
        })
      : Promise.resolve(null),
  ]);

  revalidatePath("/admin/calendar");
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${booking.id}`);
  return { ok: true, whenLabel: newWhenLabel };
}

export async function cancelManagedBooking(
  token: string,
): Promise<ManageActionResult> {
  const loaded = await loadManagedBooking(token);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { booking } = loaded;

  const guardError = manageGuardError(booking);
  if (guardError) return { ok: false, error: guardError };

  // Shared cancel helper — same status flip (`cancelled`) and side effects
  // as the admin cancel button: deletes the Google Calendar event and
  // emails the admin (initiator "realtor" → notification goes to admin).
  const result = await cancelBooking(booking.id, "realtor", {
    organizationId: booking.organization_id,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Also confirm to the realtor (best-effort) — the shared helper only
  // notifies the side that didn't press the button.
  if (booking.profiles?.email) {
    const emailSettings = await getOrganizationEmailSettings(
      booking.organization_id,
    );
    const realtorName =
      booking.profiles.full_name ?? booking.profiles.email;
    await sendEmail({
      to: booking.profiles.email,
      subject: `Booking cancelled — ${result.addressLine ?? bookingAddressLine(booking)}`,
      organizationId: booking.organization_id,
      html: `
        <p>Hi ${escapeHtml(realtorName)},</p>
        <p>
          Your shoot at
          <strong>${escapeHtml(result.addressLine ?? bookingAddressLine(booking))}</strong>
          on <strong>${escapeHtml(result.whenLabel ?? "")}</strong>
          has been cancelled as requested.
        </p>
        <p>
          Changed your mind? Book a new time anytime at
          <a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/book">${
            process.env.NEXT_PUBLIC_APP_URL || "our booking page"
          }</a>.
        </p>
        <p>— ${escapeHtml(emailSettings.organizationName)}</p>
      `,
    });
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${booking.id}`);
  return { ok: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
