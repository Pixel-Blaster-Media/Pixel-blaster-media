"use client";

import { useState, useTransition } from "react";

import { linkIGuideWebhookEvent } from "./actions";

export default function LinkEventForm({
  eventId,
  bookings,
  suggestedBookingId,
}: {
  eventId: string;
  bookings: Array<{ id: string; label: string }>;
  suggestedBookingId: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  return (
    <form
      className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]"
      action={(formData) => {
        setError(null);
        setOk(false);
        startTransition(async () => {
          const result = await linkIGuideWebhookEvent(formData);
          if (!result.ok) {
            setError(result.error ?? "Could not link iGUIDE.");
            return;
          }
          setOk(true);
        });
      }}
    >
      <input type="hidden" name="event_id" value={eventId} />
      <select
        name="booking_id"
        defaultValue={suggestedBookingId ?? ""}
        className="rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white"
        required
      >
        <option value="" disabled>
          Choose booking...
        </option>
        {bookings.map((booking) => (
          <option key={booking.id} value={booking.id}>
            {booking.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
      >
        {isPending ? "Linking..." : "Link"}
      </button>
      {error ? (
        <p className="md:col-span-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="md:col-span-2 text-xs text-emerald-300">
          Linked. The booking now has the iGUIDE deliverables.
        </p>
      ) : null}
    </form>
  );
}
