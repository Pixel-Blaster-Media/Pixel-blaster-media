"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { rescheduleBookingFromDetails } from "./actions";

export default function RescheduleBookingForm({
  bookingId,
  initialScheduledAtLocal,
}: {
  bookingId: string;
  initialScheduledAtLocal: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    setSavedMessage(null);
    startTransition(async () => {
      const result = await rescheduleBookingFromDetails(bookingId, formData);
      if (!result.ok) {
        setError(result.error ?? "Could not reschedule booking.");
        return;
      }
      setSavedMessage(
        result.confirmationSent
          ? "Booking rescheduled and confirmation email sent."
          : "Booking rescheduled.",
      );
      router.refresh();
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
            Quick reschedule time only
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
        This only changes the shoot time. Use Edit booking below for address,
        realtor name, services, notes, or combined edits.
      </p>
      <label className="mt-3 flex items-start gap-2 text-sm text-realtor-text">
        <input name="send_confirmation" type="checkbox" className="mt-1" />
        <span>
          <span className="block font-semibold">
            Send booking confirmation email again
          </span>
          <span className="block text-xs text-realtor-muted">
            Leave unchecked when you are quietly holding or moving a slot.
          </span>
        </span>
      </label>
      {error ? (
        <p className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {savedMessage ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {savedMessage}
        </p>
      ) : null}
    </form>
  );
}
