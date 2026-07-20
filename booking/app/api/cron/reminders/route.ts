import { NextResponse } from "next/server";

import {
  BUSINESS_TZ,
  businessDateTimeLocalToUtc,
} from "@/lib/booking/availability";
import { createManageToken } from "@/lib/booking/manage-token";
import { sendEmail } from "@/lib/email/resend";
import { getOrganizationEmailSettings } from "@/lib/email/settings";
import { shootReminderEmail } from "@/lib/email/templates";
import { sendPushBestEffort } from "@/lib/notifications/push";
import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * Day-before shoot reminders, invoked daily by Vercel Cron (see
 * booking/vercel.json — 21:00 UTC, i.e. late afternoon in Toronto).
 *
 * Finds every active booking scheduled on TOMORROW's calendar date in the
 * business timezone and emails the realtor a short "is the property ready?"
 * checklist plus a self-serve reschedule link. Each booking is stamped with
 * `reminder_sent_at` only after its own email succeeds, so one bad send
 * never blocks (or double-sends) the rest.
 *
 * Best-effort by design: the handler never throws — failures are counted,
 * logged, and retried on the next run because the stamp stays null.
 */

export const dynamic = "force-dynamic";

interface ReminderBookingRow {
  id: string;
  organization_id: string;
  scheduled_at: string;
  suppress_realtor_notifications: boolean;
  properties: {
    street_address: string;
    city: string | null;
  } | null;
  profiles: {
    email: string;
    full_name: string | null;
  } | null;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET must be configured. Set it in Vercel env vars — Vercel Cron sends it automatically as a Bearer token.",
      },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let start: Date;
  let end: Date;
  try {
    ({ start, end } = tomorrowBusinessDayUtcRange());
  } catch (err) {
    console.warn("[reminders] could not compute tomorrow's range", err);
    return NextResponse.json(
      { ok: false, error: "Could not compute tomorrow's date range." },
      { status: 500 },
    );
  }

  const supabase = getServiceSupabase();
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(
      "id, organization_id, scheduled_at, suppress_realtor_notifications, properties(street_address, city), profiles(email, full_name)",
    )
    .in("status", ["requested", "confirmed"])
    .is("reminder_sent_at", null)
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .returns<ReminderBookingRow[]>();

  if (error) {
    console.warn("[reminders] booking query failed", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // Org settings barely change run-to-run; cache per org so a busy day
  // doesn't fan out into one settings lookup per booking.
  const settingsCache = new Map<
    string,
    Awaited<ReturnType<typeof getOrganizationEmailSettings>>
  >();

  for (const booking of bookings ?? []) {
    try {
      if (!booking.properties) {
        skipped += 1;
        continue;
      }

      const timeLabel = new Date(booking.scheduled_at).toLocaleTimeString(
        "en-CA",
        { timeZone: BUSINESS_TZ, hour: "numeric", minute: "2-digit" },
      );
      const addressLine = [
        booking.properties.street_address,
        booking.properties.city,
      ]
        .filter(Boolean)
        .join(", ");
      await sendPushBestEffort(booking.organization_id, {
        title: "Shoot tomorrow",
        body: `${timeLabel} · ${addressLine}`,
        url: `/admin/bookings/${booking.id}`,
        tag: `shoot-tomorrow-${booking.id}`,
      });

      // Quiet admin bookings still produce the internal operator reminder,
      // but never send the realtor-facing reminder email.
      if (booking.suppress_realtor_notifications) {
        skipped += 1;
        continue;
      }

      if (!booking.profiles?.email) {
        skipped += 1;
        continue;
      }

      let settings = settingsCache.get(booking.organization_id);
      if (!settings) {
        settings = await getOrganizationEmailSettings(booking.organization_id);
        settingsCache.set(booking.organization_id, settings);
      }

      const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
      const manageLink = `${appUrl}/book/manage/${createManageToken(booking.id)}`;

      const email = shootReminderEmail({
        contactName:
          booking.profiles.full_name ?? booking.profiles.email,
        streetAddress: booking.properties.street_address,
        city: booking.properties.city,
        timeLabel,
        manageLink,
        companyName: settings.organizationName,
      });

      const result = await sendEmail({
        to: booking.profiles.email,
        subject: email.subject,
        html: email.html,
        organizationId: booking.organization_id,
      });

      if (!result.ok || result.skipped) {
        // skipped = Resend not configured; leave the stamp null so the
        // reminder goes out once email is wired up.
        if (result.skipped) skipped += 1;
        else failed += 1;
        if (!result.ok) {
          console.warn(
            "[reminders] send failed for booking",
            booking.id,
            result.error,
          );
        }
        continue;
      }

      const { error: stampError } = await supabase
        .from("bookings")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id);
      if (stampError) {
        // Email went out but the stamp didn't stick — count it sent, warn
        // loudly so a re-send tomorrow isn't a silent mystery.
        console.warn(
          "[reminders] sent but could not stamp reminder_sent_at for booking",
          booking.id,
          stampError,
        );
      }
      sent += 1;
    } catch (err) {
      failed += 1;
      console.warn("[reminders] reminder failed for booking", booking.id, err);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, failed });
}

/**
 * UTC range covering TOMORROW's calendar date in the business timezone:
 * [tomorrow 00:00 BUSINESS_TZ, day-after 00:00 BUSINESS_TZ).
 *
 * Built from Intl date parts + businessDateTimeLocalToUtc so DST shifts
 * are handled by the same offset math the booking flow already uses —
 * no hand-rolled UTC-4/UTC-5 constants.
 */
function tomorrowBusinessDayUtcRange(now = new Date()): {
  start: Date;
  end: Date;
} {
  // Today's calendar date as seen in the business timezone.
  const todayLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // "YYYY-MM-DD"
  const [year, month, day] = todayLocal.split("-").map(Number);

  // Date.UTC normalizes day/month rollover for us (e.g. Dec 31 + 1).
  const dateOnly = (daysAhead: number) =>
    new Date(Date.UTC(year, month - 1, day + daysAhead))
      .toISOString()
      .slice(0, 10);

  const start = businessDateTimeLocalToUtc(`${dateOnly(1)}T00:00`);
  const end = businessDateTimeLocalToUtc(`${dateOnly(2)}T00:00`);
  if (!start || !end) {
    // Unreachable — the strings above always match the expected format —
    // but keeps the return type honest without a non-null assertion.
    throw new Error("Could not compute tomorrow's business-day range.");
  }
  return { start, end };
}
