import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/lib/auth/require-user";
import {
  BUSINESS_TZ,
  listAvailableSlots,
} from "@/lib/booking/availability";
import {
  isValidAddOnId,
  isValidServiceId,
  labelForAddOn,
  labelForService,
  totalDurationMinutes,
} from "@/lib/booking/services";

import BookingConfirmForm from "./BookingConfirmForm";
import ServicePicker from "./ServicePicker";
import SlotPicker from "./SlotPicker";
import type { SlotsByDay } from "./slot-types";

export const metadata: Metadata = { title: "Book a shoot" };
export const dynamic = "force-dynamic";

/**
 * Private calendar for signed-in realtors. URL-driven so progressive
 * enhancement works and bookmarks are meaningful:
 *
 *   /portal/book?services=real_estate_photos,iguide_tour&slot=2026-04-15T14:00:00Z
 *
 * Flow:
 *   1. No services picked → show picker, skip slots section.
 *   2. Services picked → fetch & show slots for next 4 weeks.
 *   3. Slot picked (URL has ?slot=...) → show property form, submit goes
 *      through the createSelfBooking server action.
 */
export default async function PortalBookPage({
  searchParams,
}: {
  searchParams: { services?: string; add_ons?: string; slot?: string };
}) {
  await requireUser("/portal/book");

  const services = parseCsvIds(searchParams.services, isValidServiceId);
  const addOns = parseCsvIds(searchParams.add_ons, isValidAddOnId);
  const duration = Math.max(totalDurationMinutes(services, addOns), 60);
  const selectedSlot = searchParams.slot ?? null;

  const daysOfSlots: SlotsByDay[] =
    services.length > 0 ? await loadSlotsForNextWeeks(duration, 28) : [];

  const whenLabel = selectedSlot
    ? formatSlot(new Date(selectedSlot))
    : null;

  return (
    <div className="space-y-10">
      <Link
        href="/portal"
        className="text-xs text-ink-muted hover:text-white"
      >
        ← My listings
      </Link>

      <header>
        <h1 className="text-3xl font-bold text-white">Book a shoot</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Pick what you need, find a time, confirm. Confirmed bookings land
          directly on the photographer's calendar — no back-and-forth.
        </p>
      </header>

      <section className="rounded-xl border border-white/10 bg-ink-soft/50 p-5">
        <ServicePicker
          selectedServices={services}
          selectedAddOns={addOns}
        />
        {services.length > 0 ? (
          <p className="mt-5 border-t border-white/5 pt-4 text-xs text-ink-muted">
            On-site: <span className="text-white">~{duration} min</span>
            {" · "}
            {[...services.map(labelForService), ...addOns.map(labelForAddOn)]
              .filter(Boolean)
              .join(", ")}
          </p>
        ) : null}
      </section>

      {services.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
            Pick a time
          </h2>
          <div className="mt-4">
            <SlotPicker
              selectedSlot={selectedSlot}
              daysOfSlots={daysOfSlots}
            />
          </div>
        </section>
      ) : null}

      {selectedSlot && whenLabel ? (
        <section className="rounded-xl border border-brand/20 bg-brand/5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
            Property details
          </h2>
          <div className="mt-4">
            <BookingConfirmForm
              services={services}
              addOns={addOns}
              slot={selectedSlot}
              whenLabel={whenLabel}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ---- Helpers ----

function parseCsvIds<T extends string>(
  raw: string | undefined,
  isValid: (s: string) => s is T,
): T[] {
  if (!raw) return [];
  const out: T[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed && isValid(trimmed) && !out.includes(trimmed)) {
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * Load slots and group them into per-day buckets with pre-formatted
 * labels so the client component stays presentational.
 */
async function loadSlotsForNextWeeks(
  durationMinutes: number,
  days: number,
): Promise<SlotsByDay[]> {
  const now = new Date();
  // Start from the next full hour so realtors can't book into the past.
  const from = new Date(now);
  from.setMinutes(0, 0, 0);
  from.setHours(from.getHours() + 1);

  const to = new Date(from);
  to.setDate(to.getDate() + days);

  const slots = await listAvailableSlots({ from, to, durationMinutes });

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
  // Seed empty buckets for every day in the window so the UI shows
  // "no slots" on fully-booked days rather than silently omitting them.
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const key = dayKeyFmt.format(d);
    if (!buckets.has(key)) {
      buckets.set(key, { dateLabel: dayFmt.format(d), slots: [] });
    }
  }

  for (const s of slots) {
    const d = new Date(s.start);
    const key = dayKeyFmt.format(d);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.slots.push({ start: s.start, timeLabel: timeFmt.format(d) });
  }

  // Drop trailing days that have no slots AND are beyond the first 14
  // days — keeps the page short without hiding the near-term story.
  const entries = Array.from(buckets.entries());
  return entries.map(([, v]) => v);
}

function formatSlot(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    dateStyle: "full",
    timeStyle: "short",
  }).format(d);
}
