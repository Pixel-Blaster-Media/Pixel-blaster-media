"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import type { SlotsByDay } from "@/lib/booking/slot-display";

/**
 * Step 3 — month-grid calendar picker.
 *
 * Server-side we fetch the next 28 days worth of slots keyed by day.
 * The client renders a classic month grid (Sun–Sat), greys out days
 * with zero openings, and reveals just the picked day's times below.
 *
 * Why custom and not a library: Tailwind + our dark palette, ~100
 * lines of code, zero dependencies. Prev/next only move between months
 * that contain at least one available day — stops them scrolling
 * forever into empty months.
 */

interface Props {
  daysOfSlots: SlotsByDay[];
  selectedSlot: string | null;
  onPickSlot?: (iso: string) => void;
}

type SlotsByDayKey = Record<string, { timeLabel: string; start: string }[]>;

export default function CalendarPicker({ daysOfSlots, selectedSlot }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  // Re-key the server's day list by YYYY-MM-DD so cells can look up
  // availability in O(1).
  const slotsByKey = useMemo<SlotsByDayKey>(() => {
    const map: SlotsByDayKey = {};
    for (const day of daysOfSlots) {
      for (const s of day.slots) {
        const iso = s.start;
        const key = iso.slice(0, 10); // YYYY-MM-DD in UTC; close enough for
        // bucketing since our slots are already in business-tz days
        map[key] ??= [];
        map[key].push(s);
      }
    }
    return map;
  }, [daysOfSlots]);

  // The month grid is driven off a "cursor" date. Default to the
  // earliest month that has any availability (usually this month);
  // if the URL carries ?slot=..., open the month that contains it so
  // a revisit lands on the picked date.
  const initialCursor = useMemo(() => {
    if (selectedSlot) {
      const d = new Date(selectedSlot);
      if (!Number.isNaN(d.getTime())) return firstOfMonth(d);
    }
    for (const day of daysOfSlots) {
      if (day.slots.length > 0) {
        return firstOfMonth(new Date(day.slots[0].start));
      }
    }
    return firstOfMonth(new Date());
  }, [daysOfSlots, selectedSlot]);

  const [cursor, setCursor] = useState(initialCursor);
  const selectedDayKey = useMemo(() => {
    if (selectedSlot) return selectedSlot.slice(0, 10);
    // Default the revealed slots to the first available day in the view.
    return null;
  }, [selectedSlot]);
  const [openDayKey, setOpenDayKey] = useState<string | null>(selectedDayKey);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);

  // Min / max months = clamp to the 28-day window we actually loaded.
  const { firstAvailableMonth, lastAvailableMonth } = useMemo(() => {
    let first: Date | null = null;
    let last: Date | null = null;
    for (const day of daysOfSlots) {
      for (const s of day.slots) {
        const d = new Date(s.start);
        if (!first || d < first) first = d;
        if (!last || d > last) last = d;
      }
    }
    return {
      firstAvailableMonth: first ? firstOfMonth(first) : firstOfMonth(new Date()),
      lastAvailableMonth: last ? firstOfMonth(last) : firstOfMonth(new Date()),
    };
  }, [daysOfSlots]);

  const canGoPrev = cursor > firstAvailableMonth;
  const canGoNext = cursor < lastAvailableMonth;

  function pickSlot(iso: string) {
    const next = new URLSearchParams(params.toString());
    next.set("slot", iso);
    router.push(`/book/confirm?${next.toString()}`);
  }

  const visibleSlots =
    openDayKey && slotsByKey[openDayKey] ? slotsByKey[openDayKey] : null;
  const hasAnySlots = daysOfSlots.some((d) => d.slots.length > 0);

  if (!hasAnySlots) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 bg-ink-soft/40 p-6 text-sm text-ink-muted">
        No openings in the next 4 weeks. Try a different service combo or
        email{" "}
        <a
          href="mailto:info@pixelblastermedia.com"
          className="text-brand-light underline"
        >
          info@pixelblastermedia.com
        </a>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Month header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCursor(addMonths(cursor, -1))}
          disabled={!canGoPrev}
          className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-white/80 hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Previous month"
        >
          ←
        </button>
        <p className="text-sm font-semibold uppercase tracking-wider text-white">
          {cursor.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </p>
        <button
          type="button"
          onClick={() => setCursor(addMonths(cursor, 1))}
          disabled={!canGoNext}
          className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-white/80 hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Next month"
        >
          →
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-1">
        {grid.map((cell) => {
          const dayKey = cell.date ? ymd(cell.date) : null;
          const slots = dayKey ? slotsByKey[dayKey] ?? [] : [];
          const hasSlots = slots.length > 0;
          const isSelected = dayKey != null && openDayKey === dayKey;
          const inMonth = cell.inMonth;

          return (
            <button
              key={cell.key}
              type="button"
              disabled={!hasSlots}
              onClick={() => hasSlots && dayKey && setOpenDayKey(dayKey)}
              className={
                "relative aspect-square rounded-md border text-sm transition " +
                (!inMonth
                  ? "border-transparent text-white/20"
                  : isSelected
                    ? "border-brand-light bg-brand/20 text-brand-light"
                    : hasSlots
                      ? "border-white/10 text-white hover:border-brand-light/60 hover:bg-brand/10"
                      : "border-white/5 text-white/30")
              }
            >
              {cell.date ? cell.date.getDate() : ""}
              {hasSlots ? (
                <span
                  aria-hidden="true"
                  className={
                    "absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full " +
                    (isSelected ? "bg-brand-light" : "bg-emerald-400/70")
                  }
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Slots for picked day */}
      {visibleSlots ? (
        <div className="rounded-lg border border-white/10 bg-ink-soft/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-light">
            {formatDayLabel(openDayKey ?? "")}
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {visibleSlots.map((s) => (
              <li key={s.start}>
                <button
                  type="button"
                  onClick={() => pickSlot(s.start)}
                  className={
                    "rounded-md border px-3 py-1.5 text-sm transition " +
                    (selectedSlot === s.start
                      ? "border-brand-light bg-brand/20 text-brand-light"
                      : "border-white/15 text-white/90 hover:border-brand-light/60 hover:bg-brand/10")
                  }
                >
                  {s.timeLabel}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">
          Click a day to see open times.
        </p>
      )}
    </div>
  );
}

// ---- date helpers ----

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface Cell {
  key: string;
  date: Date | null;
  inMonth: boolean;
}

function buildMonthGrid(cursor: Date): Cell[] {
  const monthStart = firstOfMonth(cursor);
  const startWeekday = monthStart.getDay(); // 0 = Sun
  const daysInMonth = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    0,
  ).getDate();

  const cells: Cell[] = [];
  // Prior-month spillover to line up first row under correct weekday.
  for (let i = 0; i < startWeekday; i++) {
    const d = new Date(monthStart);
    d.setDate(d.getDate() - (startWeekday - i));
    cells.push({ key: `pre-${i}`, date: d, inMonth: false });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(monthStart.getFullYear(), monthStart.getMonth(), i);
    cells.push({ key: `m-${i}`, date: d, inMonth: true });
  }
  // Pad to full weeks (5 or 6 rows depending).
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date ?? monthStart;
    const d = new Date(last);
    d.setDate(d.getDate() + 1);
    cells.push({ key: `post-${cells.length}`, date: d, inMonth: false });
  }
  return cells;
}

function formatDayLabel(dayKey: string): string {
  if (!dayKey) return "";
  // Construct a noon-local date to avoid TZ rollover artifacts.
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1, 12);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
