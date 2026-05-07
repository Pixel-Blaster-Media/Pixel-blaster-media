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
  const [aLaCarteOpen, setALaCarteOpen] = useState(hasALaCarte);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(
    selectedSlugs[0] ?? null,
  );

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
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-realtor-text">
              Start with a package
            </h3>
            <p className="mt-1 text-sm text-realtor-muted">
              Pick the closest fit. You can open details before choosing, or
              build a custom order below.
            </p>
          </div>
          {hasBundle ? (
            <button
              type="button"
              onClick={() => {
                const withoutBundles = selectedSlugs.filter(
                  (s) => !bundles.some((b) => b.slug === s),
                );
                updateUrl(withoutBundles, selectedAddOnSlugs);
              }}
              className="text-xs text-realtor-muted underline hover:text-realtor-primary"
            >
              Clear package
            </button>
          ) : null}
        </div>

        <ul className="grid gap-3 xl:grid-cols-2">
          {bundles.map((b) => {
            const selected = selectedSlugs.includes(b.slug);
            const expanded = expandedSlug === b.slug || selected;
            return (
              <li key={b.id}>
                <article
                  className={
                    "realtor-package-card flex h-full min-w-0 flex-col rounded-2xl p-4 pl-5 transition " +
                    (selected
                      ? "realtor-package-card-selected"
                      : b.highlight
                        ? "realtor-warm-panel hover:border-realtor-primary"
                        : "realtor-elevated-panel hover:border-realtor-primary/50")
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base font-semibold text-realtor-text">
                          {b.name}
                        </h4>
                        {selected ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-realtor-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                            <span aria-hidden="true">✓</span>
                            Selected
                          </span>
                        ) : b.badge ? (
                          <span className="rounded-full border border-realtor-primary/40 bg-realtor-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-realtor-primary">
                            {b.badge}
                          </span>
                        ) : null}
                      </div>
                      {b.ideal_for ? (
                        <p className="mt-1 text-sm text-realtor-muted">
                          {b.ideal_for}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-realtor-muted">
                          {shortDescription(b.description)}
                        </p>
                      )}
                    </div>
                    <div
                      className={
                        "shrink-0 rounded-xl px-3 py-2 text-right " +
                        (selected ? "bg-realtor-primary/10" : "bg-realtor-surface/60")
                      }
                    >
                      <p className="text-xl font-bold text-realtor-primary">
                        ${(b.price_cents / 100).toFixed(0)}
                      </p>
                      <p className="text-[11px] uppercase tracking-wider text-realtor-muted">
                        {formatMinutes(b.duration_minutes)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <MediaBadges item={b} />
                    {sqftRuleText(b) ? (
                      <span className="rounded-full border border-realtor-primary/15 bg-realtor-soft/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
                        Sqft pricing
                      </span>
                    ) : null}
                  </div>

                  {sqftRuleText(b) ? (
                    <p className="mt-3 rounded-lg border border-realtor-primary/20 bg-realtor-primary/10 px-3 py-2 text-xs font-medium text-realtor-primary">
                      {sqftRuleText(b)}
                    </p>
                  ) : null}

                  {expanded && b.description ? (
                    <PackageDetails item={b} />
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => selectBundle(b.slug)}
                      aria-pressed={selected}
                      className={
                        "rounded-lg px-4 py-2 text-sm font-semibold transition " +
                        (selected
                          ? "border border-realtor-primary/35 bg-realtor-surface text-realtor-primary"
                          : "bg-realtor-primary text-white hover:bg-realtor-primary-light")
                      }
                    >
                      {selected ? "✓ Package selected" : "Choose package"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSlug((current) =>
                          current === b.slug ? null : b.slug,
                        )
                      }
                      className="rounded-lg border border-realtor-primary/15 bg-realtor-surface/70 px-4 py-2 text-sm text-realtor-text hover:border-realtor-primary"
                    >
                      {expanded ? "Hide details" : "View details"}
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </section>

      <AccordionSection
        open={aLaCarteOpen}
        onToggle={() => setALaCarteOpen((v) => !v)}
        title="Build a custom order"
        subtitle={
          hasALaCarte
            ? `${selectedSlugs.filter((s) => aLaCarte.some((a) => a.slug === s)).length} picked`
            : "Choose individual services instead"
        }
        accent={hasALaCarte}
      >
        <ul className="overflow-hidden rounded-xl border border-realtor-primary/15 bg-realtor-surface/80">
          {aLaCarte.map((a) => {
            const selected = selectedSlugs.includes(a.slug);
            const expanded = expandedSlug === a.slug || selected;
            return (
              <li
                key={a.id}
                className={
                  "border-b border-realtor-primary/10 p-3 transition last:border-b-0 " +
                  (selected
                    ? "bg-realtor-primary/10 shadow-[inset_4px_0_0_rgba(49,95,69,0.75)]"
                    : "hover:bg-realtor-primary/5")
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-realtor-text">{a.name}</p>
                      <MediaBadges item={a} />
                      {selected ? (
                        <span className="rounded-full bg-realtor-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                          Added
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-realtor-muted">
                      {a.ideal_for ?? shortDescription(a.description)}
                    </p>
                    {expanded && a.description ? <PackageDetails item={a} /> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="rounded-lg bg-realtor-surface/70 px-2 py-1 text-right">
                      <p className="text-sm font-bold text-realtor-primary">
                        ${(a.price_cents / 100).toFixed(0)}
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-realtor-muted">
                        {formatMinutes(a.duration_minutes)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSlug((current) =>
                          current === a.slug ? null : a.slug,
                        )
                      }
                      className="rounded-md border border-realtor-primary/15 px-3 py-2 text-xs text-realtor-text hover:border-realtor-primary"
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleALaCarte(a.slug)}
                      aria-pressed={selected}
                      className={
                        "min-w-20 rounded-lg px-3 py-2 text-xs font-semibold transition " +
                        (selected
                          ? "border border-realtor-primary/35 bg-realtor-surface text-realtor-primary"
                          : "bg-realtor-primary text-white hover:bg-realtor-primary-light")
                      }
                    >
                      {selected ? "Remove" : "Add"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </AccordionSection>

      {/* Add-ons — auto-reveal when the cart has a video item */}
      {visibleAddons.length > 0 ? (
        <section className="realtor-warm-panel rounded-2xl p-4">
          <div>
            <p className="text-sm font-semibold text-realtor-text">Add-ons</p>
            <p className="mt-1 text-xs text-realtor-muted">
              These appear when they make sense for the services selected.
            </p>
          </div>
          <ul className="mt-3 grid gap-2">
            {visibleAddons.map((a) => {
              const selected = selectedAddOnSlugs.includes(a.slug);
              return (
                <li key={a.id}>
                  <label
                    className={
                      "flex cursor-pointer items-start gap-3 rounded-lg p-3 transition " +
                      (selected
                        ? "realtor-choice-selected"
                        : "realtor-choice hover:border-realtor-primary/50")
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
                        <span className="font-semibold text-realtor-text">
                          {a.name}
                        </span>
                        <span className="font-semibold text-realtor-primary">
                          +${(a.price_cents / 100).toFixed(0)}
                        </span>
                      </div>
                      {a.description ? (
                        <p className="mt-1 text-xs text-realtor-muted">
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
        <div className="sticky bottom-0 -mx-4 mt-4 border-t border-realtor-primary/15 bg-realtor-surface/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:rounded-xl md:border md:bg-realtor-surface/95 md:shadow-lg md:shadow-realtor-primary/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold text-realtor-text">
                ${(totalCents / 100).toFixed(0)}
              </span>
              <span className="text-realtor-muted">
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
      className="rounded-md bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-realtor-primary-light"
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
          className="rounded-full border border-realtor-primary/25 bg-realtor-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-realtor-primary"
        >
          {badge}
        </span>
      ))}
    </span>
  );
}

function PackageDetails({ item }: { item: CatalogItemDTO }) {
  const lines = descriptionLines(item.description);
  return (
    <div className="mt-3 rounded-lg border border-realtor-primary/15 bg-realtor-soft/65 p-3">
      {lines.length > 0 ? (
        <ul className="grid gap-1.5 text-xs text-realtor-muted sm:grid-cols-2">
          {lines.map((line) => (
            <li key={line} className="flex gap-2">
              <span className="mt-0.5 text-realtor-primary">✓</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-realtor-muted">
          Package details will appear here once configured.
        </p>
      )}
    </div>
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
        "rounded-2xl transition " +
        (accent
          ? "realtor-green-panel"
          : "realtor-warm-panel")
      }
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-realtor-primary/5"
      >
        <div>
          <p className="text-sm font-semibold text-realtor-text">{title}</p>
          <p className="text-[11px] uppercase tracking-wider text-realtor-muted">
            {subtitle}
          </p>
        </div>
        <span
          aria-hidden="true"
          className={
            "text-xs text-realtor-muted transition " + (open ? "rotate-180" : "")
          }
        >
          ▾
        </span>
      </button>
      {open ? (
        <div className="border-t border-realtor-primary/10 px-4 pb-4 pt-3">{children}</div>
      ) : null}
    </section>
  );
}

function descriptionLines(description: string): string[] {
  return description
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-•]\s*/, ""))
    .filter(Boolean)
    .slice(0, 8);
}

function shortDescription(description: string): string {
  const first = descriptionLines(description)[0];
  return first ?? "Good fit for a standard real estate media booking.";
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
