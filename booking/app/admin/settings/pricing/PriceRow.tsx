"use client";

import { useState, useTransition, type ReactNode } from "react";

import type { CatalogItemRow } from "@/lib/booking/catalog";

import { deleteCatalogItem, updateCatalogItem } from "./actions";

export default function CatalogItemEditor({ item }: { item: CatalogItemRow }) {
  const [open, setOpen] = useState(false);
  const [pending, startPending] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isAddon = item.kind === "addon";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-white">
              {item.name}
            </span>
            {!item.active ? <Pill tone="muted">Inactive</Pill> : null}
            {item.badge ? <Pill>{item.badge}</Pill> : null}
            {item.is_photo ? <Pill>Photos</Pill> : null}
            {item.is_video ? <Pill>Video</Pill> : null}
            {item.require_has_video ? <Pill>Video add-on</Pill> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
            <span>{formatMoney(item.price_cents)}</span>
            <span>{formatMinutes(item.duration_minutes)}</span>
            {sqftSummary(item) ? <span>{sqftSummary(item)}</span> : null}
            <span>Order {item.display_order}</span>
          </div>
          {item.ideal_for ? (
            <p className="mt-1 truncate text-xs text-brand-light/85">
              {item.ideal_for}
            </p>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="self-start rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:border-brand-light hover:text-brand-light md:self-center"
        >
          {open ? "Hide details" : "Edit details"}
        </button>
      </div>

      {open ? (
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
          className="space-y-3 border-t border-white/10 pt-4"
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
            className="rounded-xl border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
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
              className="w-full rounded-xl border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white md:w-24"
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
              className="w-full rounded-xl border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white md:w-20"
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
            className="w-full rounded-xl border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white md:w-16"
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
          className="w-full rounded-xl border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            Marketing badge
          </span>
          <input
            name="badge"
            defaultValue={item.badge ?? ""}
            placeholder="Most popular"
            className="rounded-xl border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
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
            className="rounded-xl border border-white/10 bg-ink-soft px-2 py-1.5 text-sm text-white"
          />
        </label>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
        <p className="text-[10px] uppercase tracking-wider text-ink-muted">
          Booking-card labels
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">
          These are just visual labels on the booking page. They do not upload
          or deliver media.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-muted">
          {isAddon ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="require_has_video"
                defaultChecked={item.require_has_video}
                className="h-4 w-4 accent-brand-light"
              />
              <span>Only show this add-on when video is selected</span>
            </label>
          ) : (
            <>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_photo"
                  defaultChecked={item.is_photo}
                  className="h-4 w-4 accent-brand-light"
                />
                <span>Show Photos label</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_video"
                  defaultChecked={item.is_video}
                  className="h-4 w-4 accent-brand-light"
                />
                <span>Show Video label</span>
              </label>
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
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
              className="rounded-xl border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
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
              className="rounded-xl border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
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
                className="w-full rounded-xl border border-white/10 bg-ink-soft px-2 py-1.5 text-right text-sm text-white"
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
        <code className="ml-auto text-[10px] text-ink-muted">
          slug: {item.slug}
        </code>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white hover:border-brand-light hover:text-brand-light disabled:opacity-50"
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
          className="rounded-full border border-red-400/30 px-3 py-1.5 text-xs text-red-200 hover:bg-red-400/10 disabled:opacity-50"
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
      ) : null}
    </div>
  );
}

function Pill({
  children,
  tone = "brand",
}: {
  children: ReactNode;
  tone?: "brand" | "muted";
}) {
  return (
    <span
      className={
        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
        (tone === "muted"
          ? "border-white/10 bg-white/5 text-ink-muted"
          : "border-brand-light/30 bg-brand/10 text-brand-light")
      }
    >
      {children}
    </span>
  );
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "No added time";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function sqftSummary(item: CatalogItemRow): string | null {
  if (
    !item.sqft_pricing_enabled ||
    !item.included_sqft ||
    !item.overage_increment_sqft ||
    !item.overage_price_cents
  ) {
    return null;
  }

  return `Includes ${item.included_sqft.toLocaleString()} sqft, then +${formatMoney(
    item.overage_price_cents,
  )}/${item.overage_increment_sqft.toLocaleString()} sqft`;
}
