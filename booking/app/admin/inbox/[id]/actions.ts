"use server";


import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";
import { provisionRealtorAuthUser } from "@/lib/auth/provision-realtor";
import { rollbackProvisionedRealtor } from "@/lib/auth/rollback-provisioned-realtor";
import { totalDurationMinutes } from "@/lib/booking/services";
import { ccRecipientsFor } from "@/lib/email/recipients";
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

  // 2. Reuse only an active realtor already in this organization, otherwise
  // create a new trusted Auth user. Never move, promote, or reactivate an
  // existing identity matched only by email.
  let userId: string | null = null;
  let createdUserInRequest = false;
  let provisioningId: string | null = null;
  try {
    const { data: existingProfile, error: profileLookupError } = await supabase
      .from("profiles")
      .select("id, organization_id, role, archived_at")
      .ilike("email", req.contact_email)
      .maybeSingle<{
        id: string;
        organization_id: string;
        role: "admin" | "realtor";
        archived_at: string | null;
      }>();
    if (profileLookupError) {
      console.error("[accept] existing profile lookup failed", profileLookupError.code);
      return { ok: false, error: "Could not verify the realtor account." };
    }
    if (existingProfile) {
      if (
        existingProfile.organization_id !== admin.organizationId ||
        existingProfile.role !== "realtor" ||
        existingProfile.archived_at
      ) {
        return {
          ok: false,
          error:
            "That email belongs to an existing account that cannot be linked to this company. Contact support.",
        };
      }
      userId = existingProfile.id;
    } else {
      const provisioned = await provisionRealtorAuthUser({
        service: supabase,
        email: req.contact_email,
        fullName: req.contact_name,
        organizationId: admin.organizationId,
        context: "inbox-create",
      });
      if (!provisioned.ok) {
        return {
          ok: false,
          error: `${provisioned.message} Reference: ${provisioned.reference}`,
        };
      }
      userId = provisioned.userId;
      provisioningId = provisioned.provisioningId;
      createdUserInRequest = true;
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
    if (createdUserInRequest && userId && provisioningId) {
      const rollback = await rollbackProvisionedRealtor({
        userId,
        provisioningId,
        context: "inbox-accept",
      });
      if (rollback.status !== "deleted") {
        return {
          ok: false,
          error:
            "The request was not accepted. Do not retry; email info@pixelblastermedia.com and include this reference." +
            (rollback.reference ? ` Reference: ${rollback.reference}` : ""),
        };
      }
    }
    if (acceptErr?.code === "23P01") {
      return {
        ok: false,
        error:
          "That time overlaps another active booking. Pick a different slot.",
      };
    }
    return { ok: false, error: "Could not accept booking request." };
  }
  const { data: notificationProfile } = await supabase
    .from("profiles")
    .select("delivery_cc_emails")
    .eq("id", userId)
    .eq("organization_id", admin.organizationId)
    .maybeSingle<{ delivery_cc_emails: string[] | null }>();

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
        const servicesLabel = req.services.join(", ");
        const event = await gcal.createEvent({
          summary: calendarShootTitle({
            realtor: req.contact_name,
            services: servicesLabel,
            address: req.street_address,
          }),
          location: addressLine,
          description:
            `Realtor: ${req.contact_name}\nEmail: ${req.contact_email}\n` +
            (req.contact_phone ? `Phone: ${req.contact_phone}\n` : "") +
            (req.brokerage ? `Brokerage: ${req.brokerage}\n` : "") +
            `Services: ${servicesLabel}\n` +
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
    ccEmails: ccRecipientsFor(
      req.contact_email,
      notificationProfile?.delivery_cc_emails,
    ),
    organizationId: admin.organizationId,
    contactName: req.contact_name,
    streetAddress: req.street_address,
    scheduledAt,
    services: req.services,
    addOns: req.add_ons,
    notes: req.notes,
  });

  revalidatePath("/admin/inbox");
  revalidatePath("/admin/bookings");
  redirect(`/admin/bookings/${bookingId}`);
}

function calendarShootTitle(args: {
  realtor: string;
  services: string;
  address: string;
}): string {
  return [args.realtor, args.services, args.address]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" - ");
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
  ccEmails: string[];
  organizationId: string;
  contactName: string;
  streetAddress: string;
  scheduledAt: string | null;
  services: string[];
  addOns: string[];
  notes: string | null;
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
    await logManyBookingNotifications({
      bookingId: args.bookingId,
      kind: "shoot_confirmed",
      recipientEmails: args.ccEmails,
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
      fallback.searchParams.set("audience", "realtor");
      fallback.searchParams.set("next", "/portal");
      portalLink = fallback.toString();
      usedFallbackLink = true;
    } else {
      portalLink = data.properties.action_link;
    }
  } catch (err) {
    console.warn("[accept.email] generateLink threw — using fallback.", err);
    const fallback = new URL("/auth/sign-in", appUrl);
    fallback.searchParams.set("audience", "realtor");
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
    addOns: args.addOns,
    notes: args.notes,
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
  const ccMail =
    args.ccEmails.length > 0
      ? shootConfirmedEmail({
          contactName: args.contactName,
          streetAddress: args.streetAddress,
          scheduledAt: args.scheduledAt,
          services: args.services,
          addOns: args.addOns,
          notes: args.notes,
          portalLink: `${appUrl}/portal`,
          companyName: emailSettings.organizationName,
        })
      : null;
  const ccResult = ccMail
    ? await sendEmail({
        to: args.ccEmails,
        subject: ccMail.subject,
        html: ccMail.html,
        organizationId: args.organizationId,
        replyTo: emailSettings.replyToEmail ?? undefined,
      })
    : null;

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
  if (ccResult) {
    await logManyBookingNotifications({
      bookingId: args.bookingId,
      kind: "shoot_confirmed",
      recipientEmails: args.ccEmails,
      status: ccResult.ok ? (ccResult.skipped ? "skipped" : "sent") : "failed",
      providerMessageId: ccResult.id,
      error: ccResult.ok ? undefined : ccResult.error,
      metadata: {
        sentWithoutMagicLink: true,
        emailSkipped: Boolean(ccResult.skipped),
      },
    });
  }

  if (!result.ok) {
    console.warn("[accept.email] send failed", result.error);
  }
  if (ccResult && !ccResult.ok) {
    console.warn("[accept.email] cc send failed", ccResult.error);
  }
}

async function logManyBookingNotifications(args: {
  bookingId: string;
  kind: string;
  recipientEmails: string[];
  status: "sent" | "skipped" | "failed";
  providerMessageId?: string;
  error?: string;
  metadata?: Record<string, boolean | string | number | null>;
}): Promise<void> {
  await Promise.all(
    args.recipientEmails.map((recipientEmail) =>
      logBookingNotification({
        bookingId: args.bookingId,
        kind: args.kind,
        recipientEmail,
        status: args.status,
        providerMessageId: args.providerMessageId,
        error: args.error,
        metadata: args.metadata,
      }),
    ),
  );
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
