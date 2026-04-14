"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { BUSINESS_TZ_DISPLAY, type SlotsByDay } from "./slot-types";

/**
 * Renders slots grouped by day. Picking a slot writes ?slot=ISO to the
 * URL so the server can render the property-address form in the next
 * section. Purely presentational — no fetching; the parent already has
 * the slots.
 */
export default function SlotPicker({
  selectedSlot,
  daysOfSlots,
}: {
  selectedSlot: string | null;
  daysOfSlots: SlotsByDay[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  function pick(iso: string) {
    const next = new URLSearchParams(params.toString());
    next.set("slot", iso);
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  if (daysOfSlots.every((d) => d.slots.length === 0)) {
    return (
      <p className="rounded-lg border border-dashed border-white/10 bg-ink-soft/40 p-4 text-sm text-ink-muted">
        No open slots in this range. The next 4 weeks might be booked solid
        — try picking fewer services, or email{" "}
        <a
          href="mailto:Info@PixelBlasterMedia.com"
          className="text-brand-light underline"
        >
          Info@PixelBlasterMedia.com
        </a>{" "}
        to find an exception.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-ink-muted">
        All times are shown in {BUSINESS_TZ_DISPLAY}.
      </p>
      {daysOfSlots.map((day) => (
        <div key={day.dateLabel}>
          <p className="text-sm font-semibold text-white">{day.dateLabel}</p>
          {day.slots.length === 0 ? (
            <p className="mt-1 text-xs text-ink-muted">
              No slots — day off or fully booked.
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {day.slots.map((s) => (
                <li key={s.start}>
                  <button
                    type="button"
                    onClick={() => pick(s.start)}
                    className={
                      "rounded-md border px-3 py-1.5 text-xs transition " +
                      (selectedSlot === s.start
                        ? "border-brand-light bg-brand/20 text-brand-light"
                        : "border-white/10 text-white/80 hover:border-white/30 hover:text-white")
                    }
                  >
                    {s.timeLabel}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
