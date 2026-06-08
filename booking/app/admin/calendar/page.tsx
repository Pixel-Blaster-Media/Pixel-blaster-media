import Link from "next/link";
import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/require-admin";
import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import { BUSINESS_TZ } from "@/lib/booking/availability";
import { getActiveCatalog } from "@/lib/booking/catalog";
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

interface BusinessHoursRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
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

interface CatalogItemOption {
  id: string;
  kind: "bundle" | "a_la_carte" | "addon";
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  badge: string | null;
  requireHasVideo: boolean;
}

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; q?: string }>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const todayKey = localDateKey(new Date());
  const weekStart = startOfWeekKey(params.week ?? todayKey);
  const weekEnd = addDaysKey(weekStart, 7);
  const prevWeek = addDaysKey(weekStart, -7);
  const nextWeek = addDaysKey(weekStart, 7);
  const isCurrentWeek = weekStart === startOfWeekKey(todayKey);

  const rangeStart = broadUtcDate(weekStart, -1);
  const rangeEnd = broadUtcDate(weekEnd, 1);

  const supabase = await getServerSupabase();
  const [bookingsRes, blocksRes, hoursRes, catalog] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, status, scheduled_at, scheduled_ends_at, services, add_ons, properties(street_address), profiles(full_name, email)",
      )
      .eq("organization_id", admin.organizationId)
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", rangeStart.toISOString())
      .lt("scheduled_at", rangeEnd.toISOString())
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true })
      .returns<BookingRow[]>(),
    supabase
      .from("calendar_blocks")
      .select("id, starts_at, ends_at, label")
      .eq("organization_id", admin.organizationId)
      .gte("ends_at", rangeStart.toISOString())
      .lt("starts_at", rangeEnd.toISOString())
      .order("starts_at")
      .returns<BlockRow[]>(),
    supabase
      .from("business_hours")
      .select("day_of_week, start_time, end_time, enabled")
      .eq("organization_id", admin.organizationId)
      .returns<BusinessHoursRow[]>(),
    getActiveCatalog({ organizationId: admin.organizationId }),
  ]);

  const hoursByDow = new Map(
    (hoursRes.data ?? []).map((row) => [row.day_of_week, row]),
  );
  const days = Array.from({ length: 7 }).map((_, i) => {
    const key = addDaysKey(weekStart, i);
    const date = dateFromKey(key);
    const dow = date.getUTCDay();
    const hours = hoursByDow.get(dow);
    return {
      key,
      dateInput: key,
      enabled: Boolean(hours?.enabled),
      workStartMinutes: timeToMinutes(hours?.start_time ?? "09:00:00"),
      workEndMinutes: timeToMinutes(hours?.end_time ?? "17:00:00"),
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
  const visibleItems = filterCalendarItems(items, search);
  const appointmentCount = visibleItems.filter((item) => item.kind === "booking")
    .length;

  return (
    <div className="max-w-full space-y-4 overflow-hidden md:space-y-6">
      <header className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-3 shadow-lg shadow-realtor-text/10 md:p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-2xl font-bold text-realtor-text md:text-3xl">
                Week of {formatHeaderDate(weekStart)}
              </h1>
              {isCurrentWeek ? (
                <span className="text-sm font-semibold text-realtor-muted">
                  current week
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm font-semibold text-realtor-muted">
              {appointmentCount} appointment{appointmentCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </header>

      <section className="sticky top-2 z-20 rounded-2xl border border-realtor-primary/15 bg-realtor-surface/95 p-2 shadow-lg shadow-realtor-text/10 backdrop-blur md:static">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <nav className="grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2 text-xs sm:flex sm:w-fit sm:items-center">
            <Link
              href={calendarHref({ week: prevWeek, q: search })}
              aria-label="Previous week"
              className="rounded-full border border-realtor-primary/15 bg-white/45 px-3 py-2 text-center text-lg font-semibold leading-none text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
            >
              &lt;
            </Link>
            <Link
              href={calendarHref({ q: search })}
              className="rounded-full border border-realtor-primary/25 bg-white px-4 py-2 text-center text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/45"
            >
              Today
            </Link>
            <Link
              href={calendarHref({ week: nextWeek, q: search })}
              aria-label="Next week"
              className="rounded-full border border-realtor-primary/15 bg-white/45 px-3 py-2 text-center text-lg font-semibold leading-none text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
            >
              &gt;
            </Link>
          </nav>

          <form
            action="/admin/calendar"
            className="flex flex-col gap-2 sm:flex-row lg:min-w-[420px]"
          >
            {params.week ? (
              <input type="hidden" name="week" value={weekStart} />
            ) : null}
            <label className="sr-only" htmlFor="calendar-search">
              Search calendar
            </label>
            <input
              id="calendar-search"
              name="q"
              defaultValue={search}
              placeholder="Search calendar"
              className="min-h-10 flex-1 rounded-full border border-realtor-primary/15 bg-white px-4 text-sm text-realtor-text outline-none transition placeholder:text-realtor-muted/70 focus:border-realtor-primary/45 focus:ring-2 focus:ring-realtor-primary/10"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="min-h-10 rounded-full bg-realtor-primary px-4 text-sm font-semibold text-white transition hover:bg-realtor-primary/90"
              >
                Search
              </button>
              {search ? (
                <Link
                  href={calendarHref({
                    week: params.week ? weekStart : undefined,
                  })}
                  className="inline-flex min-h-10 items-center rounded-full border border-realtor-primary/15 px-4 text-sm font-semibold text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
                >
                  Clear
                </Link>
              ) : null}
            </div>
          </form>

          <Link
            href="/admin/settings/availability"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-realtor-primary/15 bg-white/55 px-4 text-sm font-semibold text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
          >
            Hours + blocks
          </Link>
        </div>
      </section>

      <CalendarWeekView
        days={days}
        items={visibleItems}
        catalogItems={catalogToOptions(catalog)}
      />
    </div>
  );
}

function catalogToOptions(
  catalog: Awaited<ReturnType<typeof getActiveCatalog>>,
): CatalogItemOption[] {
  return [...catalog.bundles, ...catalog.aLaCarte, ...catalog.addons].map(
    (item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      description: item.description,
      durationMinutes: item.duration_minutes,
      priceCents: item.price_cents,
      badge: item.badge,
      requireHasVideo: item.require_has_video,
    }),
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

function calendarHref({
  week,
  q,
}: {
  week?: string;
  q?: string;
}): string {
  const params = new URLSearchParams();
  if (week) params.set("week", week);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `/admin/calendar?${query}` : "/admin/calendar";
}

function filterCalendarItems(
  items: CalendarItem[],
  search: string,
): CalendarItem[] {
  if (!search) return items;
  const needle = search.toLowerCase();
  return items.filter((item) =>
    [item.title, item.subtitle, item.statusLabel, item.kind]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}

function dateFromKey(key: string): Date {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(key)
    ? key
    : localDateKey(new Date());
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

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}
