import "server-only";

import { BUSINESS_TZ } from "@/lib/booking/availability";
import { isCancellable } from "@/lib/booking/booking-status";
import { sendEmail } from "@/lib/email/resend";
import {
  getAdminNotificationEmail,
  getOrganizationEmailSettings,
} from "@/lib/email/settings";
import { getGoogleCalendarClient } from "@/lib/integrations/google-calendar/client";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

export interface CancelResult {
  ok: boolean;
  error?: string;
  /** The booking row after the status flip, for callers that want to render a flash. */
  addressLine?: string;
  whenLabel?: string;
}

interface BookingRow {
  id: string;
  organization_id: string;
  owner_id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  services: string[];
  add_ons: string[];
  property_id: string;
  google_calendar_event_id: string | null;
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

/**
 * Cancel a booking and handle all the side effects in one place.
 *
 * Shared by the admin "Cancel booking" button and the realtor self-serve
 * cancel on /portal — same behavior either way:
 *
 *   - Re-checks the booking exists + is in a cancellable state
 *   - Flips `status` → `cancelled`
 *   - Deletes the Google Calendar event if we have its id (best-effort)
 *   - Sends a cancellation email to whichever side DIDN'T press the button
 *
 * The `initiator` arg decides the notification direction:
 *   - `"admin"` → email goes to the realtor
 *   - `"realtor"` → email goes to the admin notification address
 *
 * This helper uses the service-role client so callers must pass the
 * authorized organization scope. Route actions should also do any
 * caller-specific authorization first, such as realtor ownership.
 */
export async function cancelBooking(
  bookingId: string,
  initiator: "admin" | "realtor",
  scope: { organizationId: string },
): Promise<CancelResult> {
  const supabase = getServiceSupabase();

  let bookingQuery = supabase
    .from("bookings")
    .select(
      "id, organization_id, owner_id, status, scheduled_at, services, add_ons, property_id, google_calendar_event_id, properties(street_address, city, postal_code), profiles(email, full_name)",
    )
    .eq("id", bookingId);

  bookingQuery = bookingQuery.eq("organization_id", scope.organizationId);

  const { data: booking, error: loadErr } =
    await bookingQuery.maybeSingle<BookingRow>();

  if (loadErr || !booking) {
    return { ok: false, error: "Booking not found." };
  }

  if (!isCancellable(booking.status)) {
    return {
      ok: false,
      error: `This booking is ${booking.status} — it can't be cancelled from here.`,
    };
  }

  // 1) Flip the status.
  let updateQuery = supabase
    .from("bookings")
    .update({
      status: "cancelled",
      google_calendar_event_id: null,
      google_calendar_event_url: null,
    })
    .eq("id", bookingId);

  updateQuery = updateQuery.eq("organization_id", scope.organizationId);

  const { error: updateErr } = await updateQuery;

  if (updateErr) {
    return { ok: false, error: updateErr.message };
  }

  // 2) Delete the Google Calendar event (best-effort).
  if (booking.google_calendar_event_id) {
    try {
      const client = await getGoogleCalendarClient({
        organizationId: booking.organization_id,
      });
      if (client) {
        await client.deleteEvent(booking.google_calendar_event_id);
      }
    } catch (err) {
      // Not fatal — the booking is already marked cancelled in our DB.
      // Admin can delete the stray event by hand if needed.
      console.warn("[cancel] google event delete failed", err);
    }
  }

  // 3) Notify.
  const addressLine = booking.properties
    ? [
        booking.properties.street_address,
        booking.properties.city,
        booking.properties.postal_code,
      ]
        .filter(Boolean)
        .join(", ")
    : "(unknown address)";
  const whenLabel = booking.scheduled_at
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: BUSINESS_TZ,
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date(booking.scheduled_at))
    : "(no time set)";
  const realtorName =
    booking.profiles?.full_name ?? booking.profiles?.email ?? "realtor";
  const realtorEmail = booking.profiles?.email;

  await sendCancellationEmail({
    initiator,
    bookingId,
    realtorEmail,
    realtorName,
    addressLine,
    whenLabel,
    organizationId: booking.organization_id,
  });

  return {
    ok: true,
    addressLine,
    whenLabel,
  };
}

async function sendCancellationEmail(args: {
  initiator: "admin" | "realtor";
  bookingId: string;
  realtorEmail?: string | null;
  realtorName: string;
  addressLine: string;
  whenLabel: string;
  organizationId: string;
}): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const emailSettings = await getOrganizationEmailSettings(args.organizationId);

  if (args.initiator === "admin") {
    if (!args.realtorEmail) return;
    await sendEmail({
      to: args.realtorEmail,
      subject: `Booking cancelled — ${args.addressLine}`,
      organizationId: args.organizationId,
      html: `
        <p>Hi ${escapeHtml(args.realtorName)},</p>
        <p>
          Your shoot at <strong>${escapeHtml(args.addressLine)}</strong>
          on <strong>${escapeHtml(args.whenLabel)}</strong> has been cancelled.
        </p>
        <p>
          If this was unexpected, reply to this email or reach out at
          ${
            emailSettings.replyToEmail
              ? `<a href="mailto:${escapeHtml(emailSettings.replyToEmail)}">${escapeHtml(emailSettings.replyToEmail)}</a>`
              : "the studio"
          }.
          To book a different time, head to
          <a href="${appUrl}/book">${appUrl || "our booking page"}</a>.
        </p>
        <p>— ${escapeHtml(emailSettings.organizationName)}</p>
      `,
    });
    return;
  }

  // Realtor-initiated → notify admin.
  const adminTo = await getAdminNotificationEmail(args.organizationId);
  if (!adminTo) return;
  await sendEmail({
    to: adminTo,
    subject: `Booking cancelled by realtor — ${args.addressLine}`,
    organizationId: args.organizationId,
    html: `
      <p>
        <strong>${escapeHtml(args.realtorName)}</strong>${
          args.realtorEmail
            ? ` (${escapeHtml(args.realtorEmail)})`
            : ""
        }
        just cancelled their shoot.
      </p>
      <p>
        <strong>Address:</strong> ${escapeHtml(args.addressLine)}<br>
        <strong>When:</strong> ${escapeHtml(args.whenLabel)}
      </p>
      <p>Open in admin: ${appUrl}/admin/bookings/${args.bookingId}</p>
    `,
    replyTo: args.realtorEmail ?? undefined,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
