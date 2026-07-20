import "server-only";

import { BUSINESS_TZ } from "@/lib/booking/availability";
import { createManageToken } from "@/lib/booking/manage-token";
import { ccRecipientsFor } from "@/lib/email/recipients";
import { sendEmail, type SendEmailResult } from "@/lib/email/resend";
import { getGoogleCalendarClient } from "@/lib/integrations/google-calendar/client";
import {
  parseRealtorNotificationPolicy,
  type RealtorNotificationPolicy,
} from "@/lib/integrations/realtor-notification-policy";
import { createInvoiceForBooking } from "@/lib/integrations/quickbooks/invoice";
import { sendPushBestEffort } from "@/lib/notifications/push";
import { getServiceSupabase } from "@/lib/supabase/server";

import {
  ProviderMutationTimeoutError,
  runIntegrationDispatchSequence,
  withProviderMutationTimeout,
  type IntegrationJobType,
} from "./dispatcher-core";
import {
  claimIntegrationJob,
  finishIntegrationJob,
  type ClaimedIntegrationJob,
  type IntegrationJobCompletionStatus,
} from "./jobs";

const PROVIDER_MUTATION_TIMEOUT_MS = 15_000;
const SETTLEMENT_TIMEOUT_MS = 2_000;

export type IntegrationJobDispatchOutcome =
  | "completed"
  | "skipped"
  | "retryable"
  | "dead_letter"
  | "not_claimable"
  | "claim_failed"
  | "settlement_failed"
  | "provider_timeout_pending"
  | "deadline_exceeded";

export interface IntegrationJobDispatchResult {
  jobType: IntegrationJobType;
  outcome: IntegrationJobDispatchOutcome;
}

export async function dispatchBookingIntegrationJobs({
  organizationId,
  bookingId,
  workerId,
  jobTypes,
  deadlineAtMs,
  providerMutationTimeoutMs = PROVIDER_MUTATION_TIMEOUT_MS,
}: {
  organizationId: string;
  bookingId: string;
  workerId: string;
  jobTypes?: readonly IntegrationJobType[];
  deadlineAtMs?: number;
  providerMutationTimeoutMs?: number;
}): Promise<IntegrationJobDispatchResult[]> {
  return runIntegrationDispatchSequence(async (jobType) => {
    if (deadlineAtMs !== undefined && Date.now() >= deadlineAtMs) {
      return { jobType, outcome: "deadline_exceeded" };
    }

    let realtorNotificationsSuppressed: boolean | undefined;
    if (
      jobType === "google_calendar.event.create" ||
      jobType === "email.booking.confirmation"
    ) {
      const policy = await loadRealtorNotificationPolicy(
        organizationId,
        bookingId,
      );
      if (!policy.ok) {
        // Leave the job unclaimed and pending. A later scheduler pass can
        // safely retry because no provider mutation has started.
        return { jobType, outcome: "claim_failed" };
      }
      realtorNotificationsSuppressed = policy.suppressed;
    }

    const claimed = await claimIntegrationJob({
      organizationId,
      bookingId,
      jobType,
      workerId,
    });
    if (claimed.outcome !== "claimed") {
      return { jobType, outcome: claimed.outcome };
    }

    return dispatchClaimedJob({
      organizationId,
      jobType,
      claim: claimed.claim,
      providerMutationTimeoutMs,
      realtorNotificationsSuppressed,
    });
  }, jobTypes);
}

async function dispatchClaimedJob({
  organizationId,
  jobType,
  claim,
  providerMutationTimeoutMs,
  realtorNotificationsSuppressed,
}: {
  organizationId: string;
  jobType: IntegrationJobType;
  claim: ClaimedIntegrationJob;
  providerMutationTimeoutMs: number;
  realtorNotificationsSuppressed?: boolean;
}): Promise<IntegrationJobDispatchResult> {
  switch (jobType) {
    case "quickbooks.invoice.create":
      return dispatchQuickBooksInvoice(organizationId, jobType, claim, providerMutationTimeoutMs);
    case "google_calendar.event.create":
      return dispatchCalendarEvent(
        organizationId,
        jobType,
        claim,
        providerMutationTimeoutMs,
        realtorNotificationsSuppressed === true,
      );
    case "email.booking.confirmation":
      return dispatchCustomerEmail(
        organizationId,
        jobType,
        claim,
        providerMutationTimeoutMs,
        realtorNotificationsSuppressed === true,
      );
    case "email.admin.new_booking":
      return dispatchAdminEmail(organizationId, jobType, claim, providerMutationTimeoutMs);
    case "push.admin.new_booking":
      return dispatchAdminPush(organizationId, jobType, claim, providerMutationTimeoutMs);
  }
}

async function dispatchQuickBooksInvoice(
  organizationId: string,
  jobType: IntegrationJobType,
  claim: ClaimedIntegrationJob,
  timeoutMs: number,
): Promise<IntegrationJobDispatchResult> {
  const payload = claim.payload;
  try {
    const invoice = await withProviderMutationTimeout(
      createInvoiceForBooking({
        bookingId: payload.booking_id,
        services: payload.line_items.filter((item) => item.kind !== "addon").map((item) => item.slug),
        addOns: payload.line_items.filter((item) => item.kind === "addon").map((item) => item.slug),
        realtor: {
          email: payload.realtor.email,
          full_name: payload.realtor.full_name,
          phone: payload.realtor.phone,
          brokerage: payload.realtor.brokerage,
        },
        property: {
          street_address: payload.property.street_address,
          city: payload.property.city,
          postal_code: payload.property.postal_code,
        },
        lineItems: payload.line_items
          .filter((item) => item.unit_price_cents > 0)
          .map((item) => ({
            description: item.name,
            amountCents: item.unit_price_cents * Math.max(1, item.quantity),
          })),
      }),
      timeoutMs,
      jobType,
    );
    if (!invoice.ok) {
      return settle({
        organizationId,
        jobType,
        claim,
        status: "dead_letter",
        errorCode: "ambiguous_provider_result",
        errorMessage: "QuickBooks result requires operator reconciliation",
      });
    }
    return settle({
      organizationId,
      jobType,
      claim,
      status: "completed",
      providerExternalId: invoice.invoiceId,
      providerResult: {
        invoice_number: invoice.invoiceNumber ?? null,
        invoice_url: invoice.invoiceUrl ?? null,
        total_cents: invoice.totalCents ?? null,
      },
    });
  } catch (error) {
    if (error instanceof ProviderMutationTimeoutError) {
      return { jobType, outcome: "provider_timeout_pending" };
    }
    return settle({
      organizationId,
      jobType,
      claim,
      status: "dead_letter",
      errorCode: "ambiguous_provider_result",
      errorMessage: "QuickBooks result requires operator reconciliation",
    });
  }
}

async function dispatchCalendarEvent(
  organizationId: string,
  jobType: IntegrationJobType,
  claim: ClaimedIntegrationJob,
  timeoutMs: number,
  realtorNotificationsSuppressed: boolean,
): Promise<IntegrationJobDispatchResult> {
  const payload = claim.payload;
  try {
    const startAt = new Date(payload.booking.scheduled_at);
    const endAt = new Date(payload.booking.scheduled_ends_at);
    const services = labels(payload, false);
    const addons = labels(payload, true);
    const street = propertyStreet(payload);
    const address = [street, payload.property.city, payload.property.postal_code].filter(Boolean).join(", ");
    const occupancy = payload.booking.is_vacant === "vacant"
      ? "Vacant"
      : payload.booking.is_vacant === "partial"
        ? "Partially occupied"
        : payload.booking.is_vacant === "occupied"
          ? "Occupied"
          : null;
    const operation = await withProviderMutationTimeout(
      (async () => {
        const calendar = await getGoogleCalendarClient({
          organizationId: payload.organization_id,
        });
        if (!calendar) return { skipped: true as const };
        const event = await calendar.createEvent({
          summary: [payload.realtor.full_name, services, street].map((part) => part.trim()).filter(Boolean).join(" - "),
          location: address,
          description:
            `Realtor: ${payload.realtor.full_name}\nEmail: ${payload.realtor.email}\n` +
            (payload.realtor.phone ? `Phone: ${payload.realtor.phone}\n` : "") +
            `Services: ${services}\n` +
            (addons ? `Add-ons: ${addons}\n` : "") +
            (payload.booking.square_footage ? `Size: ~${payload.booking.square_footage} sqft\n` : "") +
            (occupancy ? `Occupancy: ${occupancy}\n` : "") +
            (payload.booking.include_basement != null
              ? `Basement: ${payload.booking.include_basement ? "include" : "skip"}\n`
              : "") +
            (payload.booking.client_notes ? `\nNotes:\n${payload.booking.client_notes}\n` : ""),
          startISO: startAt.toISOString(),
          endISO: endAt.toISOString(),
          ...(realtorNotificationsSuppressed
            ? {}
            : {
                attendeeEmail: payload.realtor.email,
                attendeeName: payload.realtor.full_name,
              }),
        });
        const { error } = await getServiceSupabase()
          .from("bookings")
          .update({ google_calendar_event_id: event.id, google_calendar_event_url: event.htmlLink })
          .eq("id", payload.booking_id)
          .eq("organization_id", payload.organization_id);
        return { skipped: false as const, event, error };
      })(),
      timeoutMs,
      jobType,
    );
    if (operation.skipped) {
      return settle({
        organizationId,
        jobType,
        claim,
        status: "skipped",
        providerResult: { reason: "not_configured" },
      });
    }
    const { event, error } = operation;
    return settle({
      organizationId,
      jobType,
      claim,
      status: error ? "dead_letter" : "completed",
      providerExternalId: event.id,
      providerResult: { event_url: event.htmlLink ?? null },
      ...(error
        ? {
            errorCode: "local_persistence_failed",
            errorMessage: "Calendar event exists but its local reference needs reconciliation",
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof ProviderMutationTimeoutError) {
      return { jobType, outcome: "provider_timeout_pending" };
    }
    return settle({
      organizationId,
      jobType,
      claim,
      status: "dead_letter",
      errorCode: "ambiguous_provider_result",
      errorMessage: "Calendar result requires operator reconciliation",
    });
  }
}

async function dispatchCustomerEmail(
  organizationId: string,
  jobType: IntegrationJobType,
  claim: ClaimedIntegrationJob,
  timeoutMs: number,
  realtorNotificationsSuppressed: boolean,
): Promise<IntegrationJobDispatchResult> {
  const payload = claim.payload;
  if (realtorNotificationsSuppressed) {
    return settle({
      organizationId,
      jobType,
      claim,
      status: "skipped",
      providerResult: { reason: "realtor_notifications_suppressed" },
    });
  }
  const startAt = new Date(payload.booking.scheduled_at);
  const endAt = new Date(payload.booking.scheduled_ends_at);
  const services = labels(payload, false);
  const addons = labels(payload, true);
  const street = propertyStreet(payload);
  const when = formatWhen(startAt);
  const invoiceResult = claim.dependencyResult;
  const invoiceUrl = safeHttpUrl(
    invoiceResult && typeof invoiceResult === "object" && !Array.isArray(invoiceResult) &&
      typeof invoiceResult.invoice_url === "string"
      ? invoiceResult.invoice_url
      : null,
  );
  let manageUrl: string | null = null;
  try {
    manageUrl = `${payload.app_url}/book/manage/${createManageToken(payload.booking_id)}`;
  } catch {
    console.warn("[integration-dispatch] manage token unavailable");
  }
  const calendarLink = googleCalendarTemplateUrl({
    title: `${payload.organization.name} — media shoot`,
    start: startAt,
    end: endAt,
    location: [street, payload.property.city, payload.property.postal_code].filter(Boolean).join(", "),
    details: `Services: ${services}${addons ? `\nAdd-ons: ${addons}` : ""}`,
  });
  const cc = ccRecipientsFor(payload.realtor.email, payload.realtor.delivery_cc_emails);
  return dispatchEmailMutation({
    organizationId,
    jobType,
    claim,
    timeoutMs,
    mutation: sendEmail({
      to: payload.realtor.email,
      ...(cc.length > 0 ? { cc } : {}),
      subject: `Booking confirmed — ${street}`,
      organizationId: payload.organization_id,
      fromName: payload.organization.from_name,
      replyTo: payload.organization.reply_to_email,
      idempotencyKey: claim.idempotencyKey,
      html: `
        <p>Hi ${escapeHtml(payload.realtor.full_name)},</p>
        <p>Your shoot is booked and on our calendar.</p>
        <p><strong>Address:</strong> ${escapeHtml(street)}<br>
        <strong>When:</strong> ${escapeHtml(when)}<br>
        <strong>Services:</strong> ${escapeHtml(services)}<br>
        ${addons ? `<strong>Add-ons:</strong> ${escapeHtml(addons)}<br>` : ""}</p>
        <p><a href="${calendarLink}">Add this shoot to your Google Calendar</a></p>
        ${manageUrl ? `<p>Need to reschedule or cancel? <a href="${manageUrl}">Manage this booking</a>.</p>` : ""}
        ${invoiceUrl ? `<p><strong>Billing:</strong> Your invoice is ready — <a href="${invoiceUrl}">pay your invoice online</a>.</p>` : ""}
        <p>View and manage this booking at <a href="${payload.app_url}/portal">${payload.app_url || "your client portal"}</a>.
        Sign in with ${escapeHtml(payload.realtor.email)}.</p>
        <p>— ${escapeHtml(payload.organization.name)}</p>`,
    }),
    skippedReason: "not_configured",
    failureMessage: "Customer confirmation email was not accepted",
  });
}

async function loadRealtorNotificationPolicy(
  organizationId: string,
  bookingId: string,
): Promise<RealtorNotificationPolicy> {
  const { data, error } = await getServiceSupabase()
    .from("bookings")
    .select("suppress_realtor_notifications")
    .eq("organization_id", organizationId)
    .eq("id", bookingId)
    .maybeSingle<{ suppress_realtor_notifications: boolean }>();
  if (error || !data) return { ok: false };
  return parseRealtorNotificationPolicy(
    data.suppress_realtor_notifications,
  );
}

async function dispatchAdminEmail(
  organizationId: string,
  jobType: IntegrationJobType,
  claim: ClaimedIntegrationJob,
  timeoutMs: number,
): Promise<IntegrationJobDispatchResult> {
  const payload = claim.payload;
  const recipient = payload.organization.admin_notification_email;
  const street = propertyStreet(payload);
  const mutation: Promise<SendEmailResult> = recipient
    ? sendEmail({
        to: recipient,
        subject: `New booking — ${street}`,
        organizationId: payload.organization_id,
        fromName: payload.organization.from_name,
        idempotencyKey: claim.idempotencyKey,
        html: `<p><strong>${escapeHtml(payload.realtor.full_name)}</strong> just booked a shoot.</p>
          <p><strong>Address:</strong> ${escapeHtml(street)}<br>
          <strong>When:</strong> ${escapeHtml(formatWhen(new Date(payload.booking.scheduled_at)))}<br>
          <strong>Services:</strong> ${escapeHtml(labels(payload, false))}<br>
          ${labels(payload, true) ? `<strong>Add-ons:</strong> ${escapeHtml(labels(payload, true))}<br>` : ""}
          ${payload.booking.client_notes ? `<strong>Notes:</strong> ${escapeHtml(payload.booking.client_notes)}<br>` : ""}</p>
          <p>Open in admin: ${payload.app_url}/admin/bookings/${payload.booking_id}</p>`,
        replyTo: payload.realtor.email,
      })
    : Promise.resolve({ ok: true, skipped: true });
  return dispatchEmailMutation({
    organizationId,
    jobType,
    claim,
    timeoutMs,
    mutation,
    skippedReason: "no_recipient_or_config",
    failureMessage: "Admin booking email was not accepted",
  });
}

async function dispatchEmailMutation({
  organizationId,
  jobType,
  claim,
  timeoutMs,
  mutation,
  skippedReason,
  failureMessage,
}: {
  organizationId: string;
  jobType: IntegrationJobType;
  claim: ClaimedIntegrationJob;
  timeoutMs: number;
  mutation: Promise<SendEmailResult>;
  skippedReason: string;
  failureMessage: string;
}): Promise<IntegrationJobDispatchResult> {
  try {
    const result = await withProviderMutationTimeout(mutation, timeoutMs, jobType);
    return settle({
      organizationId,
      jobType,
      claim,
      status: result.skipped ? "skipped" : result.ok ? "completed" : "retryable",
      providerExternalId: result.id,
      providerResult: result.skipped ? { reason: skippedReason } : {},
      ...(!result.ok
        ? { errorCode: "email_send_failed", errorMessage: failureMessage }
        : {}),
    });
  } catch (error) {
    if (error instanceof ProviderMutationTimeoutError) {
      return { jobType, outcome: "provider_timeout_pending" };
    }
    return settle({
      organizationId,
      jobType,
      claim,
      status: "retryable",
      errorCode: "email_send_failed",
      errorMessage: failureMessage,
    });
  }
}

async function dispatchAdminPush(
  organizationId: string,
  jobType: IntegrationJobType,
  claim: ClaimedIntegrationJob,
  timeoutMs: number,
): Promise<IntegrationJobDispatchResult> {
  const payload = claim.payload;
  try {
    const result = await withProviderMutationTimeout(
      sendPushBestEffort(payload.organization_id, {
        title: "New booking",
        body: `${payload.realtor.full_name} · ${propertyStreet(payload)} · ${formatWhen(new Date(payload.booking.scheduled_at))}`,
        url: `/admin/bookings/${payload.booking_id}`,
        tag: `booking-new-${payload.booking_id}`,
      }),
      timeoutMs,
      jobType,
    );
    return settle({
      organizationId,
      jobType,
      claim,
      status: result.skipped ? "skipped" : result.failed > 0 ? "dead_letter" : "completed",
      providerResult: {
        sent: result.sent,
        failed: result.failed,
        removed: result.removed,
        skipped: result.skipped,
      },
      ...(result.failed > 0
        ? {
            errorCode: "partial_push_failure",
            errorMessage: "Push delivery was partially accepted; do not retry without provider review",
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof ProviderMutationTimeoutError) {
      return { jobType, outcome: "provider_timeout_pending" };
    }
    return settle({
      organizationId,
      jobType,
      claim,
      status: "dead_letter",
      errorCode: "ambiguous_provider_result",
      errorMessage: "Push result requires operator reconciliation",
    });
  }
}

async function settle({
  organizationId,
  jobType,
  claim,
  status,
  providerExternalId,
  providerResult,
  errorCode,
  errorMessage,
}: {
  organizationId: string;
  jobType: IntegrationJobType;
  claim: ClaimedIntegrationJob;
  status: IntegrationJobCompletionStatus;
  providerExternalId?: string;
  providerResult?: Record<string, string | number | boolean | null>;
  errorCode?: string;
  errorMessage?: string;
}): Promise<IntegrationJobDispatchResult> {
  try {
    const settled = await withProviderMutationTimeout(
      finishIntegrationJob({
        organizationId,
        claim,
        status,
        providerExternalId,
        providerResult: providerResult ?? {},
        errorCode,
        errorMessage,
      }),
      SETTLEMENT_TIMEOUT_MS,
      jobType,
    );
    if (!settled) return { jobType, outcome: "settlement_failed" };
    return { jobType, outcome: status };
  } catch {
    return { jobType, outcome: "settlement_failed" };
  }
}

function labels(payload: ClaimedIntegrationJob["payload"], addons: boolean): string {
  return payload.line_items
    .filter((item) => addons ? item.kind === "addon" : item.kind !== "addon")
    .map((item) => item.name)
    .join(", ");
}

function propertyStreet(payload: ClaimedIntegrationJob["payload"]): string {
  return payload.property.unit_number
    ? `${payload.property.street_address}, Unit ${payload.property.unit_number}`
    : payload.property.street_address;
}

function formatWhen(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    dateStyle: "full",
    timeStyle: "short",
  }).format(value);
}

function googleCalendarTemplateUrl(args: {
  title: string;
  start: Date;
  end: Date;
  location: string;
  details: string;
}): string {
  const format = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: args.title,
    dates: `${format(args.start)}/${format(args.end)}`,
    location: args.location,
    details: args.details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
