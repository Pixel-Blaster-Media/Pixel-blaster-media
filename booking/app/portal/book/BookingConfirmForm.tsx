"use client";

import { useFormState, useFormStatus } from "react-dom";

import { createSelfBooking, type SelfBookResult } from "./actions";

const initial: SelfBookResult | null = null;

export default function BookingConfirmForm({
  serviceSlugs,
  addOnSlugs,
  slot,
  whenLabel,
}: {
  serviceSlugs: string[];
  addOnSlugs: string[];
  slot: string;
  whenLabel: string;
}) {
  const [state, formAction] = useFormState(createSelfBooking, initial);

  return (
    <form action={formAction} className="space-y-4">
      {serviceSlugs.map((s) => (
        <input key={s} type="hidden" name="services" value={s} />
      ))}
      {addOnSlugs.map((a) => (
        <input key={a} type="hidden" name="add_ons" value={a} />
      ))}
      <input type="hidden" name="slot" value={slot} />

      <p className="text-sm text-ink-muted">
        You&apos;re booking <span className="text-white">{whenLabel}</span>.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            Property address <span className="text-brand-light">*</span>
          </span>
          <input
            name="street_address"
            type="text"
            required
            placeholder="123 King St W"
            className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            City
          </span>
          <input
            name="city"
            type="text"
            defaultValue="Hamilton"
            className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-light/60"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            Postal code
          </span>
          <input
            name="postal_code"
            type="text"
            placeholder="L8P 4S8"
            className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            Approx. square footage
          </span>
          <input
            name="square_footage"
            type="number"
            min={0}
            step={1}
            placeholder="2500"
            className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            Notes (optional)
          </span>
          <textarea
            name="notes"
            rows={3}
            placeholder="Tenant occupied, vacant, pets, gate code, etc."
            className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60"
          />
        </label>
      </div>

      {state?.error ? (
        <p className="text-sm text-red-300" role="alert">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand px-5 py-2.5 font-semibold text-white hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Booking…" : "Confirm booking"}
    </button>
  );
}
