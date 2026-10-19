"use client";

import { useState, useTransition } from "react";
import { saveBookingNotice } from "./actions";

export default function BookingNoticeEditor({ enabled }: { enabled: boolean }) {
  const [checked, setChecked] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5" onSubmit={(event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      setSaved(false);
      setError(null);
      startTransition(async () => {
        try {
          const result = await saveBookingNotice(formData);
          if (result.ok) setSaved(true);
          else setError(result.error ?? "Could not save. Please try again.");
        } catch {
          setError("Could not save. Please try again.");
        }
      });
    }}>
      <h2 className="text-lg font-semibold text-realtor-text">Booking notice</h2>
      <label className="mt-3 flex items-start gap-3 text-sm font-semibold text-realtor-text">
        <input type="checkbox" name="require_24_hour_notice" checked={checked} disabled={pending}
          aria-describedby="booking-notice-description"
          className="mt-1 h-4 w-4 accent-realtor-primary"
          onChange={(event) => { setChecked(event.currentTarget.checked); setSaved(false); setError(null); }} />
        Require at least 24 hours’ notice for customer bookings
      </label>
      <p id="booking-notice-description" className="mt-2 text-sm leading-6 text-realtor-muted">
        Customers must choose a shoot time at least 24 hours from now, including when rescheduling online.
        Existing appointments stay booked. You can still create or move bookings in the admin calendar.
      </p>
      <button type="submit" disabled={pending}
        className="mt-4 rounded-full border border-realtor-primary/20 px-4 py-2 text-sm font-semibold text-realtor-primary hover:bg-realtor-primary/10 disabled:opacity-50">
        {pending ? "Saving…" : "Save booking notice"}
      </button>
      {saved ? <p role="status" className="mt-2 text-sm text-realtor-primary">Booking notice saved.</p> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
