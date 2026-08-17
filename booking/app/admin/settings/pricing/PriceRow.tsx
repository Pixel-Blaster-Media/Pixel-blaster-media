"use client";

import { useState, useTransition, type ReactNode } from "react";

import type { CatalogItemRow } from "@/lib/booking/catalog";
import type {
  CatalogItemExampleAdminRow,
  ReusableCatalogVideo,
} from "@/lib/booking/catalog-examples";

import { deleteCatalogItem, updateCatalogItem } from "./actions";
import CatalogExamplesEditor from "./CatalogExamplesEditor";

export default function CatalogItemEditor({
  item,
  examples,
  reusableVideos,
  streamConfigured,
}: {
  item: CatalogItemRow;
  examples: CatalogItemExampleAdminRow[];
  reusableVideos: ReusableCatalogVideo[];
  streamConfigured: boolean;
}) {
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
            <span className="text-base font-semibold text-realtor-text">
              {item.name}
            </span>
            {!item.active ? <Pill tone="muted">Inactive</Pill> : null}
            {item.badge ? <Pill>{item.badge}</Pill> : null}
            {item.is_photo ? <Pill>Photos</Pill> : null}
            {item.is_video ? <Pill>Video</Pill> : null}
            {item.require_has_video ? <Pill>Video add-on</Pill> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-realtor-muted">
            <span>{formatMoney(item.price_cents)}</span>
            <span>{formatMinutes(item.duration_minutes)}</span>
            {sqftSummary(item) ? <span>{sqftSummary(item)}</span> : null}
            <span>Order {item.display_order}</span>
          </div>
          {item.ideal_for ? (
            <p className="mt-1 truncate text-xs text-realtor-primary/85">
              {item.ideal_for}
            </p>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="tap-target self-start rounded-full border border-realtor-primary/20 px-3 py-1.5 text-xs font-semibold text-realtor-text hover:border-realtor-primary/40 hover:text-realtor-primary md:self-center"
        >
          {open ? "Hide details" : "Edit details"}
        </button>
      </div>

      {open ? (
        <>
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
          className="space-y-3 border-t border-realtor-primary/15 pt-4"
        >
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="kind" value={item.kind} />

      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-realtor-muted">
            Name
          </span>
          <input
            name="name"
            defaultValue={item.name}
            required
            className="rounded-xl border border-realtor-primary/15 bg-realtor-surface px-2 py-1.5 text-sm text-realtor-text"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-realtor-muted">
            Price
          </span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-realtor-muted">$</span>
            <input
              name="price_dollars"
              type="number"
              min={0}
              step="0.01"
              defaultValue={(item.price_cents / 100).toFixed(2)}
              className="w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-2 py-1.5 text-right text-sm text-realtor-text md:w-24"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-realtor-muted">
            Duration
          </span>
          <div className="flex items-center gap-1">
            <input
              name="duration_minutes"
              type="number"
              min={0}
              step="1"
              defaultValue={item.duration_minutes}
              className="w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-2 py-1.5 text-right text-sm text-realtor-text md:w-20"
            />
            <span className="text-xs text-realtor-muted">min</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-realtor-muted">
            Order
          </span>
          <input
            name="display_order"
            type="number"
            min={0}
            step="1"
            defaultValue={item.display_order}
            className="w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-2 py-1.5 text-right text-sm text-realtor-text md:w-16"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-realtor-muted">
          Description (shown on the booking form — supports line breaks and
          bullet-style dashes)
        </span>
        <textarea
          name="description"
          defaultValue={item.description}
          rows={4}
          className="w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-2 py-1.5 text-sm text-realtor-text"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-realtor-muted">
            Marketing badge
          </span>
          <input
            name="badge"
            defaultValue={item.badge ?? ""}
            placeholder="Most popular"
            className="rounded-xl border border-realtor-primary/15 bg-realtor-surface px-2 py-1.5 text-sm text-realtor-text"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-realtor-muted">
            Ideal for
          </span>
          <input
            name="ideal_for"
            defaultValue={item.ideal_for ?? ""}
            placeholder="Standard listings, luxury homes, social-first launches…"
            className="rounded-xl border border-realtor-primary/15 bg-realtor-surface px-2 py-1.5 text-sm text-realtor-text"
          />
        </label>
      </div>


      <div className="rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
        <p className="text-[10px] uppercase tracking-wider text-realtor-muted">
          Booking-card labels
        </p>
        <p className="mt-1 text-[11px] text-realtor-muted">
          These are just visual labels on the booking page. They do not upload
          or deliver media.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-realtor-muted">
          {isAddon ? (
            <>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_aerial"
                  defaultChecked={item.is_aerial}
                  className="h-4 w-4 accent-realtor-primary"
                />
                <span>This add-on provides aerial coverage</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="require_has_video"
                  defaultChecked={item.require_has_video}
                  className="h-4 w-4 accent-realtor-primary"
                />
                <span>Only show when video is selected</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="require_has_media"
                  defaultChecked={item.require_has_media}
                  className="h-4 w-4 accent-realtor-primary"
                />
                <span>Only show with photos, iGUIDE, or video</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="require_has_iguide"
                  defaultChecked={item.require_has_iguide}
                  className="h-4 w-4 accent-realtor-primary"
                />
                <span>Only show when iGUIDE is selected</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="exclude_has_aerial"
                  defaultChecked={item.exclude_has_aerial}
                  className="h-4 w-4 accent-realtor-primary"
                />
                <span>Hide when aerial coverage is already included</span>
              </label>
            </>
          ) : (
            <>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_photo"
                  defaultChecked={item.is_photo}
                  className="h-4 w-4 accent-realtor-primary"
                />
                <span>Show Photos label</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_video"
                  defaultChecked={item.is_video}
                  className="h-4 w-4 accent-realtor-primary"
                />
                <span>Show Video label</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_iguide"
                  defaultChecked={item.is_iguide}
                  className="h-4 w-4 accent-realtor-primary"
                />
                <span>Includes iGUIDE</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_aerial"
                  defaultChecked={item.is_aerial}
                  className="h-4 w-4 accent-realtor-primary"
                />
                <span>Includes aerial coverage</span>
              </label>
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
        <label className="flex items-center gap-2 text-xs text-realtor-muted">
          <input
            type="checkbox"
            name="sqft_pricing_enabled"
            defaultChecked={item.sqft_pricing_enabled}
            className="h-4 w-4 accent-realtor-primary"
          />
          <span>Charge square-footage overage</span>
        </label>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-realtor-muted">
              Included sqft
            </span>
            <input
              name="included_sqft"
              type="number"
              min={1}
              step="1"
              defaultValue={item.included_sqft ?? ""}
              placeholder="2500"
              className="rounded-xl border border-realtor-primary/15 bg-realtor-surface px-2 py-1.5 text-right text-sm text-realtor-text"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-realtor-muted">
              Extra sqft step
            </span>
            <input
              name="overage_increment_sqft"
              type="number"
              min={1}
              step="1"
              defaultValue={item.overage_increment_sqft ?? ""}
              placeholder="500"
              className="rounded-xl border border-realtor-primary/15 bg-realtor-surface px-2 py-1.5 text-right text-sm text-realtor-text"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-realtor-muted">
              Price per step
            </span>
            <div className="flex items-center gap-1">
              <span className="text-xs text-realtor-muted">$</span>
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
                className="w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-2 py-1.5 text-right text-sm text-realtor-text"
              />
            </div>
          </label>
        </div>
        <p className="mt-2 text-[11px] text-realtor-muted">
          Example: $200 includes 2,500 sqft, then +$40 every 500 sqft.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-realtor-muted">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="active"
            defaultChecked={item.active}
            className="h-4 w-4 accent-realtor-primary"
          />
          <span>Active</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="taxable"
            defaultChecked={item.taxable}
            className="h-4 w-4 accent-realtor-primary"
          />
          <span>Taxable</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="highlight"
            defaultChecked={item.highlight}
            className="h-4 w-4 accent-realtor-primary"
          />
          <span>Highlight in booking flow</span>
        </label>
        <code className="ml-auto text-[10px] text-realtor-muted">
          slug: {item.slug}
        </code>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="tap-target rounded-full border border-realtor-primary/20 px-3 py-1.5 text-xs text-realtor-text hover:border-realtor-primary/40 hover:text-realtor-primary disabled:opacity-50"
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
          className="tap-target rounded-full border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
        {error ? (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        ) : null}
      </div>
        </form>
        <CatalogExamplesEditor
          catalogItemId={item.id}
          examples={examples}
          reusableVideos={reusableVideos}
          streamConfigured={streamConfigured}
        />
        </>
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
          ? "border-realtor-primary/15 bg-white/65 text-realtor-muted"
          : "border-realtor-primary/30 bg-realtor-primary/10 text-realtor-primary")
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
