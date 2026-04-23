"use client";

import { useState, useTransition } from "react";

import {
  BOOKING_STATUSES,
  DELIVERABLE_TYPES,
  deliverableTypeLabel,
  isCancellable,
} from "@/lib/booking/booking-status";
import type {
  BookingStatus,
  DeliverableType,
} from "@/lib/supabase/database.types";

import {
  addManualDeliverable,
  cancelBookingAsAdmin,
  deleteDeliverable,
  updateBookingStatus,
} from "./actions";

interface DeliverableSummary {
  id: string;
  type: DeliverableType;
  source: string;
  url: string;
  thumbnail_url: string | null;
  created_at: string;
}

export default function BookingActions({
  bookingId,
  currentStatus,
  transitions,
  deliverables,
}: {
  bookingId: string;
  currentStatus: BookingStatus;
  transitions: BookingStatus[];
  deliverables: DeliverableSummary[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function moveTo(next: BookingStatus) {
    setError(null);
    startTransition(async () => {
      const res = await updateBookingStatus(bookingId, next);
      if (!res.ok) setError(res.error ?? "Status update failed.");
    });
  }

  function cancel() {
    if (
      !confirm(
        "Cancel this booking? The realtor will be emailed and the Google Calendar event will be removed. The slot becomes bookable again.",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await cancelBookingAsAdmin(bookingId);
      if (!res.ok) setError(res.error ?? "Cancel failed.");
    });
  }

  // Skip `cancelled` from the normal transitions list — we render a
  // dedicated "Cancel booking" button below that runs the richer flow
  // (delete calendar event, email realtor). Plain pipeline buttons
  // cover requested→confirmed, confirmed→shot, etc.
  const forwardOnly = transitions.filter((s) => s !== "cancelled");
  const showCancel = isCancellable(currentStatus);

  return (
    <div className="space-y-6 rounded-lg border border-brand/20 bg-brand/5 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          Status
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Current: {BOOKING_STATUSES[currentStatus].label}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {forwardOnly.length === 0 && !showCancel ? (
            <p className="text-xs text-ink-muted">
              Terminal state — no further transitions.
            </p>
          ) : (
            forwardOnly.map((s) => (
              <button
                key={s}
                type="button"
                disabled={isPending}
                onClick={() => moveTo(s)}
                className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/90 hover:border-brand-light hover:bg-brand/10 disabled:opacity-60"
              >
                Move to {BOOKING_STATUSES[s].label}
              </button>
            ))
          )}
          {showCancel ? (
            <button
              type="button"
              disabled={isPending}
              onClick={cancel}
              className="rounded-md border border-red-400/40 px-3 py-1.5 text-sm text-red-200 hover:border-red-300 hover:bg-red-500/10 disabled:opacity-60"
            >
              Cancel booking
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="mt-2 text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <hr className="border-white/10" />

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          Add a deliverable
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Manual entry — paste an iGuide tour URL, a Fotello gallery URL, or
          any other delivery link. Phase 4/5 will sync these automatically.
        </p>
        <ManualDeliverableForm bookingId={bookingId} />
      </div>

      {deliverables.length > 0 ? (
        <>
          <hr className="border-white/10" />
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
              Manage existing
            </h2>
            <ul className="mt-3 space-y-2">
              {deliverables.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="truncate text-ink-muted">
                    <span className="text-white">
                      {deliverableTypeLabel(d.type)}
                    </span>
                    {" · "}
                    <span className="text-xs">{d.source}</span>
                  </span>
                  <DeleteButton bookingId={bookingId} deliverableId={d.id} />
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ManualDeliverableForm({ bookingId }: { bookingId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  return (
    <form
      className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_140px_auto]"
      action={(formData) => {
        setError(null);
        setOkMessage(null);
        startTransition(async () => {
          const res = await addManualDeliverable(bookingId, formData);
          if (!res.ok) {
            setError(res.error ?? "Could not add deliverable.");
          } else {
            setOkMessage("Added.");
            (document.getElementById(
              `manual-deliverable-${bookingId}`,
            ) as HTMLFormElement | null)?.reset();
          }
        });
      }}
      id={`manual-deliverable-${bookingId}`}
    >
      <select
        name="type"
        defaultValue=""
        className="rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white"
      >
        <option value="" disabled>
          Type…
        </option>
        {DELIVERABLE_TYPES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <input
        name="url"
        type="url"
        placeholder="https://youriguide.com/..."
        required
        className="rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white"
      />
      <input
        name="thumbnail_url"
        type="url"
        placeholder="Thumbnail (opt)"
        className="rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
      >
        {isPending ? "Adding…" : "Add"}
      </button>
      {error ? (
        <p className="md:col-span-4 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {okMessage ? (
        <p className="md:col-span-4 text-xs text-emerald-300">{okMessage}</p>
      ) : null}
    </form>
  );
}

function DeleteButton({
  bookingId,
  deliverableId,
}: {
  bookingId: string;
  deliverableId: string;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm("Delete this deliverable?")) return;
        startTransition(async () => {
          await deleteDeliverable(bookingId, deliverableId);
        });
      }}
      className="text-xs text-red-300 hover:text-red-200 disabled:opacity-60"
    >
      {isPending ? "…" : "Delete"}
    </button>
  );
}
