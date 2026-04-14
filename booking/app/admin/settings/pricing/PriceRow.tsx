"use client";

import { useState, useTransition } from "react";

import { savePrice } from "./actions";

export default function PriceRow({
  serviceId,
  label,
  blurb,
  priceCents,
  taxable,
}: {
  serviceId: string;
  label: string;
  blurb: string;
  priceCents: number;
  taxable: boolean;
}) {
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      action={(fd) => {
        setError(null);
        setSaved(false);
        startPending(async () => {
          const res = await savePrice(fd);
          if (!res.ok) setError(res.error ?? "Save failed.");
          else setSaved(true);
        });
      }}
      className="grid items-center gap-3 md:grid-cols-[1fr_auto_auto_auto]"
    >
      <input type="hidden" name="service_id" value={serviceId} />
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{blurb}</p>
      </div>
      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted">$</span>
        <input
          name="price_dollars"
          type="number"
          min={0}
          step="0.01"
          defaultValue={(priceCents / 100).toFixed(2)}
          className="w-28 rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          name="taxable"
          defaultChecked={taxable}
          className="h-4 w-4 accent-brand-light"
        />
        <span>Taxable</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white hover:border-brand-light hover:text-brand-light disabled:opacity-50"
      >
        {pending ? "Saving…" : saved ? "✓ Saved" : "Save"}
      </button>
      {error ? (
        <p role="alert" className="md:col-span-4 text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </form>
  );
}
