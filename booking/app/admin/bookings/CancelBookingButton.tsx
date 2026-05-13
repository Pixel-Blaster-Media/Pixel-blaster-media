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

  function cancel() {
    if (
      !confirm(
        "Cancel this booking? The realtor will be emailed, the Google Calendar event will be removed, and the time slot will become bookable again.",
      )
    ) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await cancelBookingAsAdmin(bookingId);
      if (!res.ok) {
        setError(res.error ?? "Cancel failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={cancel}
        className={
          compact
            ? "rounded-full border border-red-400/35 px-2.5 py-1 text-[11px] font-semibold text-red-200 transition hover:border-red-300 hover:bg-red-500/10 disabled:opacity-60"
            : "rounded-full border border-red-400/40 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:border-red-300 hover:bg-red-500/10 disabled:opacity-60"
        }
      >
        {isPending ? "Cancelling..." : label}
      </button>
      {error ? (
        <span className="max-w-44 text-right text-[11px] text-red-200" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
