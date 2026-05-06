"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import type { CatalogItemDTO } from "@/app/_components/CartPicker";

/**
 * Step 1 picker — two collapsible sections (Bundles, A-La-Carte) plus
 * auto-revealed Add-ons when a video item is selected.
 *
 * State is URL-driven so the "Continue" button can just link to
 * /book/property with the same query params. Each toggle updates
 * `?services=...` / `?add_ons=...` via router.replace (no scroll jump).
 *
 * Why accordion: the Acuity page's 4 bundles + 7 a-la-carte items eat
 * a lot of screen on mobile. Collapsing to two section titles lets
 * someone scan the high-level choice ("bundle vs custom") before
 * drilling in.
 */
export default function PackageAccordion({
  bundles,
  aLaCarte,
  addons,
  selectedSlugs,
  selectedAddOnSlugs,
}: {
  bundles: CatalogItemDTO[];
  aLaCarte: CatalogItemDTO[];
  addons: CatalogItemDTO[];
  selectedSlugs: string[];
  selectedAddOnSlugs: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  // Open-by-default based on what's already picked so a deep-linked
  // user sees their selection without having to click open the section.
  const hasBundle = useMemo(
    () => selectedSlugs.some((s) => bundles.some((b) => b.slug === s)),
    [selectedSlugs, bundles],
  );
  const hasALaCarte = useMemo(
    () => selectedSlugs.some((s) => aLaCarte.some((a) => a.slug === s)),
    [selectedSlugs, aLaCarte],
  );
  const [bundlesOpen, setBundlesOpen] = useState(
    hasBundle || (!hasALaCarte && selectedSlugs.length === 0),
  );
  const [aLaCarteOpen, setALaCarteOpen] = useState(hasALaCarte);

  const bySlug = useMemo(() => {
    const m = new Map<string, CatalogItemDTO>();
    for (const r of [...bundles, ...aLaCarte, ...addons]) m.set(r.slug, r);
    return m;
  }, [bundles, aLaCarte, addons]);

  const hasVideo = selectedSlugs.some((s) => bySlug.get(s)?.is_video);
  const visibleAddons = addons.filter(
    (a) => !a.require_has_video || hasVideo,
  );

  // Totals below the picker.
  const selectedItems = selectedSlugs
    .map((s) => bySlug.get(s))
    .filter((x): x is CatalogItemDTO => !!x);
  const selectedAddons = selectedAddOnSlugs
    .map((s) => bySlug.get(s))
    .filter((x): x is CatalogItemDTO => !!x);
  const totalCents =
    selectedItems.reduce((n, i) => n + i.price_cents, 0) +
    selectedAddons.reduce((n, a) => n + a.price_cents, 0);
  const totalMinutes = Math.max(
    selectedItems.reduce((n, i) => n + i.duration_minutes, 0) +
      selectedAddons.reduce((n, a) => n + a.duration_minutes, 0),
    60,
  );

  function updateUrl(nextServices: string[], nextAddons: string[]) {
    const next = new URLSearchParams(params.toString());
    // Prune addons that no longer qualify after the service change.
    const nextHasVideo = nextServices.some((s) => bySlug.get(s)?.is_video);
    const cleanedAddons = nextAddons.filter((s) => {
      const a = bySlug.get(s);
      return a && (!a.require_has_video || nextHasVideo);
    });
    if (nextServices.length) next.set("services", nextServices.join(","));
    else next.delete("services");
    if (cleanedAddons.length) next.set("add_ons", cleanedAddons.join(","));
    else next.delete("add_ons");
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  function selectBundle(slug: string) {
    // Bundle is mutually exclusive — drop any existing bundle + keep
    // a-la-carte items.
    const withoutBundles = selectedSlugs.filter(
      (s) => !bundles.some((b) => b.slug === s),
    );
    const next =
      selectedSlugs.includes(slug)
        ? withoutBundles // toggle off
        : [slug, ...withoutBundles];
    updateUrl(next, selectedAddOnSlugs);
  }

  function toggleALaCarte(slug: string) {
    const next = selectedSlugs.includes(slug)
      ? selectedSlugs.filter((s) => s !== slug)
      : [...selectedSlugs, slug];
    updateUrl(next, selectedAddOnSlugs);
  }

  function toggleAddon(slug: string) {
    const next = selectedAddOnSlugs.includes(slug)
      ? selectedAddOnSlugs.filter((s) => s !== slug)
      : [...selectedAddOnSlugs, slug];
    updateUrl(selectedSlugs, next);
  }

  return (
    <div className="space-y-4">
      {/* Bundles */}
      <AccordionSection
        open={bundlesOpen}
        onToggle={() => setBundlesOpen((v) => !v)}
        title="Bundles"
        subtitle={
          hasBundle ? "Bundle selected" : `${bundles.length} available`
        }
        accent={hasBundle}
      >
        <ul className="grid gap-3">
          {bundles.map((b) => {
            const selected = selectedSlugs.includes(b.slug);
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => selectBundle(b.slug)}
                  aria-pressed={selected}
                  className={
                    "relative flex w-full flex-col gap-2 rounded-lg border p-4 text-left transition " +
                    (selected
                      ? "border-brand-light bg-brand/10"
                      : b.highlight
                        ? "border-brand/40 bg-brand/5 hover:border-brand-light hover:bg-brand/10"
                        : "border-white/10 bg-ink-soft/50 hover:border-brand/60 hover:bg-ink-soft")
                  }
                >
                  {b.badge ? (
                    <span className="absolute right-3 top-3 rounded-full border border-brand-light/40 bg-brand/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-light">
                      {b.badge}
                    </span>
                  ) : null}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="pr-28 font-semibold text-white">
                      {b.name}
                    </span>
                    <span className="text-sm font-semibold text-brand-light">
                      ${(b.price_cents / 100).toFixed(0)}
                    </span>
                  </div>
                  {b.ideal_for ? (
                    <span className="text-xs text-brand-light/90">
                      Ideal for: {b.ideal_for}
                    </span>
                  ) : null}
                  <span className="text-[11px] uppercase tracking-wider text-ink-muted">
                    {formatMinutes(b.duration_minutes)}
                  </span>
                  <MediaBadges item={b} />
                  {sqftRuleText(b) ? (
                    <span className="rounded-md border border-brand-light/20 bg-brand/10 px-2 py-1 text-[11px] text-brand-light">
                      {sqftRuleText(b)}
                    </span>
                  ) : null}
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
      </AccordionSection>

      {/* A-La-Carte */}
      <AccordionSection
        open={aLaCarteOpen}
        onToggle={() => setALaCarteOpen((v) => !v)}
        title="A-La-Carte"
        subtitle={
          hasALaCarte
            ? `${selectedSlugs.filter((s) => aLaCarte.some((a) => a.slug === s)).length} picked`
            : `${aLaCarte.length} options`
        }
        accent={hasALaCarte}
      >
        <ul className="grid gap-3">
          {aLaCarte.map((a) => {
            const selected = selectedSlugs.includes(a.slug);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => toggleALaCarte(a.slug)}
                  aria-pressed={selected}
                  className={
                    "relative flex w-full flex-col gap-2 rounded-lg border p-4 text-left transition " +
                    (selected
                      ? "border-brand-light bg-brand/10"
                      : a.highlight
                        ? "border-brand/40 bg-brand/5 hover:border-brand-light hover:bg-brand/10"
                        : "border-white/10 bg-ink-soft/50 hover:border-brand/60 hover:bg-ink-soft")
                  }
                >
                  {a.badge ? (
                    <span className="absolute right-3 top-3 rounded-full border border-brand-light/40 bg-brand/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-light">
                      {a.badge}
                    </span>
                  ) : null}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="pr-28 font-semibold text-white">
                      {a.name}
                    </span>
                    <span className="text-sm font-semibold text-brand-light">
                      ${(a.price_cents / 100).toFixed(0)}
                    </span>
                  </div>
                  {a.ideal_for ? (
                    <span className="text-xs text-brand-light/90">
                      Ideal for: {a.ideal_for}
                    </span>
                  ) : null}
                  <span className="text-[11px] uppercase tracking-wider text-ink-muted">
                    {formatMinutes(a.duration_minutes)}
                  </span>
                  <MediaBadges item={a} />
                  {sqftRuleText(a) ? (
                    <span className="rounded-md border border-brand-light/20 bg-brand/10 px-2 py-1 text-[11px] text-brand-light">
                      {sqftRuleText(a)}
                    </span>
                  ) : null}
                  {a.description ? (
                    <p className="whitespace-pre-wrap text-xs text-ink-muted">
                      {a.description}
                    </p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </AccordionSection>

      {/* Add-ons — auto-reveal when the cart has a video item */}
      {visibleAddons.length > 0 ? (
        <section className="rounded-lg border border-white/10 bg-ink-soft/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Add-ons
          </p>
          <ul className="mt-3 grid gap-2">
            {visibleAddons.map((a) => {
              const selected = selectedAddOnSlugs.includes(a.slug);
              return (
                <li key={a.id}>
                  <label
                    className={
                      "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition " +
                      (selected
                        ? "border-brand-light bg-brand/10"
                        : "border-white/10 hover:border-brand/60")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleAddon(a.slug)}
                      className="mt-1 h-4 w-4 accent-brand"
                    />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-white">
                          {a.name}
                        </span>
                        <span className="font-semibold text-brand-light">
                          +${(a.price_cents / 100).toFixed(0)}
                        </span>
                      </div>
                      {a.description ? (
                        <p className="mt-1 text-xs text-ink-muted">
                          {a.description}
                        </p>
                      ) : null}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Totals + continue */}
      {selectedSlugs.length > 0 ? (
        <div className="sticky bottom-0 -mx-4 mt-4 border-t border-white/10 bg-ink/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:rounded-lg md:border md:bg-brand/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold text-white">
                ${(totalCents / 100).toFixed(0)}
              </span>
              <span className="text-ink-muted">
                {" · "}~{totalMinutes} min on-site
              </span>
            </div>
            <ContinueButton />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ContinueButton() {
  const params = useSearchParams();
  const qs = params.toString();
  const href = qs ? `/book/property?${qs}` : "/book/property";
  // Use a plain link for instant nav; Next.js handles the transition.
  return (
    <a
      href={href}
      className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-light"
    >
      Continue →
    </a>
  );
}

function MediaBadges({ item }: { item: CatalogItemDTO }) {
  const badges = [
    item.is_photo ? "Photos" : null,
    item.is_video ? "Video" : null,
  ].filter((badge): badge is string => Boolean(badge));
  if (badges.length === 0) return null;

  return (
    <span className="flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded-full border border-brand-light/25 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-light"
        >
          {badge}
        </span>
      ))}
    </span>
  );
}

function AccordionSection({
  title,
  subtitle,
  open,
  accent,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  accent: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className={
        "rounded-xl border transition " +
        (accent
          ? "border-brand/30 bg-brand/5"
          : "border-white/10 bg-ink-soft/40")
      }
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-white/[0.03]"
      >
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-[11px] uppercase tracking-wider text-ink-muted">
            {subtitle}
          </p>
        </div>
        <span
          aria-hidden="true"
          className={
            "text-xs text-ink-muted transition " + (open ? "rotate-180" : "")
          }
        >
          ▾
        </span>
      </button>
      {open ? (
        <div className="border-t border-white/5 px-4 pb-4 pt-3">{children}</div>
      ) : null}
    </section>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${Math.floor(hours)}h ${minutes % 60}min`;
}

function sqftRuleText(item: CatalogItemDTO): string | null {
  if (
    !item.sqft_pricing_enabled ||
    !item.included_sqft ||
    !item.overage_increment_sqft ||
    !item.overage_price_cents
  ) {
    return null;
  }
  return `Includes ${item.included_sqft.toLocaleString()} sqft; +$${(
    item.overage_price_cents / 100
  ).toFixed(0)} per ${item.overage_increment_sqft.toLocaleString()} sqft after.`;
}
