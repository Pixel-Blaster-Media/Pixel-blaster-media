"use client";

import { useState, useTransition } from "react";

import {
  ignoreIGuideWebhookEvent,
  linkIGuideWebhookEvent,
} from "./actions";

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
    <div className="mt-3 space-y-2">
      <form
        className="grid gap-2 md:grid-cols-[1fr_auto]"
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
          className="rounded-xl border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white"
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
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
        >
          {isPending ? "Linking..." : "Link to booking"}
        </button>
      </form>
      <form
        action={(formData) => {
          if (!confirm("Hide this iGUIDE from the review queue?")) return;
          setError(null);
          setOk(false);
          startTransition(async () => {
            const result = await ignoreIGuideWebhookEvent(formData);
            if (!result.ok) {
              setError(result.error ?? "Could not ignore iGUIDE.");
              return;
            }
            setOk(true);
          });
        }}
      >
        <input type="hidden" name="event_id" value={eventId} />
        <button
          type="submit"
          disabled={isPending}
          className="text-xs text-ink-muted underline hover:text-red-300 disabled:opacity-60"
        >
          This is not my shoot
        </button>
      </form>
      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="text-xs text-emerald-300">Saved.</p>
      ) : null}
    </div>
  );
}
