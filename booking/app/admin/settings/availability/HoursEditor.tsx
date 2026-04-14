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
      className="grid items-center gap-3 md:grid-cols-[140px_1fr_1fr_auto_auto]"
    >
      <input type="hidden" name="day_of_week" value={dayOfWeek} />
      <span className="text-sm text-white">{dayName}</span>
      <label className="flex items-center gap-2 text-xs text-ink-muted">
        <span>Start</span>
        <input
          type="time"
          name="start_time"
          defaultValue={startTime}
          className="flex-1 rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-muted">
        <span>End</span>
        <input
          type="time"
          name="end_time"
          defaultValue={endTime}
          className="flex-1 rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          className="h-4 w-4 accent-brand-light"
        />
        <span>Open</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white hover:border-brand-light hover:text-brand-light disabled:opacity-50"
      >
        {pending ? "Saving…" : ok ? "✓ Saved" : "Save"}
      </button>
      {error ? (
        <p className="md:col-span-5 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
