"use client";

import { useMemo, useState } from "react";

import type { CartLinePayload } from "@/lib/booking/cart-types";

// Mirror of CatalogItemRow minus server-only-ness. Kept structural so this
// component doesn't pull lib/booking/catalog.ts (which imports server-only).
export interface CatalogItemDTO {
  id: string;
  slug: string;
  name: string;
  description: string;
  duration_minutes: number;
  price_cents: number;
  sqft_pricing_enabled: boolean;
  included_sqft: number | null;
  overage_increment_sqft: number | null;
  overage_price_cents: number | null;
  kind: "bundle" | "a_la_carte" | "addon";
  is_video: boolean;
  require_has_video: boolean;
  display_order: number;
  badge: string | null;
  highlight: boolean;
  ideal_for: string | null;
}

interface Props {
  bundles: CatalogItemDTO[];
  aLaCarte: CatalogItemDTO[];
  addons: CatalogItemDTO[];
  /**
   * Name of a hidden input the parent form can read. The cart is JSON-
   * serialized into this input on every change so the enclosing <form>
   * can post it as FormData.
   */
  hiddenInputName: string;
  /** Optional initial cart — used when the URL carries a pre-filled selection. */
  initialCart?: CartLinePayload[];
  /** When present, mirror the total-minutes number into this named input. */
  totalMinutesInputName?: string;
  /** When present, mirror the total-cents number into this named input. */
  totalCentsInputName?: string;
}

export default function CartPicker({
  bundles,
  aLaCarte,
  addons,
  hiddenInputName,
  initialCart = [],
  totalMinutesInputName,
  totalCentsInputName,
}: Props) {
  const byId = useMemo(() => {
    const m = new Map<string, CatalogItemDTO>();
    for (const it of bundles) m.set(it.id, it);
    for (const it of aLaCarte) m.set(it.id, it);
    for (const it of addons) m.set(it.id, it);
    return m;
  }, [bundles, aLaCarte, addons]);

  const [cart, setCart] = useState<CartLinePayload[]>(initialCart);

  const cartById = useMemo(() => {
    const m = new Map<string, CartLinePayload>();
    for (const line of cart) m.set(line.catalog_item_id, line);
    return m;
  }, [cart]);

  // Totals — recomputed on every cart change.
  const { totalMinutes, totalCents, hasVideo } = useMemo(() => {
    let mins = 0;
    let cents = 0;
    let video = false;
    for (const line of cart) {
      const item = byId.get(line.catalog_item_id);
      if (!item) continue;
      mins += item.duration_minutes * line.quantity;
      cents += item.price_cents * line.quantity;
      if (item.is_video) video = true;
    }
    return { totalMinutes: mins, totalCents: cents, hasVideo: video };
  }, [cart, byId]);

  function selectBundle(id: string | null) {
    setCart((prev) => {
      // Drop any existing bundle, then add the new one at the front.
      const withoutBundle = prev.filter((l) => {
        const it = byId.get(l.catalog_item_id);
        return it?.kind !== "bundle";
      });
      if (!id) return cleanupCart(withoutBundle, byId);
      const item = byId.get(id);
      if (!item) return prev;
      return cleanupCart(
        [
          { catalog_item_id: item.id, slug: item.slug, quantity: 1 },
          ...withoutBundle,
        ],
        byId,
      );
    });
  }

  function setQuantity(id: string, quantity: number) {
    setCart((prev) => {
      const item = byId.get(id);
      if (!item) return prev;
      const idx = prev.findIndex((l) => l.catalog_item_id === id);
      const clamped = Math.max(0, Math.floor(quantity));
      if (clamped === 0) {
        const next = prev.filter((l) => l.catalog_item_id !== id);
        return cleanupCart(next, byId);
      }
      const line: CartLinePayload = {
        catalog_item_id: item.id,
        slug: item.slug,
        quantity: clamped,
      };
      const next = idx === -1 ? [...prev, line] : prev.map((l, i) => (i === idx ? line : l));
      return cleanupCart(next, byId);
    });
  }

  function toggleAddon(id: string) {
    setCart((prev) => {
      const exists = prev.some((l) => l.catalog_item_id === id);
      if (exists) return prev.filter((l) => l.catalog_item_id !== id);
      const item = byId.get(id);
      if (!item) return prev;
      return [...prev, { catalog_item_id: item.id, slug: item.slug, quantity: 1 }];
    });
  }

  const selectedBundleId = useMemo(() => {
    for (const line of cart) {
      const it = byId.get(line.catalog_item_id);
      if (it?.kind === "bundle") return it.id;
    }
    return null;
  }, [cart, byId]);

  // If the cart contains an on-camera addon but no video item, it'll be
  // auto-cleaned by cleanupCart. The visible list of addons also hides ones
  // that require video when no video is present.
  const visibleAddons = addons.filter(
    (a) => !a.require_has_video || hasVideo,
  );

  return (
    <div className="space-y-8">
      {/* Bundles */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Bundles — pick one
        </h3>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {bundles.map((b) => {
            const selected = selectedBundleId === b.id;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => selectBundle(selected ? null : b.id)}
                  aria-pressed={selected}
                  className={
                    "flex w-full flex-col gap-2 rounded-lg border p-4 text-left transition " +
                    (selected
                      ? "border-brand-light bg-brand/10"
                      : "border-white/10 bg-ink-soft/50 hover:border-brand/60 hover:bg-ink-soft")
                  }
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-white">{b.name}</span>
                    <span className="text-sm font-semibold text-brand-light">
                      ${(b.price_cents / 100).toFixed(0)}
                    </span>
                  </div>
                  <span className="text-xs uppercase tracking-wider text-ink-muted">
                    {formatMinutes(b.duration_minutes)}
                  </span>
                  {b.description ? (
                    <p className="whitespace-pre-wrap text-xs text-ink-muted">
                      {b.description}
                    </p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* A-la-carte */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          A-la-carte — add any combination
        </h3>
        <ul className="mt-3 divide-y divide-white/5 rounded-lg border border-white/10 bg-ink-soft/30">
          {aLaCarte.map((a) => {
            const line = cartById.get(a.id);
            const qty = line?.quantity ?? 0;
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    {a.name}
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      {formatMinutes(a.duration_minutes)} · $
                      {(a.price_cents / 100).toFixed(0)}
                    </span>
                  </p>
                  {a.description ? (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink-muted">
                      {a.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQuantity(a.id, qty - 1)}
                    disabled={qty === 0}
                    aria-label={`Decrease ${a.name}`}
                    className="h-7 w-7 rounded-md border border-white/15 text-sm text-white hover:border-brand-light disabled:opacity-30"
                  >
                    −
                  </button>
                  <span
                    aria-live="polite"
                    className="w-6 text-center text-sm text-white"
                  >
                    {qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity(a.id, qty + 1)}
                    aria-label={`Increase ${a.name}`}
                    className="h-7 w-7 rounded-md border border-white/15 text-sm text-white hover:border-brand-light"
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
          {aLaCarte.length === 0 ? (
            <li className="p-4 text-sm text-ink-muted">
              No a-la-carte items configured.
            </li>
          ) : null}
        </ul>
      </section>

      {/* Add-ons — only shown when there's a video item AND at least one addon qualifies */}
      {visibleAddons.length > 0 ? (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Add-ons
          </h3>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {visibleAddons.map((a) => {
              const on = cartById.has(a.id);
              return (
                <li key={a.id}>
                  <label
                    className={
                      "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition " +
                      (on
                        ? "border-brand-light bg-brand/10"
                        : "border-white/10 bg-ink-soft/40 hover:border-brand/40")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleAddon(a.id)}
                      className="mt-0.5 h-4 w-4 accent-brand-light"
                    />
                    <span className="flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-white">{a.name}</span>
                        <span className="text-xs font-semibold text-brand-light">
                          +${(a.price_cents / 100).toFixed(0)}
                        </span>
                      </span>
                      {a.description ? (
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {a.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Totals */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-ink-soft/60 p-4 text-sm text-white">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-ink-muted">
            Total
          </p>
          <p className="text-lg font-semibold">
            ${(totalCents / 100).toFixed(2)}{" "}
            <span className="text-xs font-normal text-ink-muted">
              · {formatMinutes(totalMinutes) || "0 min"}
            </span>
          </p>
        </div>
        {cart.length === 0 ? (
          <p className="text-xs text-ink-muted">
            Pick a bundle or add a-la-carte items to continue.
          </p>
        ) : null}
      </div>

      {/* Hidden inputs the enclosing form submits */}
      <input
        type="hidden"
        name={hiddenInputName}
        value={JSON.stringify(cart)}
      />
      {totalMinutesInputName ? (
        <input type="hidden" name={totalMinutesInputName} value={totalMinutes} />
      ) : null}
      {totalCentsInputName ? (
        <input type="hidden" name={totalCentsInputName} value={totalCents} />
      ) : null}
    </div>
  );
}

function cleanupCart(
  cart: CartLinePayload[],
  byId: Map<string, CatalogItemDTO>,
): CartLinePayload[] {
  // Drop require_has_video addons if no item in the cart is video-flagged.
  const hasVideo = cart.some((l) => {
    const it = byId.get(l.catalog_item_id);
    return it && it.kind !== "addon" && it.is_video;
  });
  if (hasVideo) return cart;
  return cart.filter((l) => {
    const it = byId.get(l.catalog_item_id);
    return !(it?.kind === "addon" && it.require_has_video);
  });
}

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
