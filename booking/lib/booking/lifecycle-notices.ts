import "server-only";

import { sendEmail } from "@/lib/email/resend";
import { formatFromAddress, type OrganizationEmailSettings } from "@/lib/email/settings";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export interface LifecycleNoticeDraft {
  recipient: "realtor" | "admin";
  payload: {
    to: string | null;
    from: string | null;
    replyTo: string | null;
    subject: string;
    html: string;
  };
}

export function lifecycleNotice(
  recipient: LifecycleNoticeDraft["recipient"],
  settings: OrganizationEmailSettings,
  args: { to?: string | null; subject: string; html: string; replyTo?: string | null },
): LifecycleNoticeDraft {
  return {
    recipient,
    payload: {
      to: args.to?.trim() || null,
      from: process.env.EMAIL_FROM ? formatFromAddress(process.env.EMAIL_FROM, settings.fromName) : null,
      replyTo: args.replyTo === undefined ? settings.replyToEmail : args.replyTo,
      subject: args.subject,
      html: args.html,
    },
  };
}

export async function changeBookingWithNotices(args: {
  organizationId: string;
  bookingId: string;
  expectedVersion: number;
  event: "rescheduled" | "cancelled";
  initiator: "admin" | "realtor";
  notices: LifecycleNoticeDraft[];
  scheduledAt?: string;
  scheduledEndsAt?: string;
}): Promise<{ ok: true; noticeIds: string[] } | { ok: false; code?: string }> {
  const { data, error } = await getServiceSupabase().rpc("change_booking_with_lifecycle_notices", {
    p_organization_id: args.organizationId,
    p_booking_id: args.bookingId,
    p_expected_version: args.expectedVersion,
    p_event: args.event,
    p_initiator: args.initiator,
    p_notices: args.notices as unknown as Json,
    p_scheduled_at: args.scheduledAt ?? null,
    p_scheduled_ends_at: args.scheduledEndsAt ?? null,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data) ||
      !Array.isArray(data.notice_ids) || !data.notice_ids.every((id) => typeof id === "string")) {
    return { ok: false, code: error?.code };
  }
  return { ok: true, noticeIds: data.notice_ids as string[] };
}

type NoticeRow = {
  id: string; organization_id: string; booking_id: string;
  recipient: "realtor" | "admin"; payload: Json;
  lease_token: string | null; lease_expires_at: string | null;
};

function parsePayload(value: Json): LifecycleNoticeDraft["payload"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.to !== "string" || !value.to ||
      typeof value.subject !== "string" || typeof value.html !== "string" ||
      !(value.from === null || typeof value.from === "string") ||
      !(value.replyTo === null || typeof value.replyTo === "string")) return null;
  return value as LifecycleNoticeDraft["payload"];
}

/** One bounded pair of sends; the database owns leases and the retry window. */
export async function dispatchLifecycleNotices(args: {
  dispatchNotBefore: string;
  organizationId?: string;
  bookingId?: string;
}): Promise<{ ok: boolean; attempted: number; delivered: number }> {
  const service = getServiceSupabase();
  const { data, error } = await service.rpc("claim_booking_lifecycle_notices", {
    p_not_before: args.dispatchNotBefore,
    p_organization_id: args.organizationId ?? null,
    p_booking_id: args.bookingId ?? null,
    p_limit: 2,
  });
  if (error || !data) return { ok: false, attempted: 0, delivered: 0 };
  const jobs = data as NoticeRow[];
  const delivered = await Promise.all(jobs.map(async (job) => {
    // A delayed worker must not begin a request after its lease is nearly over.
    if (!job.lease_token || !job.lease_expires_at ||
        Date.parse(job.lease_expires_at) - Date.now() < 20_000) return false;
    const payload = parsePayload(job.payload);
    let providerId: string | null = null;
    let errorCode = "delivery_unconfirmed";
    try {
      if (payload) {
        const sent = await sendEmail({
          to: payload.to!, subject: payload.subject, html: payload.html,
          fromAddress: payload.from, replyTo: payload.replyTo,
          organizationId: job.organization_id,
          idempotencyKey: `booking-lifecycle-${job.id}`,
        });
        if (sent.ok && !sent.skipped && sent.id) providerId = sent.id;
        else if (sent.skipped) errorCode = "provider_unavailable";
        else if (sent.error?.startsWith("Resend ") && !sent.error.includes("request failed")) errorCode = "provider_rejected";
      }
    } catch {
      // No raw provider details, recipient addresses, or email bodies in logs.
    }
    try {
      const finished = await service.rpc("finish_booking_lifecycle_notice", {
        p_organization_id: job.organization_id, p_id: job.id,
        p_lease_token: job.lease_token, p_provider_id: providerId, p_error_code: errorCode,
      });
      return !finished.error && finished.data === true && providerId !== null;
    } catch {
      // A lost receipt remains leased; reclaim uses the original provider key.
      return false;
    }
  }));
  return { ok: delivered.every(Boolean), attempted: jobs.length, delivered: delivered.filter(Boolean).length };
}

export async function deliverChangedBookingNotices(args: {
  organizationId: string; bookingId: string; noticeIds: string[];
}): Promise<{ realtorNotified: boolean; warning?: string }> {
  if (!args.noticeIds.length) return { realtorNotified: false };
  try {
    await dispatchLifecycleNotices({
      organizationId: args.organizationId, bookingId: args.bookingId,
      dispatchNotBefore: "1970-01-01T00:00:00.000Z",
    });
    const { data, error } = await getServiceSupabase().from("booking_lifecycle_notices")
      .select("id, recipient, status").eq("organization_id", args.organizationId)
      .eq("booking_id", args.bookingId).in("id", args.noticeIds);
    if (!error && data?.length === args.noticeIds.length) {
      const pending = data.some((notice) => !["completed", "superseded"].includes(notice.status));
      return {
        realtorNotified: data.some((notice) => notice.recipient === "realtor" && notice.status === "completed"),
        warning: pending ? "The booking change is saved, but email delivery is not confirmed. The studio can check notification status; eligible notices will retry automatically." : undefined,
      };
    }
  } catch { /* The booking and its notices already committed together. */ }
  return { realtorNotified: false, warning: "The booking change is saved, but notification status is unavailable. Please contact the studio if you need confirmation." };
}
