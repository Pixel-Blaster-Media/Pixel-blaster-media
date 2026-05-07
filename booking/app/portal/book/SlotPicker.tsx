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
      <p className="realtor-warm-panel rounded-3xl p-4 text-sm text-realtor-muted">
        No open slots in this range. The next 4 weeks might be booked solid
        — try picking fewer services, or email{" "}
        <a
          href="mailto:Info@PixelBlasterMedia.com"
          className="text-realtor-primary underline"
        >
          Info@PixelBlasterMedia.com
        </a>{" "}
        to find an exception.
      </p>
    );
  }

  return (
    <div className="realtor-warm-panel space-y-6 rounded-3xl p-4">
      <p className="text-xs text-realtor-muted">
        All times are shown in {BUSINESS_TZ_DISPLAY}.
      </p>
      {daysOfSlots.map((day) => (
        <div key={day.dateLabel} className="rounded-2xl bg-realtor-surface/70 p-3 ring-1 ring-realtor-primary/10">
          <p className="text-sm font-semibold text-realtor-text">{day.dateLabel}</p>
          {day.slots.length === 0 ? (
            <p className="mt-1 text-xs text-realtor-muted">
              No slots — day off or fully booked.
            </p>
          ) : (
            <ul className="mt-2 grid gap-2 sm:grid-cols-3">
              {day.slots.map((s) => (
                <li key={s.start}>
                  <button
                    type="button"
                    onClick={() => pick(s.start)}
                    className={
                      "w-full rounded-full border px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-realtor-primary/35 " +
                      (selectedSlot === s.start
                        ? "border-realtor-primary bg-realtor-primary text-white"
                        : "border-realtor-primary/15 bg-realtor-surface text-realtor-muted hover:border-realtor-primary/35 hover:bg-realtor-primary/10 hover:text-realtor-text")
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
