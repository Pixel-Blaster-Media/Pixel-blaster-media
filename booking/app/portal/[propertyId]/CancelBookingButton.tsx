"use client";

import { useState, useTransition } from "react";

import { cancelOwnBooking } from "./actions";

export default function CancelBookingButton({
  bookingId,
  whenLabel,
}: {
  bookingId: string;
  whenLabel: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    const when = whenLabel ? `on ${whenLabel}` : "";
    const ok = confirm(
      `Cancel this shoot ${when}?\n\nYou'll get an email confirming the cancellation, and the slot will free up. You can always book a new time at /book if you're rescheduling.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await cancelOwnBooking(bookingId);
      if (!res.ok) {
        setError(res.error ?? "Cancel failed.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={isPending}
        onClick={onClick}
        className="rounded-md border border-red-400/40 px-3 py-1 text-[11px] uppercase tracking-wider text-red-200 hover:border-red-300 hover:bg-red-500/10 disabled:opacity-60"
      >
        {isPending ? "Cancelling…" : "Cancel booking"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </>
  );
}
