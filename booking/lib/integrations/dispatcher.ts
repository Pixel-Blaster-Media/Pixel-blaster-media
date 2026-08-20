import "server-only";

import { BUSINESS_TZ } from "@/lib/booking/availability";
import { syncStoredBookingGoogleCalendarEvent } from "@/lib/booking/calendar-event-service";
import { createManageToken } from "@/lib/booking/manage-token";
import { ccRecipientsFor } from "@/lib/email/recipients";
import { sendEmail, type SendEmailResult } from "@/lib/email/resend";
import {
  bookingGoogleCalendarLink,
  bookingIcsCalendarLink,
  newBookingStaffEmail,
  shootConfirmedEmail,
} from "@/lib/email/templates";

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
): Promise<IntegrationJobDispatchResult> {
  const payload = claim.payload;
  try {
    const operation = await withProviderMutationTimeout(
      syncStoredBookingGoogleCalendarEvent({
        organizationId: payload.organization_id,
        bookingId: payload.booking_id,
      }),
      timeoutMs,
      jobType,
    );
    if (
      operation.ok &&
      (operation.status === "not_configured" || operation.status === "not_scheduled")
    ) {
      return settle({
        organizationId,
        jobType,
        claim,
        status: "skipped",
        providerResult: { reason: operation.status },
      });
    }
    if (!operation.ok) {
      return settle({
        organizationId,
        jobType,
        claim,
        status: "dead_letter",
        providerExternalId: operation.eventId,
        errorCode: operation.status,
        errorMessage: "Calendar synchronization requires operator reconciliation",
      });
    }
    return settle({
      organizationId,
      jobType,
      claim,
      status: "completed",
      providerExternalId: operation.eventId,
      providerResult: { calendar_status: operation.status },
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
  const services = itemNames(payload, false);
  const addons = itemNames(payload, true);
  const street = propertyStreet(payload);
  const fullAddress = [street, payload.property.city, payload.property.postal_code]
    .filter(Boolean)
    .join(", ");
  const invoiceResult = claim.dependencyResult;
  const invoiceUrl = safeHttpUrl(
    invoiceResult && typeof invoiceResult === "object" && !Array.isArray(invoiceResult) &&
      typeof invoiceResult.invoice_url === "string"
      ? invoiceResult.invoice_url
      : null,
  );
  const appUrl = safeHttpUrl(payload.app_url);
  let manageUrl: string | null = null;
  if (appUrl) {
    try {
      manageUrl = new URL(
        `/book/manage/${createManageToken(payload.booking_id)}`,
        appUrl,
      ).toString();
    } catch {
      console.warn("[integration-dispatch] manage token unavailable");
    }
  }
  const calendarLink = bookingGoogleCalendarLink({
    title: `${payload.organization.name} — media shoot`,
    start: startAt,
    end: endAt,
    location: fullAddress,
    details: `Services: ${services.join(", ")}${addons.length ? `\nAdd-ons: ${addons.join(", ")}` : ""}`,
  });
  const calendarDownloadLink = appUrl
    ? bookingIcsCalendarLink(appUrl, {
        start: startAt,
        end: endAt,
        address: fullAddress,
        services: [...services, ...addons].join(", "),
        organizationName: payload.organization.name,
      })
    : null;
  const email = shootConfirmedEmail({
    contactName: payload.realtor.full_name,
    streetAddress: street,
    city: payload.property.city,
    scheduledAt: payload.booking.scheduled_at,
    scheduledEndsAt: payload.booking.scheduled_ends_at,
    services,
    addOns: addons,
    portalLink: appUrl ? new URL("/portal", appUrl).toString() : "",
    manageLink: manageUrl,
    googleCalendarLink: calendarLink,
    calendarDownloadLink,
    invoiceLink: invoiceUrl,
    companyName: payload.organization.name,
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
      subject: email.subject,
      organizationId: payload.organization_id,
      fromName: payload.organization.from_name,
      replyTo: payload.organization.reply_to_email,
      idempotencyKey: claim.idempotencyKey,
      html: email.html,
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
  const appUrl = safeHttpUrl(payload.app_url);
  const fullAddress = [street, payload.property.city, payload.property.postal_code]
    .filter(Boolean)
    .join(", ");
  const email = newBookingStaffEmail({
    realtorName: payload.realtor.full_name,
    realtorEmail: payload.realtor.email,
    realtorPhone: payload.realtor.phone,
    brokerage: payload.realtor.brokerage,
    streetAddress: street,
    city: payload.property.city,
    scheduledAt: payload.booking.scheduled_at,
    services: itemNames(payload, false),
    addOns: itemNames(payload, true),
    notes: payload.booking.client_notes,
    squareFootage: payload.booking.square_footage,
    occupancy: payload.booking.is_vacant,
    includeBasement: payload.booking.include_basement,
    bookingLink: appUrl
      ? new URL(`/admin/bookings/${payload.booking_id}`, appUrl).toString()
      : null,
    calendarLink: appUrl ? new URL("/admin/calendar", appUrl).toString() : null,
    directionsLink: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`,
    companyName: payload.organization.name,
  });
  const mutation: Promise<SendEmailResult> = recipient
    ? sendEmail({
        to: recipient,
        subject: email.subject,
        organizationId: payload.organization_id,
        fromName: payload.organization.from_name,
        idempotencyKey: claim.idempotencyKey,
        html: email.html,
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

function itemNames(
  payload: ClaimedIntegrationJob["payload"],
  addons: boolean,
): string[] {
  return payload.line_items
    .filter((item) => addons ? item.kind === "addon" : item.kind !== "addon")
    .map((item) => item.name);
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

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
