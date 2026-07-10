import "server-only";

import { getGoogleCalendarClients } from "@/lib/integrations/google-calendar/client";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";
import { totalDurationMinutes } from "./services";

/**
 * Slot computation for the private calendar.
 *
 * Inputs (all server-side, realtors never see the raw data):
 *   - business_hours  — weekly working windows
 *   - calendar_blocks — ad-hoc busy periods (vacation, personal appts)
 *   - bookings        — everything not cancelled counts as busy
 *
 * Output: an array of { start, end } ISO timestamps representing when the
 * photographer is free for a shoot of the given duration. The UI turns
 * these into clickable buttons.
 *
 * Deliberately simple — no cross-day shoots, no recurring blocks, no
 * timezone gymnastics. The business runs in a single timezone
 * (`BUSINESS_TZ`) and the caller is responsible for converting to the
 * viewer's local zone for display.
 */

/** The business operates in this timezone. Shoot times are stored in UTC
 *  in Postgres but `business_hours.start_time` / `end_time` are wall-clock
 *  times in this zone. */
export const BUSINESS_TZ = "America/Toronto";

/** Granularity of slot offsets — e.g. 30 means slots start every :00 and :30. */
const SLOT_STEP_MINUTES = 30;

export interface Slot {
  /** ISO UTC, inclusive */
  start: string;
  /** ISO UTC, exclusive */
  end: string;
}

export interface AvailabilityScope {
  organizationId?: string;
  /** Ignore the booking's own linked Google event during rescheduling. */
  excludeGoogleEventId?: string;
}

function availabilityOrganizationId(scope?: AvailabilityScope): string {
  return scope?.organizationId ?? DEFAULT_ORGANIZATION_ID;
}

interface BusinessHoursRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
}

interface CalendarBlockRow {
  starts_at: string;
  ends_at: string;
}

interface BookingRow {
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  services: string[];
  add_ons: string[];
  status: string;
}

/**
 * Return the list of open slots for a shoot of `durationMinutes`, scanning
 * from `from` (inclusive) to `to` (exclusive).
 *
 * Caller passes UTC timestamps. Slot boundaries are snapped to the
 * business timezone's wall clock so a "9am–5pm" window is actually
 * 9am–5pm local regardless of DST.
 */
export async function listAvailableSlots({
  from,
  to,
  durationMinutes,
  organizationId,
  excludeBookingId,
  excludeGoogleEventId,
}: {
  from: Date;
  to: Date;
  durationMinutes: number;
  organizationId?: string;
  /** Ignore this booking's own time when computing busy windows —
   *  used when rescheduling so a shoot doesn't block itself. */
  excludeBookingId?: string;
  excludeGoogleEventId?: string;
}): Promise<Slot[]> {
  if (durationMinutes <= 0) return [];

  const supabase = getServiceSupabase();
  const orgId = availabilityOrganizationId({ organizationId });

  let bookingsQuery = supabase
    .from("bookings")
    .select("scheduled_at, scheduled_ends_at, services, add_ons, status")
    .eq("organization_id", orgId)
    .in("status", ["requested", "confirmed", "shot", "editing", "delivered"])
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", addMinutes(from, -6 * 60).toISOString())
    .lt("scheduled_at", to.toISOString());
  if (excludeBookingId) {
    bookingsQuery = bookingsQuery.neq("id", excludeBookingId);
  }

  // Pull the three inputs in parallel. These are all small datasets so we
  // can afford to fetch the full rows; the filtering happens in memory.
  const [hoursRes, blocksRes, bookingsRes, googleBusy] = await Promise.all([
    supabase
      .from("business_hours")
      .select("day_of_week, start_time, end_time, enabled")
      .eq("organization_id", orgId)
      .returns<BusinessHoursRow[]>(),
    supabase
      .from("calendar_blocks")
      .select("starts_at, ends_at")
      .eq("organization_id", orgId)
      .lte("starts_at", to.toISOString())
      .gte("ends_at", from.toISOString())
      .returns<CalendarBlockRow[]>(),
    bookingsQuery.returns<BookingRow[]>(),
    // Optional Google Calendar free/busy union. If no calendar is
    // connected, returns [] so slot computation is unaffected.
    fetchGoogleBusy(from, to, {
      organizationId: orgId,
      excludeGoogleEventId,
    }),
  ]);

  const hoursByDow = new Map<number, BusinessHoursRow>();
  for (const row of hoursRes.data ?? []) {
    if (row.enabled) hoursByDow.set(row.day_of_week, row);
  }

  const busy: { start: Date; end: Date }[] = [];
  for (const b of blocksRes.data ?? []) {
    busy.push({ start: new Date(b.starts_at), end: new Date(b.ends_at) });
  }
  for (const booking of bookingsRes.data ?? []) {
    if (!booking.scheduled_at) continue;
    const start = new Date(booking.scheduled_at);
    const end = booking.scheduled_ends_at
      ? new Date(booking.scheduled_ends_at)
      : addMinutes(start, durationOfBooking(booking.services, booking.add_ons));
    busy.push({ start, end });
  }
  // Google Calendar busy windows — doctor appointments, personal stuff,
  // anything the admin already has on their personal calendar.
  for (const g of googleBusy) {
    busy.push({ start: g.start, end: g.end });
  }

  const slots: Slot[] = [];

  // Iterate one business-tz day at a time.
  const day = startOfLocalDay(from);
  const cutoff = to.getTime();
  while (day.getTime() < cutoff) {
    const dow = localDayOfWeek(day);
    const hours = hoursByDow.get(dow);
    if (hours) {
      const windowStart = localTimeOnDate(day, hours.start_time);
      const windowEnd = localTimeOnDate(day, hours.end_time);

      // Snap the cursor to the first slot step that's >= max(window, from).
      let cursor = new Date(Math.max(windowStart.getTime(), from.getTime()));
      cursor = snapToStep(cursor, SLOT_STEP_MINUTES, "up");

      while (true) {
        const slotEnd = addMinutes(cursor, durationMinutes);
        if (slotEnd.getTime() > windowEnd.getTime()) break;
        if (slotEnd.getTime() > cutoff) break;

        if (!overlapsAny(cursor, slotEnd, busy)) {
          slots.push({
            start: cursor.toISOString(),
            end: slotEnd.toISOString(),
          });
        }
        cursor = addMinutes(cursor, SLOT_STEP_MINUTES);
      }
    }
    // advance one local day
    day.setUTCDate(day.getUTCDate() + 1);
  }

  return slots;
}

/**
 * Pre-flight check called by the booking action — re-verifies that the
 * chosen slot is still free at the moment of submission, since the
 * realtor's browser might be showing data that's a few seconds stale.
 */
export async function isSlotAvailable(
  start: Date,
  durationMinutes: number,
  scope?: AvailabilityScope & { excludeBookingId?: string },
): Promise<boolean> {
  const slots = await listAvailableSlots({
    from: addMinutes(start, -1),
    to: addMinutes(start, durationMinutes + 1),
    durationMinutes,
    organizationId: scope?.organizationId,
    excludeBookingId: scope?.excludeBookingId,
    excludeGoogleEventId: scope?.excludeGoogleEventId,
  });
  return slots.some((s) => new Date(s.start).getTime() === start.getTime());
}

export function businessDateTimeLocalToUtc(value: string): Date | null {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
    return null;
  }

  const withSeconds = normalized.length === 16 ? `${normalized}:00` : normalized;
  const date = localToUtc(withSeconds);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---- Google Calendar free/busy ----

/**
 * Best-effort fetch of the admin's Google Calendar busy windows.
 * If no calendar is connected or the API errors, we return [] so slot
 * computation falls back to DB-only busy. Better to risk a double-book
 * than to crash the entire booking form when Google is down.
 */
async function fetchGoogleBusy(
  from: Date,
  to: Date,
  scope?: AvailabilityScope,
): Promise<{ start: Date; end: Date }[]> {
  try {
    const clients = await getGoogleCalendarClients({
      organizationId: scope?.organizationId,
      blockAvailability: true,
    });
    const windows = await Promise.all(
      clients.map(async (client) => {
        if (scope?.excludeGoogleEventId) {
          const events = await client.getEvents(from, to);
          return events
            .filter(
              (event) =>
                event.id !== scope.excludeGoogleEventId && !event.transparent,
            )
            .map((event) => ({ start: event.start, end: event.end }));
        }
        return client.getBusy(from, to);
      }),
    );
    return windows.flat();
  } catch (err) {
    console.warn("[availability] google freeBusy failed", err);
    return [];
  }
}

// ---- Duration + time helpers (small + local so callers don't need dayjs) ----

function durationOfBooking(
  services: string[],
  addOns: string[],
): number {
  const base = totalDurationMinutes(services, addOns);
  // Safety floor — unknown services still occupy at least 60 min.
  return Math.max(base, 60);
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

function snapToStep(d: Date, stepMinutes: number, dir: "up" | "down"): Date {
  const ms = stepMinutes * 60_000;
  const t = d.getTime();
  return new Date(
    dir === "up" ? Math.ceil(t / ms) * ms : Math.floor(t / ms) * ms,
  );
}

function overlapsAny(
  start: Date,
  end: Date,
  ranges: { start: Date; end: Date }[],
): boolean {
  return ranges.some((r) => r.start < end && r.end > start);
}

/**
 * Return a Date representing midnight (00:00) of the business-timezone
 * day that contains `d`. We use the Intl API to avoid pulling in a
 * timezone library for this one-off conversion.
 */
function startOfLocalDay(d: Date): Date {
  const parts = tzParts(d);
  const iso = `${parts.year}-${parts.month}-${parts.day}T00:00:00`;
  return localToUtc(iso);
}

function localDayOfWeek(localMidnightUtc: Date): number {
  // Ask Intl for the weekday in the business timezone.
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    weekday: "short",
  }).format(localMidnightUtc);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday] ?? 0;
}

function localTimeOnDate(localMidnightUtc: Date, hhmmss: string): Date {
  const parts = tzParts(localMidnightUtc);
  const iso = `${parts.year}-${parts.month}-${parts.day}T${hhmmss}`;
  return localToUtc(iso);
}

interface DateParts {
  year: string;
  month: string;
  day: string;
}

function tzParts(d: Date): DateParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Convert "YYYY-MM-DDThh:mm:ss" interpreted in BUSINESS_TZ to a UTC Date.
 *
 * We iteratively compare the desired wall clock with the wall clock produced
 * by Intl. A single offset pass is not enough on the day DST changes because
 * the first guess can be on the opposite side of the transition.
 */
function localToUtc(isoNaive: string): Date {
  const naiveUtc = new Date(`${isoNaive}Z`);
  if (Number.isNaN(naiveUtc.getTime())) return new Date(Number.NaN);

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const desiredWallClock = naiveUtc.getTime();
  let candidate = desiredWallClock;

  for (let attempt = 0; attempt < 4; attempt++) {
    const actualWallClock = wallClockAsUtc(fmt, new Date(candidate));
    const adjustment = desiredWallClock - actualWallClock;
    if (adjustment === 0) return new Date(candidate);
    candidate += adjustment;
  }

  // A local time inside the skipped spring-forward hour does not exist.
  return wallClockAsUtc(fmt, new Date(candidate)) === desiredWallClock
    ? new Date(candidate)
    : new Date(Number.NaN);
}

function wallClockAsUtc(fmt: Intl.DateTimeFormat, instant: Date): number {
  const parts = fmt.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
}
