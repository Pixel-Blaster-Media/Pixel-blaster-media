"use server";

import { revalidatePath } from "next/cache";

import { BUSINESS_TZ, isSlotAvailable } from "@/lib/booking/availability";
import { isCancellable } from "@/lib/booking/booking-status";
import { syncStoredBookingGoogleCalendarEvent } from "@/lib/booking/calendar-event-service";
import { cancelBooking } from "@/lib/booking/cancel";
import { verifyManageToken } from "@/lib/booking/manage-token";
import { sendEmail } from "@/lib/email/resend";
import {
  getAdminNotificationEmail,
  getOrganizationEmailSettings,
} from "@/lib/email/settings";

import { sendPushBestEffort } from "@/lib/notifications/push";
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
  warning?: string;
  /** New time label (BUSINESS_TZ) after a successful reschedule. */
  whenLabel?: string;
  /** Whether this action attempted a realtor-facing confirmation email. */
  realtorNotified?: boolean;
}

interface ManagedBookingRow {
  id: string;
  organization_id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  services: string[];
  add_ons: string[];
  client_notes: string | null;
  google_calendar_event_id: string | null;
  suppress_realtor_notifications: boolean;
  unit_number: string | null;
  properties: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
  } | null;
  profiles: {
    email: string;
    full_name: string | null;
    phone: string | null;
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
      "id, organization_id, status, scheduled_at, scheduled_ends_at, services, add_ons, client_notes, google_calendar_event_id, suppress_realtor_notifications, unit_number, properties(street_address, city, postal_code), profiles(email, full_name, phone)",
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

  // Full availability check — same engine as the public booking flow, so
  // this also enforces business hours, calendar blocks, and Google-busy
  // windows (the slot list shown client-side is only a convenience; the
  // server must not trust the submitted time). The booking being moved is
  // excluded so it can shift within its own current window.
  const stillFree = await isSlotAvailable(newStart, durationMinutes, {
    organizationId: booking.organization_id,
    excludeBookingId: booking.id,
    excludeGoogleEventId: booking.google_calendar_event_id ?? undefined,
  });
  if (!stillFree) {
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
      allow_schedule_overlap: false,
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
    return { ok: false, error: "Could not reschedule booking." };
  }

  const calendarSynced = await syncManagedBookingGoogleEvent(booking);

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
  const [realtorEmailResult] = await Promise.all([
    !booking.suppress_realtor_notifications && booking.profiles?.email
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
            ${
              calendarSynced
                ? ""
                : `<p><strong>Calendar sync needs attention:</strong> the booking moved in the app, but Google Calendar could not be updated automatically.</p>`
            }
            <p>Open in admin: ${appUrl}/admin/bookings/${booking.id}</p>
          `,
          replyTo: booking.profiles?.email ?? undefined,
        })
      : Promise.resolve(null),
    sendPushBestEffort(booking.organization_id, {
      title: "Booking rescheduled by realtor",
      body: `${addressLine} · ${newWhenLabel}`,
      url: `/admin/bookings/${booking.id}`,
      tag: `booking-rescheduled-${booking.id}`,
    }),
  ]);

  revalidatePath("/admin/calendar");
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${booking.id}`);
  return {
    ok: true,
    whenLabel: newWhenLabel,
    warning: calendarSynced
      ? undefined
      : "Your booking moved, but Google Calendar did not sync. Please contact the studio if you need confirmation before the appointment.",
    realtorNotified: Boolean(
      realtorEmailResult?.ok && !realtorEmailResult.skipped,
    ),
  };
}

async function syncManagedBookingGoogleEvent(
  booking: ManagedBookingRow,
): Promise<boolean> {
  try {
    const result = await syncStoredBookingGoogleCalendarEvent({
      organizationId: booking.organization_id,
      bookingId: booking.id,
    });
    return result.ok;
  } catch {
    console.warn("[manage-booking] google calendar reschedule failed");
    return false;
  }
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
  let realtorNotified = false;
  if (!booking.suppress_realtor_notifications && booking.profiles?.email) {
    const emailSettings = await getOrganizationEmailSettings(
      booking.organization_id,
    );
    const realtorName =
      booking.profiles.full_name ?? booking.profiles.email;
    const emailResult = await sendEmail({
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
    realtorNotified = emailResult.ok && !emailResult.skipped;
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${booking.id}`);
  return {
    ok: true,
    warning: result.warning
      ? "Your booking was cancelled, but Google Calendar cleanup needs attention. Please contact the studio if you need confirmation."
      : undefined,
    realtorNotified,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
