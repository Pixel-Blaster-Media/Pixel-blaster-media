"use client";

import { useState, useTransition } from "react";

import { acceptRequest, declineRequest, markReviewing } from "./actions";

export default function RequestActions({
  requestId,
  alreadyDeclined,
  defaultDate,
}: {
  requestId: string;
  alreadyDeclined: boolean;
  defaultDate: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scheduledDate, setScheduledDate] = useState(defaultDate);
  const [scheduledTime, setScheduledTime] = useState("");

  function combineDateTime(): string | null {
    if (!scheduledDate) return null;
    if (!scheduledTime) return new Date(scheduledDate).toISOString();
    const iso = new Date(`${scheduledDate}T${scheduledTime}`);
    return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
  }

  function call(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-realtor-primary/20 bg-realtor-primary/5 p-4 shadow-lg shadow-realtor-text/5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-realtor-primary">
        Actions
      </h2>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs text-realtor-muted">Confirm date</span>
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-realtor-text"
          />
        </label>
        <label className="block">
          <span className="text-xs text-realtor-muted">Confirm time</span>
          <input
            type="time"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            className="mt-1 w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-realtor-text"
          />
        </label>
      </div>

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={isPending}
          onClick={() => call(() => acceptRequest(requestId, combineDateTime()))}
          className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white hover:bg-realtor-primary/90 disabled:opacity-60"
        >
          {isPending ? "Accepting…" : "Accept & create booking"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => call(() => markReviewing(requestId))}
          className="rounded-full border border-realtor-primary/20 px-4 py-2 text-sm text-realtor-text/80 hover:border-realtor-primary/40 disabled:opacity-60"
        >
          Mark reviewing
        </button>
        {!alreadyDeclined ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => call(() => declineRequest(requestId))}
            className="rounded-full border border-red-300 px-4 py-2 text-sm text-red-700 hover:border-red-300 disabled:opacity-60"
          >
            Decline
          </button>
        ) : null}
      </div>
      <p className="text-[11px] text-realtor-muted">
        Accepting creates the realtor's account (if new), the property record,
        and a confirmed booking — then opens it.
      </p>
    </div>
  );
}
