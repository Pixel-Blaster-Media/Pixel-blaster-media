"use client";

import { useState, useTransition } from "react";

import { saveBusinessHour } from "./actions";

export default function HoursEditor({
  dayOfWeek,
  dayName,
  startTime,
  endTime,
  enabled,
}: {
  dayOfWeek: number;
  dayName: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [isOpen, setIsOpen] = useState(enabled);

  return (
    <form
      action={(formData) => {
        setError(null);
        setOk(false);
        startTransition(async () => {
          const res = await saveBusinessHour(formData);
          if (!res.ok) setError(res.error ?? "Save failed.");
          else setOk(true);
        });
      }}
      className={`rounded-2xl border p-4 transition ${
        isOpen
          ? "border-realtor-primary/15 bg-realtor-surface/85 shadow-sm shadow-realtor-text/5"
          : "border-realtor-primary/10 bg-realtor-surface-muted/45"
      }`}
    >
      <input type="hidden" name="day_of_week" value={dayOfWeek} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-realtor-text">{dayName}</p>
          <p className="mt-0.5 text-xs text-realtor-muted">
            {isOpen
              ? `${formatDisplayTime(startTime)} – ${formatDisplayTime(endTime)}`
              : "Closed"}
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold text-realtor-muted">
          <span>{isOpen ? "Open" : "Closed"}</span>
          <input
            type="checkbox"
            name="enabled"
            checked={isOpen}
            onChange={(event) => setIsOpen(event.currentTarget.checked)}
            className="peer sr-only"
          />
          <span className="relative h-6 w-11 rounded-full border border-realtor-primary/20 bg-realtor-surface-muted transition peer-checked:border-realtor-primary/40 peer-checked:bg-realtor-primary">
            <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition peer-checked:translate-x-5" />
          </span>
        </label>
      </div>

      <div
        className={`mt-4 grid grid-cols-1 gap-2 transition sm:grid-cols-2 ${
          isOpen ? "opacity-100" : "opacity-45"
        }`}
      >
        <label className="min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface p-2">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-realtor-muted">
            Start
          </span>
          <input
            type="time"
            name="start_time"
            defaultValue={startTime}
            readOnly={!isOpen}
            aria-disabled={!isOpen}
            className="relative -top-0.5 mt-1 box-border block w-full min-w-0 max-w-full appearance-none border-0 bg-transparent p-0 text-center text-sm font-semibold text-realtor-text outline-none [color-scheme:light] aria-disabled:cursor-not-allowed"
          />
        </label>
        <label className="min-w-0 rounded-xl border border-realtor-primary/15 bg-realtor-surface p-2">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-realtor-muted">
            End
          </span>
          <input
            type="time"
            name="end_time"
            defaultValue={endTime}
            readOnly={!isOpen}
            aria-disabled={!isOpen}
            className="relative -top-0.5 mt-1 box-border block w-full min-w-0 max-w-full appearance-none border-0 bg-transparent p-0 text-center text-sm font-semibold text-realtor-text outline-none [color-scheme:light] aria-disabled:cursor-not-allowed"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-realtor-primary/20 px-4 py-2 text-xs font-semibold text-realtor-primary transition hover:bg-realtor-primary/10 disabled:opacity-50"
        >
          {pending ? "Saving…" : ok ? "✓ Saved" : "Save"}
        </button>
        {error ? (
          <p className="text-xs text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function formatDisplayTime(value: string) {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}
