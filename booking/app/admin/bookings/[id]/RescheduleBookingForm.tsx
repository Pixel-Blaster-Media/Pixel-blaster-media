"use client";

import { useState, useTransition } from "react";

import { rescheduleBookingFromDetails } from "./actions";

export default function RescheduleBookingForm({
  bookingId,
  initialScheduledAtLocal,
}: {
  bookingId: string;
  initialScheduledAtLocal: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await rescheduleBookingFromDetails(bookingId, formData);
      if (!result.ok) {
        setError(result.error ?? "Could not reschedule booking.");
        return;
      }
      setSaved(true);
    });
  }

  return (
    <form
      action={onSubmit}
      className="rounded-2xl border border-realtor-primary/20 bg-realtor-primary/5 p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block min-w-[220px] flex-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
            Reschedule shoot
          </span>
          <input
            name="scheduled_at"
            type="datetime-local"
            defaultValue={initialScheduledAtLocal}
            required
            className="mt-2 w-full rounded-md border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-realtor-text placeholder-realtor-muted focus:outline-none focus:ring-2 focus:ring-realtor-primary/60"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Rescheduling..." : "Reschedule"}
        </button>
      </div>
      <p className="mt-2 text-xs text-realtor-muted">
        Keeps the current shoot duration and replaces the linked Google Calendar
        event. Admin reschedules can overlap existing calendar items.
      </p>
      {error ? (
        <p className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Booking rescheduled.
        </p>
      ) : null}
    </form>
  );
}
