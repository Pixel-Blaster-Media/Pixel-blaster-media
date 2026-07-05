import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { requireAdmin } from "@/lib/auth/require-admin";
import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import {
  BUSINESS_TZ,
  businessDateTimeLocalToUtc,
} from "@/lib/booking/availability";
import { getActiveCatalog } from "@/lib/booking/catalog";
import {
  labelForService,
  totalDurationMinutes,
} from "@/lib/booking/services";
import {
  getGoogleCalendarClients,
  getGoogleCalendarSources,
  type GoogleCalendarSource,
  type GoogleCalendarEvent,
} from "@/lib/integrations/google-calendar/client";
import { getServerSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

import CalendarWeekView from "./CalendarWeekView";
import { updateCalendarSourcePreferences } from "./actions";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

const CALENDAR_DAY_START_HOUR = 7;

interface BookingRow {
  id: string;
  status: BookingStatus;
  scheduled_at: string;
  scheduled_ends_at: string | null;
  google_calendar_event_id: string | null;
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
  kind: "booking" | "block" | "google";
  title: string;
  subtitle: string;
  startsAt: string;
  endsAt: string;
  localDate: string;
  href?: string;
  statusLabel?: string;
  statusClass?: string;
  sourceName?: string;
  sourceColor?: string;
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
        "id, status, scheduled_at, scheduled_ends_at, google_calendar_event_id, services, add_ons, properties(street_address), profiles(full_name, email)",
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
  const calendarSources = await getGoogleCalendarSources({
    organizationId: admin.organizationId,
  });
  const googleEvents = await fetchGoogleEventsBestEffort({
    organizationId: admin.organizationId,
    from: rangeStart,
    to: rangeEnd,
  });
  const googleEventsById = new Map(
    googleEvents
      .filter((event) => event.writeBookings)
      .map((event) => [event.id, event]),
  );
  const bookingGoogleEventIds = new Set<string>();

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
    if (booking.google_calendar_event_id) {
      bookingGoogleEventIds.add(booking.google_calendar_event_id);
    }
    const linkedGoogleEvent = booking.google_calendar_event_id
      ? googleEventsById.get(booking.google_calendar_event_id)
      : null;
    const startsAt = linkedGoogleEvent?.start ?? new Date(booking.scheduled_at);
    const localDate = localDateKey(startsAt);
    if (!weekKeys.has(localDate)) continue;
    const minutes = Math.max(
      totalDurationMinutes(booking.services, booking.add_ons),
      60,
    );
    const endsAt =
      linkedGoogleEvent?.end ??
      (booking.scheduled_ends_at
        ? new Date(booking.scheduled_ends_at)
        : new Date(startsAt.getTime() + minutes * 60_000));
    const meta = BOOKING_STATUSES[booking.status];
    const dbStartsAt = new Date(booking.scheduled_at);
    items.push({
      id: booking.id,
      kind: "booking",
      title: booking.properties?.street_address ?? "Shoot",
      subtitle: [
        booking.profiles?.full_name ?? booking.profiles?.email ?? "Unknown",
        booking.services.map(labelForService).join(", "),
        linkedGoogleEvent && linkedGoogleEvent.start.getTime() !== dbStartsAt.getTime()
          ? "Google Calendar time"
          : null,
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

  for (const event of googleEvents) {
    if (bookingGoogleEventIds.has(event.id)) continue;

    const startsAt = event.allDay
      ? localDisplayTimeForDateOnly(event.start, CALENDAR_DAY_START_HOUR)
      : event.start;
    const endsAt = event.allDay
      ? localDisplayTimeForDateOnly(event.start, CALENDAR_DAY_START_HOUR + 1)
      : event.end;
    const localDate = localDateKey(startsAt);
    if (!weekKeys.has(localDate)) continue;

    items.push({
      id: `${event.sourceId}:${event.id}`,
      kind: "google",
      title: event.summary,
      subtitle: [
        event.location,
        event.allDay ? "All-day" : event.sourceName,
      ]
        .filter(Boolean)
        .join(" · "),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      localDate,
      href: event.htmlLink,
      sourceName: event.sourceName,
      sourceColor: event.sourceColor,
      statusLabel: event.sourceName,
      statusClass: "border-sky-200 bg-sky-100 text-sky-800",
    });
  }
  const visibleItems = filterCalendarItems(items, search);
  const appointmentCount = visibleItems.filter((item) => item.kind === "booking")
    .length;

  return (
    <div className="max-w-full space-y-3 px-0.5">
      <header className="rounded-xl border border-realtor-primary/15 bg-realtor-surface/85 p-3 shadow-lg shadow-realtor-text/10">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-xl font-bold text-realtor-text md:text-2xl">
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

      <section className="sticky top-2 z-20 rounded-xl border border-realtor-primary/15 bg-realtor-surface/95 p-2 shadow-lg shadow-realtor-text/10 backdrop-blur md:static">
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
            className="flex min-w-0 gap-2 lg:min-w-[420px]"
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
              className="min-h-10 min-w-0 flex-1 rounded-full border border-realtor-primary/15 bg-white px-4 text-sm text-realtor-text outline-none transition placeholder:text-realtor-muted/70 focus:border-realtor-primary/45 focus:ring-2 focus:ring-realtor-primary/10"
            />
            <div className="flex shrink-0 gap-2">
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

      <div className="grid min-h-0 max-w-full gap-3 md:grid-cols-[280px_minmax(0,1fr)]">
        <CalendarSidebar
          sources={calendarSources}
          weekStart={weekStart}
          todayKey={todayKey}
          visibleItems={visibleItems}
        />
        <CalendarWeekView
          days={days}
          items={visibleItems}
          catalogItems={catalogToOptions(catalog)}
        />
      </div>
    </div>
  );
}

function CalendarSidebar({
  sources,
  weekStart,
  todayKey,
  visibleItems,
}: {
  sources: GoogleCalendarSource[];
  weekStart: string;
  todayKey: string;
  visibleItems: CalendarItem[];
}) {
  const monthDate = dateFromKey(weekStart);
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(monthDate);
  const monthGrid = buildMonthGrid(weekStart);
  const bookingItems = visibleItems.filter((item) => item.kind === "booking");
  const blockItems = visibleItems.filter((item) => item.kind === "block");

  return (
    <aside className="hidden min-h-[calc(100dvh-190px)] rounded-xl border border-realtor-primary/15 bg-realtor-surface/90 p-3 shadow-lg shadow-realtor-text/10 md:flex md:flex-col">
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary/80">
          Calendars
        </p>
        <div className="mt-3 space-y-2">
          <CalendarSourceSummary
            label="Pixel Blaster shoots"
            color="#3f7356"
            items={bookingItems}
            detail="Bookings created in Pixel Blaster"
            defaultOpen
          />
          <CalendarSourceSummary
            label="Manual blocks"
            color="#a69d8d"
            items={blockItems}
            detail="Private blocked/off time"
          />
          {sources.map((source) => {
            const sourceItems = visibleItems.filter(
              (item) =>
                item.kind === "google" && item.id.startsWith(`${source.id}:`),
            );
            return (
              <CalendarSourceSummary
                key={source.id}
                label={source.displayName}
                color={source.sourceColor}
                items={sourceItems}
                detail={
                  source.writeBookings ? "Booking calendar" : source.calendarId
                }
                form={
                  <form action={updateCalendarSourcePreferences} className="flex items-center gap-2">
                    <input type="hidden" name="source_id" value={source.id} />
                    <input
                      aria-label={`${source.displayName} colour`}
                      type="color"
                      name="source_color"
                      defaultValue={source.sourceColor}
                      className="h-7 w-7 shrink-0 cursor-pointer rounded border border-realtor-primary/15 bg-transparent p-0"
                    />
                    <button
                      type="submit"
                      className="rounded-full border border-realtor-primary/15 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-realtor-primary transition hover:border-realtor-primary/35 hover:bg-realtor-primary/5"
                    >
                      Save
                    </button>
                  </form>
                }
              />
            );
          })}
        </div>
      </section>

      <section className="mt-auto pt-4">
        <div className="rounded-xl border border-realtor-primary/10 bg-white/65 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-realtor-text">
              {monthLabel}
            </p>
            <Link
              href={calendarHref()}
              className="text-[11px] font-semibold text-realtor-primary"
            >
              Today
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-realtor-muted">
            {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1 text-center text-[11px]">
            {monthGrid.map((day) => (
              <Link
                key={day.key}
                href={calendarHref({ week: startOfWeekKey(day.key) })}
                className={`rounded-full px-1.5 py-1 transition ${
                  day.key === todayKey
                    ? "bg-realtor-primary text-white"
                    : day.inMonth
                      ? "text-realtor-text hover:bg-realtor-primary/10"
                      : "text-realtor-muted/40 hover:bg-realtor-primary/5"
                }`}
              >
                {day.day}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </aside>
  );
}

function CalendarSourceSummary({
  label,
  color,
  items,
  detail,
  form,
  defaultOpen = false,
}: {
  label: string;
  color: string;
  items: CalendarItem[];
  detail: string;
  form?: ReactNode;
  defaultOpen?: boolean;
}) {
  const sortedItems = [...items].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  return (
    <details
      className="group rounded-lg border border-realtor-primary/10 bg-white/60 p-2 text-xs"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-start gap-2">
        <span
          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border border-black/10"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-realtor-text">
            {label}
          </span>
          <span className="block truncate text-[11px] text-realtor-muted">
            {items.length} item{items.length === 1 ? "" : "s"} this week
          </span>
        </span>
        <span className="shrink-0 text-realtor-muted transition group-open:rotate-90">
          &gt;
        </span>
      </summary>
      <div className="mt-2 border-t border-realtor-primary/10 pt-2">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] text-realtor-muted">
            {detail}
          </p>
          {form}
        </div>
        <div className="mt-2 space-y-1.5">
          {sortedItems.length > 0 ? (
            sortedItems.slice(0, 5).map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                className="rounded-md bg-realtor-surface/75 px-2 py-1.5"
              >
                <p className="truncate font-semibold text-realtor-text">
                  {item.title}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-realtor-muted">
                  {formatSummaryTime(item)}
                </p>
              </div>
            ))
          ) : (
            <p className="rounded-md bg-realtor-surface/75 px-2 py-1.5 text-[11px] text-realtor-muted">
              Nothing visible this week.
            </p>
          )}
          {sortedItems.length > 5 ? (
            <p className="px-2 text-[11px] font-semibold text-realtor-primary">
              +{sortedItems.length - 5} more
            </p>
          ) : null}
        </div>
      </div>
    </details>
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

function buildMonthGrid(activeKey: string): Array<{
  key: string;
  day: number;
  inMonth: boolean;
}> {
  const activeDate = dateFromKey(activeKey);
  const firstOfMonth = new Date(
    Date.UTC(activeDate.getUTCFullYear(), activeDate.getUTCMonth(), 1),
  );
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());

  return Array.from({ length: 42 }).map((_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return {
      key: keyFromDate(date),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === activeDate.getUTCMonth(),
    };
  });
}

function calendarHref({
  week,
  q,
}: {
  week?: string;
  q?: string;
} = {}): string {
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

function formatSummaryTime(item: CalendarItem): string {
  const start = new Date(item.startsAt);
  const end = new Date(item.endsAt);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    weekday: "short",
  }).format(start);
  const startTime = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
  const endTime = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(end);

  return `${day} ${startTime}-${endTime}`;
}

async function fetchGoogleEventsBestEffort({
  organizationId,
  from,
  to,
}: {
  organizationId: string;
  from: Date;
  to: Date;
}): Promise<
  Array<
    GoogleCalendarEvent & {
      sourceId: number;
      sourceName: string;
      sourceColor: string;
      writeBookings: boolean;
    }
  >
> {
  try {
    const clients = await getGoogleCalendarClients({
      organizationId,
      showOnAdminCalendar: true,
    });
    const eventGroups = await Promise.all(
      clients.map(async (client) => {
        const events = await client.getEvents(from, to);
        return events.map((event) => ({
          ...event,
          sourceId: client.connectionId,
          sourceName: client.displayName,
          sourceColor: client.sourceColor,
          writeBookings: client.writeBookings,
        }));
      }),
    );
    return eventGroups.flat();
  } catch (err) {
    console.warn("[admin-calendar] google events fetch failed", err);
    return [];
  }
}

function localDisplayTimeForDateOnly(date: Date, hour: number): Date {
  const key = keyFromDate(date);
  return (
    businessDateTimeLocalToUtc(
      `${key}T${String(hour).padStart(2, "0")}:00`,
    ) ?? date
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
