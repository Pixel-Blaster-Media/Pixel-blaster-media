import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { BUSINESS_TZ } from "@/lib/booking/availability";
import { createManageToken } from "@/lib/booking/manage-token";
import { sendEmail } from "@/lib/email/resend";
import { shootReminderEmail } from "@/lib/email/templates";
import { sendPushBestEffort } from "@/lib/notifications/push";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ReminderClaim {
  id: string; organization_id: string; booking_id: string; schedule_version: number;
  lease_token: string; idempotency_key: string; attempts: number;
  payload: { scheduled_at: string; street_address: string; city: string | null;
    email: string; contact_name: string; company_name: string; from_name: string;
    reply_to: string | null; suppress_realtor_notifications: boolean };
}

/** Rolling 24-hour eligibility includes same-day recovery, never past shoots.
 * The DB owns generation, lease, retry window and immutable snapshot. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "Cron unavailable" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getServiceSupabase();
  const deadline = Date.now() + 40_000;
  const due = await supabase.rpc("list_due_booking_reminders", { p_limit: 20 });
  if (due.error) return NextResponse.json({ ok: false, error: "Reminder lookup failed" }, { status: 503 });
  let sent = 0, skipped = 0, failed = 0;
  let deadlineReached = false;
  for (const identity of due.data ?? []) {
    if (Date.now() >= deadline) { deadlineReached = true; break; }
    try {
      const lease = randomUUID();
      const claimed = await supabase.rpc("claim_booking_reminder", {
        p_organization_id: identity.organization_id, p_booking_id: identity.booking_id,
        p_schedule_version: identity.schedule_version, p_lease_token: lease,
      });
      if (claimed.error) { failed++; continue; }
      if (!claimed.data) { skipped++; continue; }
      const claim = claimed.data as unknown as ReminderClaim;
      const finish = async (outcome: string, providerId: string | null = null) => {
        const result = await supabase.rpc("finish_booking_reminder", {
          p_organization_id: identity.organization_id, p_job_id: claim.id,
          p_lease_token: lease, p_outcome: outcome, p_provider_id: providerId,
        });
        if (result.error || result.data !== true) throw new Error("Reminder settlement unconfirmed");
      };
      const booking = claim.payload;
      if (claim.organization_id !== identity.organization_id || claim.booking_id !== identity.booking_id ||
          claim.schedule_version !== identity.schedule_version || claim.lease_token !== lease ||
          claim.idempotency_key !== `reminder:${claim.id}` || !booking ||
          typeof booking.suppress_realtor_notifications !== "boolean" ||
          ![booking.scheduled_at,booking.street_address,booking.email,booking.contact_name,booking.company_name,booking.from_name].every(v => typeof v === "string" && v.length>0) ||
          !Number.isFinite(Date.parse(booking.scheduled_at)) ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email) ||
          !(booking.reply_to === null || typeof booking.reply_to === "string") ||
          !(booking.city === null || typeof booking.city === "string")) {
        await finish("dead_letter"); failed++; continue;
      }
      const timeLabel = new Date(booking.scheduled_at).toLocaleString("en-CA", {
        timeZone: BUSINESS_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
      // Push is deliberately at-most-once best effort, not provider-idempotent.
      if (claim.attempts === 1) await sendPushBestEffort(identity.organization_id, {
        title: "Upcoming shoot", body: `${timeLabel} · ${booking.street_address}`,
        url: `/admin/bookings/${identity.booking_id}`, tag: `shoot-reminder-${claim.id}`,
      });
      if (booking.suppress_realtor_notifications) {
        await finish("skipped"); skipped++; continue;
      }
      const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
      if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("Invalid app origin");
      const email = shootReminderEmail({ contactName: booking.contact_name,
        streetAddress: booking.street_address, city: booking.city, timeLabel,
        companyName: booking.company_name,
        manageLink: `${origin.origin}/book/manage/${createManageToken(identity.booking_id)}`,
      });
      const args = { to: booking.email, subject: email.subject, html: email.html,
        organizationId: identity.organization_id, fromName: booking.from_name, replyTo: booking.reply_to,
        idempotencyKey: claim.idempotency_key };
      const authorized = await supabase.rpc("authorize_booking_reminder", {
        p_organization_id: identity.organization_id, p_job_id: claim.id, p_lease_token: lease,
        p_request_hash: createHash("sha256").update(JSON.stringify({ ...args, transportFrom: process.env.EMAIL_FROM ?? null })).digest("hex"),
      });
      if (authorized.error || authorized.data !== true) { failed++; continue; }
      const result = await sendEmail(args);
      if (result.skipped) { await finish("retryable"); skipped++; }
      else if (!result.ok || !result.id) { await finish("retryable"); failed++; }
      else { await finish("completed", result.id); sent++; }
    } catch {
      // Unknown provider/settlement outcome retains the lease for bounded reclaim.
      failed++;
    }
  }
  return NextResponse.json({ ok: failed === 0, sent, skipped, failed, deadlineReached });
}
