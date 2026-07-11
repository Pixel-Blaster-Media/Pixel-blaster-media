import "server-only";

import { BUSINESS_TZ, listAvailableSlots } from "@/lib/booking/availability";

interface OrganizationScope {
  organizationId: string;
}

interface DisplaySlot {
  /** ISO UTC string — what we round-trip through the URL / form. */
  start: string;
  /** "9:00 AM" — displayed to the realtor in BUSINESS_TZ. */
  timeLabel: string;
}

export interface SlotsByDay {
  /** "2026-07-09" in BUSINESS_TZ — stable key for the calendar UI. */
  dateKey: string;
  /** "Monday, Apr 15" — displayed as the group header. */
  dateLabel: string;
  slots: DisplaySlot[];
}

/**
 * Fetch `days`-worth of available slots from now, grouped by business-tz
 * day. The signed-in portal redirects into the same public booking flow, so
 * every entry point shares this timezone and formatting logic.
 */
export async function loadSlotsForNextDays(
  durationMinutes: number,
  days: number,
  scope?: OrganizationScope,
): Promise<SlotsByDay[]> {
  const now = new Date();
  const from = new Date(now);
  from.setMinutes(0, 0, 0);
  from.setHours(from.getHours() + 1);

  const to = new Date(from);
  to.setDate(to.getDate() + days);

  const slots = await listAvailableSlots({
    from,
    to,
    durationMinutes,
    organizationId: scope?.organizationId,
  });

  const dayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const buckets = new Map<string, SlotsByDay>();
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const key = dayKeyFmt.format(d);
    if (!buckets.has(key)) {
      buckets.set(key, { dateKey: key, dateLabel: dayFmt.format(d), slots: [] });
    }
  }

  for (const s of slots) {
    const d = new Date(s.start);
    const key = dayKeyFmt.format(d);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.slots.push({ start: s.start, timeLabel: timeFmt.format(d) });
  }

  return Array.from(buckets.values());
}

export function formatSlotLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    dateStyle: "full",
    timeStyle: "short",
  }).format(d);
}
