"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";
import { totalDurationMinutes } from "@/lib/booking/services";
import { sendEmail } from "@/lib/email/resend";
import { getOrganizationEmailSettings } from "@/lib/email/settings";
import { shootConfirmedEmail } from "@/lib/email/templates";
import { getGoogleCalendarClient } from "@/lib/integrations/google-calendar/client";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type BookingRequestRow =
  Database["public"]["Tables"]["booking_requests"]["Row"];

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Mark a request as `reviewing`. Lightweight — no side effects beyond the
 * status flip, used so the inbox shows "someone's looking at this."
 */
export async function markReviewing(requestId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("booking_requests")
    .update({ status: "reviewing" })
    .eq("id", requestId)
    .eq("organization_id", admin.organizationId)
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
  const admin = await requireAdmin();
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("booking_requests")
    .update({ status: "declined" })
    .eq("id", requestId)
    .eq("organization_id", admin.organizationId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/inbox");
  revalidatePath(`/admin/inbox/${requestId}`);
  return { ok: true };
}

/**
 * Promote a `booking_request` into a real booking.
 *
 * Steps:
 *   1. Load the request, refuse if already accepted.
 *   2. Find or create the realtor's auth.users row (service-role).
 *   3. Call `create_booking_from_request`, which performs the profile
 *      backfill + property insert + booking insert + request linking in one
 *      database transaction.
 *   4. Run external side effects (Google Calendar + email) best-effort.
 */
export async function acceptRequest(
  requestId: string,
  scheduledAt: string | null,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const supabase = getServiceSupabase();

  // 1. Load the request.
  const { data: req, error: loadErr } = await supabase
    .from("booking_requests")
    .select("*")
    .eq("id", requestId)
    .eq("organization_id", admin.organizationId)
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

  const scheduledEndsAt = scheduledAt
    ? new Date(
        new Date(scheduledAt).getTime() +
          Math.max(totalDurationMinutes(req.services, req.add_ons), 60) *
            60_000,
      ).toISOString()
    : null;

  const { data: bookingId, error: acceptErr } = await supabase.rpc(
    "create_booking_from_request",
    {
      p_organization_id: admin.organizationId,
      p_request_id: requestId,
      p_owner_id: userId,
      p_scheduled_at: scheduledAt,
      p_scheduled_ends_at: scheduledEndsAt,
    },
  );

  if (acceptErr || !bookingId) {
    console.error("[accept] transactional accept failed", acceptErr);
    if (acceptErr?.code === "23P01") {
      return {
        ok: false,
        error:
          "That time overlaps another active booking. Pick a different slot.",
      };
    }
    return { ok: false, error: "Could not accept booking request." };
  }

  // 3b. Push to Google Calendar (best-effort). Skipped if no calendar is
  // connected. If the scheduledAt is null (accepted without a date), we
  // skip here too — the admin will set the time later and we'll need a
  // reschedule affordance to push the event at that point.
  if (scheduledAt) {
    try {
      const gcal = await getGoogleCalendarClient({
        organizationId: admin.organizationId,
      });
      if (gcal) {
        const startDate = new Date(scheduledAt);
        const duration = Math.max(
          totalDurationMinutes(req.services, req.add_ons),
          60,
        );
        const endDate = new Date(startDate.getTime() + duration * 60_000);
        const addressLine = [req.street_address, req.city, req.postal_code]
          .filter(Boolean)
          .join(", ");
        const event = await gcal.createEvent({
          summary: `Shoot — ${req.street_address}`,
          location: addressLine,
          description:
            `Realtor: ${req.contact_name}\nEmail: ${req.contact_email}\n` +
            (req.contact_phone ? `Phone: ${req.contact_phone}\n` : "") +
            (req.brokerage ? `Brokerage: ${req.brokerage}\n` : "") +
            `Services: ${req.services.join(", ")}\n` +
            (req.add_ons.length ? `Add-ons: ${req.add_ons.join(", ")}\n` : "") +
            (req.notes ? `\nNotes:\n${req.notes}\n` : ""),
          startISO: startDate.toISOString(),
          endISO: endDate.toISOString(),
          attendeeEmail: req.contact_email,
          attendeeName: req.contact_name,
        });
        await supabase
          .from("bookings")
          .update({
            google_calendar_event_id: event.id,
            google_calendar_event_url: event.htmlLink,
          })
          .eq("id", bookingId)
          .eq("organization_id", admin.organizationId);
      }
    } catch (err) {
      console.warn("[accept] google calendar event create failed", err);
    }
  }

  // 6. Send the realtor a welcome + one-click sign-in link to the portal.
  //    Fire-and-forget in the sense that any failure here is logged but
  //    doesn't fail the accept — the core records already exist.
  await sendShootConfirmedEmail({
    bookingId,
    email: req.contact_email,
    organizationId: admin.organizationId,
    contactName: req.contact_name,
    streetAddress: req.street_address,
    scheduledAt,
    services: req.services,
  });

  revalidatePath("/admin/inbox");
  revalidatePath("/admin/bookings");
  redirect(`/admin/bookings/${bookingId}`);
}

/**
 * Generate a one-shot Supabase magic link for the realtor and email it
 * to them wrapped in a friendly onboarding message. The link sends them
 * through our normal /auth/callback handler, which exchanges the code
 * for a session and redirects to /portal.
 *
 * Best-effort — logs and swallows failures so a misconfigured email
 * provider or flaky `generateLink` call can't block the admin's accept.
 */
async function sendShootConfirmedEmail(args: {
  bookingId: string;
  email: string;
  organizationId: string;
  contactName: string;
  streetAddress: string;
  scheduledAt: string | null;
  services: string[];
}): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    console.warn(
      "[accept.email] NEXT_PUBLIC_APP_URL not set — skipping portal invite.",
    );
    await logBookingNotification({
      bookingId: args.bookingId,
      kind: "shoot_confirmed",
      recipientEmail: args.email,
      status: "skipped",
      error: "NEXT_PUBLIC_APP_URL not set",
    });
    return;
  }

  const redirectTo = new URL("/auth/callback", appUrl);
  redirectTo.searchParams.set("next", "/portal");

  const supabase = getServiceSupabase();
  let portalLink: string;
  let usedFallbackLink = false;
  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: args.email,
      options: { redirectTo: redirectTo.toString() },
    });
    if (error || !data?.properties?.action_link) {
      console.warn(
        "[accept.email] generateLink failed — falling back to sign-in page.",
        error?.message,
      );
      const fallback = new URL("/auth/sign-in", appUrl);
      fallback.searchParams.set("next", "/portal");
      portalLink = fallback.toString();
      usedFallbackLink = true;
    } else {
      portalLink = data.properties.action_link;
    }
  } catch (err) {
    console.warn("[accept.email] generateLink threw — using fallback.", err);
    const fallback = new URL("/auth/sign-in", appUrl);
    fallback.searchParams.set("next", "/portal");
    portalLink = fallback.toString();
    usedFallbackLink = true;
  }

  const emailSettings = await getOrganizationEmailSettings(args.organizationId);
  const mail = shootConfirmedEmail({
    contactName: args.contactName,
    streetAddress: args.streetAddress,
    scheduledAt: args.scheduledAt,
    services: args.services,
    portalLink,
    companyName: emailSettings.organizationName,
  });

  const result = await sendEmail({
    to: args.email,
    subject: mail.subject,
    html: mail.html,
    organizationId: args.organizationId,
    replyTo: emailSettings.replyToEmail ?? undefined,
  });

  await logBookingNotification({
    bookingId: args.bookingId,
    kind: "shoot_confirmed",
    recipientEmail: args.email,
    status: result.ok ? (result.skipped ? "skipped" : "sent") : "failed",
    providerMessageId: result.id,
    error: result.ok ? undefined : result.error,
    metadata: {
      usedFallbackLink,
      emailSkipped: Boolean(result.skipped),
    },
  });

  if (!result.ok) {
    console.warn("[accept.email] send failed", result.error);
  }
}

async function logBookingNotification(args: {
  bookingId: string;
  kind: string;
  recipientEmail: string;
  status: "sent" | "skipped" | "failed";
  providerMessageId?: string;
  error?: string;
  metadata?: Record<string, boolean | string | number | null>;
}): Promise<void> {
  const supabase = getServiceSupabase();
  const { error } = await supabase.from("booking_notifications").upsert(
    {
      booking_id: args.bookingId,
      kind: args.kind,
      recipient_email: args.recipientEmail,
      status: args.status,
      provider_message_id: args.providerMessageId ?? null,
      error: args.error ?? null,
      metadata: args.metadata ?? {},
      sent_at: new Date().toISOString(),
    },
    { onConflict: "booking_id,kind,recipient_email" },
  );

  if (error) {
    console.warn("[accept.email] notification log failed", error);
  }
}
