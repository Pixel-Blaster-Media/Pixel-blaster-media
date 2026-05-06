"use client";

import { useState, useTransition } from "react";

import type { CatalogItemRow } from "@/lib/booking/catalog";

import { deleteCatalogItem, updateCatalogItem } from "./actions";

export default function CatalogItemEditor({ item }: { item: CatalogItemRow }) {
  const [pending, startPending] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isAddon = item.kind === "addon";

  return (
    <form
      action={(fd) => {
        setError(null);
        setSaved(false);
        startPending(async () => {
          const res = await updateCatalogItem(fd);
          if (!res.ok) setError(res.error ?? "Save failed.");
          else setSaved(true);
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="kind" value={item.kind} />

      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            Name
          </span>
          <input
            name="name"
            defaultValue={item.name}
            required
            className="rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            Price
          </span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-ink-muted">$</span>
            <input
              name="price_dollars"
              type="number"
              min={0}
              step="0.01"
              defaultValue={(item.price_cents / 100).toFixed(2)}
              className="w-24 rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            Duration
          </span>
          <div className="flex items-center gap-1">
            <input
              name="duration_minutes"
              type="number"
              min={0}
              step="1"
              defaultValue={item.duration_minutes}
              className="w-20 rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
            />
            <span className="text-xs text-ink-muted">min</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            Order
          </span>
          <input
            name="display_order"
            type="number"
            min={0}
            step="1"
            defaultValue={item.display_order}
            className="w-16 rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-muted">
          Description (shown on the booking form — supports line breaks and
          bullet-style dashes)
        </span>
        <textarea
          name="description"
          defaultValue={item.description}
          rows={4}
          className="w-full rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            Badge
          </span>
          <input
            name="badge"
            defaultValue={item.badge ?? ""}
            placeholder="Most popular"
            className="rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            Ideal for
          </span>
          <input
            name="ideal_for"
            defaultValue={item.ideal_for ?? ""}
            placeholder="Standard listings, luxury homes, social-first launches…"
            className="rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
          />
        </label>
      </div>

      <div className="rounded-md border border-white/10 bg-black/20 p-3">
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            name="sqft_pricing_enabled"
            defaultChecked={item.sqft_pricing_enabled}
            className="h-4 w-4 accent-brand-light"
          />
          <span>Charge square-footage overage</span>
        </label>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-muted">
              Included sqft
            </span>
            <input
              name="included_sqft"
              type="number"
              min={1}
              step="1"
              defaultValue={item.included_sqft ?? ""}
              placeholder="2500"
              className="rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-muted">
              Extra sqft step
            </span>
            <input
              name="overage_increment_sqft"
              type="number"
              min={1}
              step="1"
              defaultValue={item.overage_increment_sqft ?? ""}
              placeholder="500"
              className="rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-muted">
              Price per step
            </span>
            <div className="flex items-center gap-1">
              <span className="text-xs text-ink-muted">$</span>
              <input
                name="overage_price_dollars"
                type="number"
                min={0}
                step="0.01"
                defaultValue={
                  item.overage_price_cents == null
                    ? ""
                    : (item.overage_price_cents / 100).toFixed(2)
                }
                placeholder="40.00"
                className="w-full rounded-md border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
              />
            </div>
          </label>
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">
          Example: $200 includes 2,500 sqft, then +$40 every 500 sqft.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="active"
            defaultChecked={item.active}
            className="h-4 w-4 accent-brand-light"
          />
          <span>Active</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="taxable"
            defaultChecked={item.taxable}
            className="h-4 w-4 accent-brand-light"
          />
          <span>Taxable</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="highlight"
            defaultChecked={item.highlight}
            className="h-4 w-4 accent-brand-light"
          />
          <span>Highlight in booking flow</span>
        </label>
        {isAddon ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="require_has_video"
              defaultChecked={item.require_has_video}
              className="h-4 w-4 accent-brand-light"
            />
            <span>Only when cart has video</span>
          </label>
        ) : (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="is_video"
              defaultChecked={item.is_video}
              className="h-4 w-4 accent-brand-light"
            />
            <span>Counts as video</span>
          </label>
        )}
        <code className="ml-auto text-[10px] text-ink-muted">
          slug: {item.slug}
        </code>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white hover:border-brand-light hover:text-brand-light disabled:opacity-50"
        >
          {pending ? "Saving…" : saved ? "✓ Saved" : "Save"}
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={() => {
            if (
              !confirm(
                `Delete "${item.name}"? This cannot be undone. If any booking references this item, the delete will fail — toggle Active off instead.`,
              )
            ) {
              return;
            }
            setError(null);
            startDeleting(async () => {
              const res = await deleteCatalogItem(item.id);
              if (!res.ok) setError(res.error ?? "Delete failed.");
            });
          }}
          className="rounded-md border border-red-400/30 px-3 py-1.5 text-xs text-red-200 hover:bg-red-400/10 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
        {error ? (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
