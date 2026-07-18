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
  labelForAddOn,
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
  square_footage: number | null;
  unit_number: string | null;
  is_vacant: "vacant" | "occupied" | "partial" | null;
  include_basement: boolean | null;
  client_notes: string | null;
  internal_notes: string | null;
  properties: {
    street_address: string;
    city: string | null;
    province: string | null;
    postal_code: string | null;
    notes: string | null;
  } | null;
  profiles: {
    full_name: string | null;
    email: string;
    phone: string | null;
    brokerage: string | null;
    internal_notes: string | null;
  } | null;
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
  syncWarning?: string;
  sourceName?: string;
  sourceColor?: string;
  bookingDetails?: {
    fullAddress: string;
    services: string[];
    addOns: string[];
    realtorName: string;
    realtorEmail: string;
    realtorPhone: string | null;
    brokerage: string | null;
    realtorNotes: string | null;
    clientNotes: string | null;
    internalNotes: string | null;
    propertyNotes: string | null;
    squareFootage: number | null;
    occupancy: string | null;
    includeBasement: boolean | null;
  };
}

type DisplayGoogleEvent = GoogleCalendarEvent & {
  sourceId: number;
  sourceName: string;
  sourceColor: string;
  writeBookings: boolean;
};

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
        "id, status, scheduled_at, scheduled_ends_at, google_calendar_event_id, services, add_ons, square_footage, unit_number, is_vacant, include_basement, client_notes, internal_notes, properties(street_address, city, province, postal_code, notes), profiles(full_name, email, phone, brokerage, internal_notes)",
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
  const databaseLoadFailed = Boolean(
    bookingsRes.error || blocksRes.error || hoursRes.error,
  );
  if (databaseLoadFailed) {
    console.error("[admin-calendar] database load failed", {
      bookings: bookingsRes.error?.message,
      blocks: blocksRes.error?.message,
      hours: hoursRes.error?.message,
    });
  }
  const calendarSources = await getGoogleCalendarSources({
    organizationId: admin.organizationId,
  });
  const googleResult = await fetchGoogleEventsBestEffort({
    organizationId: admin.organizationId,
    from: rangeStart,
    to: rangeEnd,
  });
  const googleEvents = googleResult.events;
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
    // The booking row is the schedule's source of truth. A stale Google event
    // must never move a booking into another week or make it disappear from
    // this calendar; we surface drift as a warning instead.
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
    const services = booking.services.map(labelForService);
    const addOns = booking.add_ons.map(labelForAddOn);
    const realtorName =
      booking.profiles?.full_name ?? booking.profiles?.email ?? "Unknown";
    const fullAddress = [
      booking.properties?.street_address,
      booking.unit_number ? `Unit ${booking.unit_number}` : null,
      booking.properties?.city,
      booking.properties?.province,
      booking.properties?.postal_code,
    ]
      .filter(Boolean)
      .join(", ");
    const occupancy =
      booking.is_vacant === "vacant"
        ? "Vacant"
        : booking.is_vacant === "partial"
          ? "Partially occupied"
          : booking.is_vacant === "occupied"
            ? "Occupied"
            : null;
    const googleOutOfSync = Boolean(
      linkedGoogleEvent &&
        (linkedGoogleEvent.start.getTime() !== startsAt.getTime() ||
          linkedGoogleEvent.end.getTime() !== endsAt.getTime()),
    );
    items.push({
      id: booking.id,
      kind: "booking",
      title: booking.properties?.street_address ?? "Shoot",
      subtitle: [
        realtorName,
        services.join(", "),
        googleOutOfSync
          ? "Google Calendar out of sync"
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      localDate,
      href: `/admin/bookings/${booking.id}`,
      statusLabel: meta.label,
      statusClass: calendarStatusPill(booking.status),
      syncWarning: googleOutOfSync
        ? "Google Calendar out of sync"
        : undefined,
      bookingDetails: {
        fullAddress,
        services,
        addOns,
        realtorName,
        realtorEmail: booking.profiles?.email ?? "",
        realtorPhone: booking.profiles?.phone ?? null,
        brokerage: booking.profiles?.brokerage ?? null,
        realtorNotes: booking.profiles?.internal_notes ?? null,
        clientNotes: booking.client_notes,
        internalNotes: booking.internal_notes,
        propertyNotes: booking.properties?.notes ?? null,
        squareFootage: booking.square_footage,
        occupancy,
        includeBasement: booking.include_basement,
      },
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
    <div className="max-w-full space-y-4 px-0.5">
      <header className="px-1 py-1 md:py-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-realtor-primary/75 md:text-xs">
          Schedule
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline justify-between gap-2 md:hidden">
              <h1 className="shrink-0 whitespace-nowrap text-[clamp(1.25rem,6vw,1.5rem)] font-bold tracking-tight text-realtor-text">
                Calendar
              </h1>
              <p
                data-calendar-week-summary
                aria-label={`${formatWeekRange(weekStart)} · ${appointmentCount} appointment${appointmentCount === 1 ? "" : "s"}`}
                className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-right text-[clamp(11px,3vw,14px)] leading-none tracking-[-0.015em] text-realtor-muted"
              >
                {formatCompactWeekRange(weekStart)} · {appointmentCount} appt
                {appointmentCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="hidden flex-wrap items-center gap-2 md:flex">
              <h1 className="text-3xl font-bold tracking-tight text-realtor-text">
                {formatWeekRange(weekStart)}
              </h1>
              {isCurrentWeek ? (
                <span className="rounded-full bg-realtor-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-realtor-primary">
                  Current week
                </span>
              ) : null}
            </div>
            <p className="mt-1 hidden text-sm text-realtor-muted md:block">
              {appointmentCount} appointment{appointmentCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </header>

      {databaseLoadFailed || googleResult.hadError ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-700/30 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm"
        >
          <p className="font-semibold">Calendar data needs attention.</p>
          <p className="mt-1 leading-5">
            {databaseLoadFailed
              ? "Some booking or availability data could not be loaded. Refresh before relying on this schedule."
              : "One Google Calendar could not be loaded. Pixel Blaster bookings are still shown from the booking database."}
          </p>
        </div>
      ) : null}

      <div className="min-h-0 max-w-full">
        <CalendarWeekView
          days={days}
          items={visibleItems}
          catalogItems={catalogToOptions(catalog)}
          navigation={{
            previousHref: calendarHref({ week: prevWeek, q: search }),
            todayHref: calendarHref({ q: search }),
            nextHref: calendarHref({ week: nextWeek, q: search }),
            search,
            weekValue: params.week ? weekStart : null,
            clearSearchHref: search
              ? calendarHref({ week: params.week ? weekStart : undefined })
              : null,
          }}
          calendarMenu={
            <CalendarSidebar
              sources={calendarSources}
              weekStart={weekStart}
              todayKey={todayKey}
              visibleItems={visibleItems}
            />
          }
        />
      </div>
    </div>
  );
}

function calendarStatusPill(status: BookingStatus): string {
  switch (status) {
    case "requested":
      return "border-realtor-accent/40 bg-realtor-accent/15 text-realtor-text";
    case "shot":
      return "border-sky-700/20 bg-sky-50 text-sky-900";
    case "editing":
      return "border-amber-700/20 bg-amber-50 text-amber-900";
    case "delivered":
      return "border-realtor-muted/20 bg-realtor-soft text-realtor-text";
    case "cancelled":
      return "border-red-700/20 bg-red-50 text-red-800";
    default:
      return "border-realtor-primary/25 bg-realtor-primary/10 text-realtor-primary";
  }
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
    <aside className="flex flex-col p-3">
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary/80">
          Calendars
        </p>
        <div className="mt-3 space-y-2">
          <CalendarSourceSummary
            label="Bookings"
            color="#3f7356"
            items={bookingItems}
            detail="Bookings created in this workspace"
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
}): Promise<{ events: DisplayGoogleEvent[]; hadError: boolean }> {
  try {
    const clients = await getGoogleCalendarClients({
      organizationId,
      showOnAdminCalendar: true,
    });
    const settledGroups = await Promise.allSettled(
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
    const events: DisplayGoogleEvent[] = [];
    let hadError = false;
    for (const group of settledGroups) {
      if (group.status === "fulfilled") {
        events.push(...group.value);
      } else {
        hadError = true;
        console.warn(
          "[admin-calendar] google calendar source failed",
          group.reason,
        );
      }
    }
    return { events, hadError };
  } catch (err) {
    console.warn("[admin-calendar] google events fetch failed", err);
    return { events: [], hadError: true };
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

function formatWeekRange(key: string): string {
  const start = dateFromKey(key);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
  });
  const startMonth = month.format(start);
  const endMonth = month.format(end);
  const year = end.getUTCFullYear();

  return startMonth === endMonth
    ? `${startMonth} ${start.getUTCDate()}-${end.getUTCDate()}, ${year}`
    : `${startMonth} ${start.getUTCDate()}-${endMonth} ${end.getUTCDate()}, ${year}`;
}

function formatCompactWeekRange(key: string): string {
  const start = dateFromKey(key);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
  });
  const startMonth = month.format(start);
  const endMonth = month.format(end);
  const year = end.getUTCFullYear();

  return startMonth === endMonth
    ? `${startMonth} ${start.getUTCDate()}–${end.getUTCDate()}, ${year}`
    : `${startMonth} ${start.getUTCDate()}–${endMonth} ${end.getUTCDate()}, ${year}`;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}
