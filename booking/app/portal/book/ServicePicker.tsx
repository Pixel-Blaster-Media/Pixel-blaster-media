"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";

import type { CatalogItemDTO } from "@/app/_components/CartPicker";

/**
 * Catalog-driven picker for /portal/book. URL-driven so slots can re-
 * fetch server-side on change.
 *
 *   ?services=blue_print,interior_retakes&add_ons=on_camera
 *
 * For v1 self-serve: bundle = single-select (mutually exclusive), a-la-
 * carte = multi-toggle (no quantity), add-ons = toggle (gated on video).
 * Quantities ship when we rework the flow to a cart URL param.
 */
export default function ServicePicker({
  selectedSlugs,
  selectedAddOnSlugs,
  bundles,
  aLaCarte,
  addons,
}: {
  selectedSlugs: string[];
  selectedAddOnSlugs: string[];
  bundles: CatalogItemDTO[];
  aLaCarte: CatalogItemDTO[];
  addons: CatalogItemDTO[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const bundleBySlug = useMemo(() => {
    const m = new Map<string, CatalogItemDTO>();
    for (const b of bundles) m.set(b.slug, b);
    return m;
  }, [bundles]);
  const aLaCarteBySlug = useMemo(() => {
    const m = new Map<string, CatalogItemDTO>();
    for (const a of aLaCarte) m.set(a.slug, a);
    return m;
  }, [aLaCarte]);

  const hasVideo = useMemo(() => {
    return selectedSlugs.some(
      (s) =>
        bundleBySlug.get(s)?.is_video || aLaCarteBySlug.get(s)?.is_video,
    );
  }, [selectedSlugs, bundleBySlug, aLaCarteBySlug]);

  const visibleAddons = addons.filter(
    (a) => !a.require_has_video || hasVideo,
  );

  function updateUrl(nextServices: string[], nextAddons: string[]) {
    const next = new URLSearchParams(params.toString());
    // Prune addons that no longer qualify after the service change.
    const videoAfter = nextServices.some(
      (s) =>
        bundleBySlug.get(s)?.is_video || aLaCarteBySlug.get(s)?.is_video,
    );
    const cleanedAddons = nextAddons.filter((slug) => {
      const addon = addons.find((a) => a.slug === slug);
      if (!addon) return false;
      return !addon.require_has_video || videoAfter;
    });

    if (nextServices.length > 0) next.set("services", nextServices.join(","));
    else next.delete("services");
    if (cleanedAddons.length > 0) next.set("add_ons", cleanedAddons.join(","));
    else next.delete("add_ons");
    // Slot must be re-picked when duration changes.
    next.delete("slot");
    startTransition(() => {
      router.replace(`?${next.toString()}`, { scroll: false });
    });
  }

  function selectBundle(slug: string) {
    // Keep non-bundle selections; replace any existing bundle with this one
    // (or clear it if the same bundle is re-clicked).
    const nonBundle = selectedSlugs.filter((s) => !bundleBySlug.has(s));
    const currentBundle = selectedSlugs.find((s) => bundleBySlug.has(s));
    const nextBundles = currentBundle === slug ? [] : [slug];
    updateUrl([...nextBundles, ...nonBundle], selectedAddOnSlugs);
  }

  function toggleALaCarte(slug: string) {
    const on = selectedSlugs.includes(slug);
    const next = on
      ? selectedSlugs.filter((s) => s !== slug)
      : [...selectedSlugs, slug];
    updateUrl(next, selectedAddOnSlugs);
  }

  function toggleAddon(slug: string) {
    const on = selectedAddOnSlugs.includes(slug);
    const next = on
      ? selectedAddOnSlugs.filter((s) => s !== slug)
      : [...selectedAddOnSlugs, slug];
    updateUrl(selectedSlugs, next);
  }

  const selectedBundleSlug = selectedSlugs.find((s) => bundleBySlug.has(s));

  return (
    <div className={isPending ? "opacity-60" : ""}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Bundles
        </p>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {bundles.map((b) => {
            const on = selectedBundleSlug === b.slug;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => selectBundle(b.slug)}
                  aria-pressed={on}
                  className={
                    "flex w-full items-baseline justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition " +
                    (on
                      ? "border-brand-light bg-brand/15 text-brand-light"
                      : "border-white/15 text-white/80 hover:border-white/40")
                  }
                  title={b.description}
                >
                  <span className="truncate font-semibold">{b.name}</span>
                  <span className="text-xs opacity-80">
                    ${(b.price_cents / 100).toFixed(0)} · {b.duration_minutes}m
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          A-la-carte
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {aLaCarte.map((a) => {
            const on = selectedSlugs.includes(a.slug);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => toggleALaCarte(a.slug)}
                  aria-pressed={on}
                  className={
                    "rounded-full border px-4 py-2 text-sm transition " +
                    (on
                      ? "border-brand-light bg-brand/20 text-brand-light"
                      : "border-white/15 text-white/80 hover:border-white/40")
                  }
                  title={a.description}
                >
                  {a.name}
                  <span className="ml-2 text-[10px] opacity-70">
                    ${(a.price_cents / 100).toFixed(0)} · {a.duration_minutes}m
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {visibleAddons.length > 0 ? (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Add-ons
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {visibleAddons.map((a) => {
              const on = selectedAddOnSlugs.includes(a.slug);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => toggleAddon(a.slug)}
                    aria-pressed={on}
                    className={
                      "rounded-md border px-3 py-1.5 text-xs transition " +
                      (on
                        ? "border-brand-light bg-brand/15 text-brand-light"
                        : "border-white/10 text-white/70 hover:border-white/30")
                    }
                    title={a.description}
                  >
                    {a.name}
                    <span className="ml-1.5 opacity-70">
                      +${(a.price_cents / 100).toFixed(0)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
