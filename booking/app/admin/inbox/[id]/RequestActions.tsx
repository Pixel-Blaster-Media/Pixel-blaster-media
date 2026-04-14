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
    <div className="space-y-4 rounded-lg border border-brand/20 bg-brand/5 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
        Actions
      </h2>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs text-ink-muted">Confirm date</span>
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-white"
          />
        </label>
        <label className="block">
          <span className="text-xs text-ink-muted">Confirm time</span>
          <input
            type="time"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-white"
          />
        </label>
      </div>

      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={isPending}
          onClick={() => call(() => acceptRequest(requestId, combineDateTime()))}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
        >
          {isPending ? "Accepting…" : "Accept & create booking"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => call(() => markReviewing(requestId))}
          className="rounded-md border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-white/40 disabled:opacity-60"
        >
          Mark reviewing
        </button>
        {!alreadyDeclined ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => call(() => declineRequest(requestId))}
            className="rounded-md border border-red-400/30 px-4 py-2 text-sm text-red-200 hover:border-red-400/60 disabled:opacity-60"
          >
            Decline
          </button>
        ) : null}
      </div>
      <p className="text-[11px] text-ink-muted">
        Accepting creates the realtor's account (if new), the property record,
        and a confirmed booking — then opens it.
      </p>
    </div>
  );
}
