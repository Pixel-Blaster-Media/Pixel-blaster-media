"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cancelBookingAsAdmin } from "./[id]/actions";

export default function CancelBookingButton({
  bookingId,
  label = "Cancel booking",
  compact = false,
}: {
  bookingId: string;
  label?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  function cancel() {
    if (
      !confirm(
        "Cancel this booking? Configured notifications and Google Calendar cleanup will be attempted. Any cleanup issue will stay visible here.",
      )
    ) {
      return;
    }

    setError(null);
    setWarning(null);
    startTransition(async () => {
      const res = await cancelBookingAsAdmin(bookingId);
      if (!res.ok) {
        setError(res.error ?? "Cancel failed.");
        return;
      }
      setWarning(res.warning ?? null);
      setCompleted(true);
      if (!res.warning) router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending || completed}
        onClick={cancel}
        className={
          compact
            ? "rounded-full border border-red-300 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
            : "tap-target rounded-full border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
        }
      >
        {isPending ? "Cancelling..." : completed ? "Cancelled" : label}
      </button>
      {error ? (
        <span className="max-w-44 text-right text-[11px] text-red-700" role="alert">
          {error}
        </span>
      ) : null}
      {warning ? (
        <span
          className="max-w-56 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-right text-[11px] text-amber-900"
          role="status"
        >
          {warning}
        </span>
      ) : null}
    </span>
  );
}
