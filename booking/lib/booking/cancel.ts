import "server-only";

import { BUSINESS_TZ } from "@/lib/booking/availability";
import { isCancellable } from "@/lib/booking/booking-status";
import { syncStoredBookingGoogleCalendarEvent } from "@/lib/booking/calendar-event-service";
import {
  changeBookingWithNotices, deliverChangedBookingNotices, lifecycleNotice,
  type LifecycleNoticeDraft,
} from "@/lib/booking/lifecycle-notices";
import {
  getOrganizationEmailSettings,
} from "@/lib/email/settings";

import { sendPushBestEffort } from "@/lib/notifications/push";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

export interface CancelResult {
  ok: boolean;
  error?: string;
  warning?: string;
  /** The booking row after the status flip, for callers that want to render a flash. */
  addressLine?: string;
  whenLabel?: string;
  realtorNotified?: boolean;
}

interface BookingRow {
  lifecycle_version: number;
  unit_number: string | null;
  id: string;
  organization_id: string;
  owner_id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  services: string[];
  add_ons: string[];
  property_id: string;
  google_calendar_event_id: string | null;
  suppress_realtor_notifications: boolean;
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
 *   - Strictly deletes the Google Calendar event before clearing its linkage
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
  scope: { organizationId: string; confirmRealtor?: boolean },
): Promise<CancelResult> {
  const supabase = getServiceSupabase();

  let bookingQuery = supabase
    .from("bookings")
    .select(
      "id, organization_id, lifecycle_version, unit_number, owner_id, status, scheduled_at, services, add_ons, property_id, google_calendar_event_id, suppress_realtor_notifications, properties(street_address, city, postal_code), profiles(email, full_name)",
    )
    .eq("id", bookingId);

  bookingQuery = bookingQuery.eq("organization_id", scope.organizationId);

  const { data: booking, error: loadErr } =
    await bookingQuery.maybeSingle<BookingRow>();

  if (loadErr || !booking) {
    return { ok: false, error: "Booking not found." };
  }

  if (!isCancellable(booking.status, initiator)) {
    return {
      ok: false,
      error: `This booking is ${booking.status} — it can't be cancelled from here.`,
    };
  }

  // Freeze the notice contents before the atomic status change.
  const addressLine = booking.properties
    ? [
        booking.unit_number ? `${booking.properties.street_address}, Unit ${booking.unit_number}` : booking.properties.street_address,
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

  const notices = await buildCancellationNotices({
    initiator, bookingId, realtorEmail, realtorName, addressLine, whenLabel,
    organizationId: booking.organization_id,
    suppressRealtorNotifications: booking.suppress_realtor_notifications,
    confirmRealtor: scope.confirmRealtor ?? false,
  });
  const changed = await changeBookingWithNotices({
    organizationId: scope.organizationId, bookingId,
    expectedVersion: booking.lifecycle_version,
    event: "cancelled", initiator, notices,
  });
  if (!changed.ok) {
    return { ok: false, error: changed.code === "PB004"
      ? "Booking changed before it could be cancelled. Refresh and try again."
      : "Could not cancel booking. Please try again." };
  }

  // 2) Strictly delete and then clear linkage through the canonical service.
  let calendarSynced = true;
  try {
    const result = await syncStoredBookingGoogleCalendarEvent({
      organizationId: booking.organization_id,
      bookingId: booking.id,
    });
    calendarSynced = result.ok;
  } catch {
    calendarSynced = false;
    console.warn("[cancel] google calendar cleanup failed");
  }

  const delivery = await deliverChangedBookingNotices({
    organizationId: booking.organization_id, bookingId, noticeIds: changed.noticeIds,
  });
  await sendPushBestEffort(booking.organization_id, {
    title:
      initiator === "realtor"
        ? "Booking cancelled by realtor"
        : "Booking cancelled",
    body: `${addressLine} · ${whenLabel}`,
    url: `/admin/bookings/${booking.id}`,
    tag: `booking-cancelled-${booking.id}`,
  });

  return {
    ok: true,
    addressLine,
    whenLabel,
    realtorNotified: delivery.realtorNotified,
    warning: [
      !calendarSynced ? "Booking cancelled, but Google Calendar cleanup did not finish. Check the linked event before the cancelled time." : undefined,
      delivery.warning,
    ].filter(Boolean).join(" ") || undefined,
  };
}

async function buildCancellationNotices(args: {
  initiator: "admin" | "realtor";
  bookingId: string;
  realtorEmail?: string | null;
  realtorName: string;
  addressLine: string;
  whenLabel: string;
  organizationId: string;
  suppressRealtorNotifications: boolean;
  confirmRealtor: boolean;
}): Promise<LifecycleNoticeDraft[]> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const settings = await getOrganizationEmailSettings(args.organizationId);
  const notices: LifecycleNoticeDraft[] = [];
  if ((args.initiator === "admin" || args.confirmRealtor) && !args.suppressRealtorNotifications) {
    notices.push(lifecycleNotice("realtor", settings, {
      to: args.realtorEmail,
      subject: `Booking cancelled — ${args.addressLine}`,
      html: `<p>Hi ${escapeHtml(args.realtorName)},</p>
        <p>Your shoot at <strong>${escapeHtml(args.addressLine)}</strong>
        on <strong>${escapeHtml(args.whenLabel)}</strong> has been cancelled.</p>
        <p>If this was unexpected, contact the studio. To book a different time,
        visit <a href="${escapeHtml(appUrl)}/book">our booking page</a>.</p>
        <p>— ${escapeHtml(settings.organizationName)}</p>`,
    }));
  }
  if (args.initiator === "realtor") {
    notices.push(lifecycleNotice("admin", settings, {
      to: settings.adminNotificationEmail,
      subject: `Booking cancelled by realtor — ${args.addressLine}`,
      html: `<p><strong>${escapeHtml(args.realtorName)}</strong> cancelled their shoot.</p>
        <p><strong>Address:</strong> ${escapeHtml(args.addressLine)}<br>
        <strong>When:</strong> ${escapeHtml(args.whenLabel)}</p>
        <p>Check the booking for Calendar sync status:
        ${escapeHtml(appUrl)}/admin/bookings/${escapeHtml(args.bookingId)}</p>`,
      replyTo: args.realtorEmail ?? settings.replyToEmail,
    }));
  }
  return notices;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
