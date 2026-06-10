"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { SlotsByDay } from "@/lib/booking/slot-display";

import { cancelManagedBooking, rescheduleManagedBooking } from "./actions";

/**
 * Interactive half of /book/manage/[token] — a grouped-by-day slot list
 * for rescheduling plus a two-step cancel button. Everything calls the
 * token-scoped server actions; on success we router.refresh() so the
 * server page re-renders with the new state.
 */

interface Props {
  token: string;
  daysOfSlots: SlotsByDay[];
  currentWhenLabel: string;
  addressLine: string;
}

interface Flash {
  kind: "ok" | "error";
  text: string;
}

export default function ManageBookingClient({
  token,
  daysOfSlots,
  currentWhenLabel,
  addressLine,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<{
    start: string;
    label: string;
  } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [done, setDone] = useState(false);

  const daysWithSlots = daysOfSlots.filter((day) => day.slots.length > 0);

  function handleReschedule() {
    if (!selected || pending) return;
    setFlash(null);
    startTransition(async () => {
      const result = await rescheduleManagedBooking(token, selected.start);
      if (result.ok) {
        setDone(true);
        setFlash({
          kind: "ok",
          text: `You're rescheduled${result.whenLabel ? ` for ${result.whenLabel}` : ""}. A confirmation email is on the way.`,
        });
        router.refresh();
      } else {
        setFlash({
          kind: "error",
          text: result.error ?? "Something went wrong. Try again.",
        });
        router.refresh();
      }
    });
  }

  function handleCancelBooking() {
    if (pending) return;
    setFlash(null);
    startTransition(async () => {
      const result = await cancelManagedBooking(token);
      if (result.ok) {
        setDone(true);
        setFlash({
          kind: "ok",
          text: "Your booking has been cancelled. A confirmation email is on the way.",
        });
        router.refresh();
      } else {
        setFlash({
          kind: "error",
          text: result.error ?? "Something went wrong. Try again.",
        });
        setConfirmCancel(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {flash ? (
        <div
          role="status"
          className={
            "rounded-2xl border p-4 text-sm font-medium " +
            (flash.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
              : "border-red-500/30 bg-red-500/10 text-red-700")
          }
        >
          {flash.text}
        </div>
      ) : null}

      {!done ? (
        <>
          {/* Reschedule */}
          <section className="realtor-elevated-panel rounded-3xl p-5 md:p-6">
            <h2 className="text-lg font-semibold text-realtor-text">
              Pick a new time
            </h2>
            <p className="mt-1 text-sm text-realtor-muted">
              Currently booked for {currentWhenLabel}. All times are Eastern.
            </p>

            {daysWithSlots.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-realtor-primary/20 bg-realtor-surface-muted/70 p-5 text-sm text-realtor-muted">
                No openings in the next 4 weeks. Keep your current time, or
                contact the photographer for a custom slot.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {daysWithSlots.map((day) => (
                  <div
                    key={day.dateLabel}
                    className="realtor-warm-panel rounded-3xl p-4"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
                      {day.dateLabel}
                    </p>
                    <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {day.slots.map((slot) => {
                        const isSelected = selected?.start === slot.start;
                        return (
                          <li key={slot.start}>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                setSelected({
                                  start: slot.start,
                                  label: `${day.dateLabel} at ${slot.timeLabel}`,
                                })
                              }
                              className={
                                "tap-target w-full rounded-full border px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-realtor-primary/35 disabled:cursor-not-allowed disabled:opacity-50 " +
                                (isSelected
                                  ? "border-realtor-primary bg-realtor-primary text-white"
                                  : "border-realtor-primary/20 bg-realtor-surface/75 text-realtor-text/90 hover:border-realtor-primary/55 hover:bg-realtor-primary/10")
                              }
                            >
                              {slot.timeLabel}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {selected ? (
              <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-realtor-primary/15 bg-realtor-surface-muted/60 p-4">
                <p className="text-sm text-realtor-text">
                  New time: <strong>{selected.label}</strong>
                </p>
                <button
                  type="button"
                  onClick={handleReschedule}
                  disabled={pending}
                  className="tap-target rounded-full bg-brand-light px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending ? "Rescheduling…" : "Confirm new time"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  disabled={pending}
                  className="tap-target rounded-full border border-realtor-primary/20 px-4 py-2 text-sm text-realtor-muted transition hover:border-realtor-primary/35 hover:bg-realtor-surface disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear
                </button>
              </div>
            ) : null}
          </section>

          {/* Cancel */}
          <section className="realtor-elevated-panel rounded-3xl p-5 md:p-6">
            <h2 className="text-lg font-semibold text-realtor-text">
              Cancel this booking
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-realtor-muted">
              This frees up the slot at {addressLine} and notifies the
              photographer. You can always book a new shoot later.
            </p>
            {confirmCancel ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancelBooking}
                  disabled={pending}
                  className="tap-target rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending ? "Cancelling…" : "Yes, cancel the shoot"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  disabled={pending}
                  className="tap-target rounded-full border border-realtor-primary/20 px-4 py-2 text-sm text-realtor-muted transition hover:border-realtor-primary/35 hover:bg-realtor-surface disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Keep my booking
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                disabled={pending}
                className="tap-target mt-4 rounded-full border border-red-500/40 px-5 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel booking…
              </button>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
