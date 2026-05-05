import Link from "next/link";
import type { Metadata } from "next";

import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import { BUSINESS_TZ } from "@/lib/booking/availability";
import {
  labelForService,
  totalDurationMinutes,
} from "@/lib/booking/services";
import { getServerSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

import CalendarWeekView from "./CalendarWeekView";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

interface BookingRow {
  id: string;
  status: BookingStatus;
  scheduled_at: string;
  scheduled_ends_at: string | null;
  services: string[];
  add_ons: string[];
  properties: { street_address: string } | null;
  profiles: { full_name: string | null; email: string } | null;
}

interface BlockRow {
  id: string;
  starts_at: string;
  ends_at: string;
  label: string | null;
}

interface CalendarItem {
  id: string;
  kind: "booking" | "block";
  title: string;
  subtitle: string;
  startsAt: string;
  endsAt: string;
  localDate: string;
  href?: string;
  statusLabel?: string;
  statusClass?: string;
}

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const todayKey = localDateKey(new Date());
  const weekStart = startOfWeekKey(params.week ?? todayKey);
  const weekEnd = addDaysKey(weekStart, 7);
  const prevWeek = addDaysKey(weekStart, -7);
  const nextWeek = addDaysKey(weekStart, 7);

  const rangeStart = broadUtcDate(weekStart, -1);
  const rangeEnd = broadUtcDate(weekEnd, 1);

  const supabase = getServerSupabase();
  const [bookingsRes, blocksRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, status, scheduled_at, scheduled_ends_at, services, add_ons, properties(street_address), profiles(full_name, email)",
      )
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", rangeStart.toISOString())
      .lt("scheduled_at", rangeEnd.toISOString())
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true })
      .returns<BookingRow[]>(),
    supabase
      .from("calendar_blocks")
      .select("id, starts_at, ends_at, label")
      .gte("ends_at", rangeStart.toISOString())
      .lt("starts_at", rangeEnd.toISOString())
      .order("starts_at")
      .returns<BlockRow[]>(),
  ]);

  const days = Array.from({ length: 7 }).map((_, i) => {
    const key = addDaysKey(weekStart, i);
    const date = dateFromKey(key);
    return {
      key,
      dateInput: key,
      label: new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
      }).format(date),
      shortLabel: new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "short",
      }).format(date),
    };
  });
  const weekKeys = new Set(days.map((day) => day.key));

  const items: CalendarItem[] = [];
  for (const booking of bookingsRes.data ?? []) {
    const startsAt = new Date(booking.scheduled_at);
    const localDate = localDateKey(startsAt);
    if (!weekKeys.has(localDate)) continue;
    const minutes = Math.max(
      totalDurationMinutes(booking.services, booking.add_ons),
      60,
    );
    const endsAt = booking.scheduled_ends_at
      ? new Date(booking.scheduled_ends_at)
      : new Date(startsAt.getTime() + minutes * 60_000);
    const meta = BOOKING_STATUSES[booking.status];
    items.push({
      id: booking.id,
      kind: "booking",
      title: booking.properties?.street_address ?? "Shoot",
      subtitle: [
        booking.profiles?.full_name ?? booking.profiles?.email ?? "Unknown",
        booking.services.map(labelForService).join(", "),
      ]
        .filter(Boolean)
        .join(" · "),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      localDate,
      href: `/admin/bookings/${booking.id}`,
      statusLabel: meta.label,
      statusClass: meta.pill,
    });
  }

  for (const block of blocksRes.data ?? []) {
    const startsAt = new Date(block.starts_at);
    const endsAt = new Date(block.ends_at);
    const localDate = localDateKey(startsAt);
    if (!weekKeys.has(localDate)) continue;
    items.push({
      id: block.id,
      kind: "block",
      title: block.label ?? "Busy",
      subtitle: "Private block",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      localDate,
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
            Week of {formatHeaderDate(weekStart)}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">Calendar</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Shoots and private busy blocks in one weekly schedule. Click an
            empty time to block it off.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href={`/admin/calendar?week=${prevWeek}`}
            className="rounded-md border border-white/10 px-3 py-1.5 text-ink-muted hover:border-white/30 hover:text-white"
          >
            Previous
          </Link>
          <Link
            href="/admin/calendar"
            className="rounded-md border border-white/10 px-3 py-1.5 text-ink-muted hover:border-white/30 hover:text-white"
          >
            This week
          </Link>
          <Link
            href={`/admin/calendar?week=${nextWeek}`}
            className="rounded-md border border-white/10 px-3 py-1.5 text-ink-muted hover:border-white/30 hover:text-white"
          >
            Next
          </Link>
          <Link
            href="/admin/settings/availability"
            className="rounded-md border border-white/10 px-3 py-1.5 text-ink-muted hover:border-white/30 hover:text-white"
          >
            Hours + blocks
          </Link>
        </div>
      </header>

      <CalendarWeekView days={days} items={items} />
    </div>
  );
}

function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function startOfWeekKey(key: string): string {
  const date = dateFromKey(key);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - day);
  return keyFromDate(date);
}

function addDaysKey(key: string, days: number): string {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return keyFromDate(date);
}

function dateFromKey(key: string): Date {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : localDateKey(new Date());
  return new Date(`${safe}T00:00:00.000Z`);
}

function keyFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function broadUtcDate(key: string, offsetDays: number): Date {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date;
}

function formatHeaderDate(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dateFromKey(key));
}
