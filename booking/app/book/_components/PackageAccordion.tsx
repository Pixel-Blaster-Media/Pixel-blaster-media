"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import type { CatalogItemDTO } from "@/app/_components/CartPicker";
import BookingTotalBar from "./BookingTotalBar";

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
  squareFootage,
}: {
  bundles: CatalogItemDTO[];
  aLaCarte: CatalogItemDTO[];
  addons: CatalogItemDTO[];
  selectedSlugs: string[];
  selectedAddOnSlugs: string[];
  squareFootage: number | null;
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

  const bySlug = useMemo(() => {
    const m = new Map<string, CatalogItemDTO>();
    for (const r of [...bundles, ...aLaCarte, ...addons]) m.set(r.slug, r);
    return m;
  }, [bundles, aLaCarte, addons]);

  const hasVideo = selectedSlugs.some((s) => bySlug.get(s)?.is_video);
  const visibleAddons = addons.filter(
    (a) => !a.require_has_video || hasVideo,
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

  const continueQuery = params.toString();
  const continueHref = continueQuery
    ? `/book/property?${continueQuery}`
    : "/book/property";

  return (
    <div className="space-y-5">
      <section id="packages" className="booking-package-section">
        <div className="booking-section-heading">
          <div>
            <p className="booking-section-kicker">Packages</p>
            <h3>
              Start with the closest fit.
            </h3>
            <p>
              Pick a ready-made package or build a custom booking below.
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
              className="rounded-full border border-realtor-primary/25 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-muted transition hover:border-realtor-primary/50 hover:text-realtor-primary"
            >
              Clear package
            </button>
          ) : null}
        </div>

        <ul className="booking-package-grid">
          {bundles.map((b) => {
            const selected = selectedSlugs.includes(b.slug);
            return (
              <li key={b.id}>
                <article
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  onClick={() => selectBundle(b.slug)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectBundle(b.slug);
                    }
                  }}
                  className={
                    "realtor-package-card booking-package-card flex h-full min-w-0 cursor-pointer flex-col rounded-[1.65rem] border p-4 transition focus:outline-none focus:ring-2 focus:ring-realtor-primary/35 md:p-5 " +
                    (selected
                      ? "realtor-package-card-selected"
                      : b.highlight
                        ? "realtor-package-card-featured"
                        : "")
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base font-semibold text-realtor-text md:text-lg">
                          {b.name}
                        </h4>
                        {b.badge ? (
                          <span className="rounded-full border border-realtor-primary/35 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-realtor-primary">
                            {b.badge}
                          </span>
                        ) : null}
                      </div>
                      {b.ideal_for ? (
                        <p className="mt-1 text-sm leading-6 text-realtor-muted">
                          {b.ideal_for}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm leading-6 text-realtor-muted">
                          {shortDescription(b.description)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-start gap-3">
                      <div className="rounded-2xl bg-white px-3 py-2 text-right ring-1 ring-realtor-primary/20">
                        <p className="text-lg font-semibold text-realtor-text md:text-xl">
                          ${(priceForSqft(b, squareFootage) / 100).toFixed(0)}
                        </p>
                        <p className="text-[11px] uppercase tracking-wider text-realtor-muted">
                          {priceForSqft(b, squareFootage) !== b.price_cents
                            ? `${squareFootage?.toLocaleString()} sqft`
                            : formatMinutes(b.duration_minutes)}
                        </p>
                      </div>
                      <span
                        aria-hidden="true"
                        className={
                          "mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition " +
                          (selected
                            ? "border-realtor-primary bg-realtor-primary text-white shadow-sm"
                            : "border-realtor-primary/35 bg-white text-transparent")
                        }
                      >
                        ✓
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <MediaBadges item={b} />
                    {sqftRuleText(b) ? (
                      <span className="rounded-full border border-realtor-primary/20 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
                        Sqft pricing
                      </span>
                    ) : null}
                    {selected ? (
                      <span className="rounded-full bg-realtor-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm shadow-realtor-primary/20">
                        Selected
                      </span>
                    ) : null}
                  </div>

                  {sqftRuleText(b) ? (
                    <p className="mt-3 rounded-2xl border border-realtor-primary/20 bg-white px-3 py-2 text-xs font-medium text-realtor-text">
                      {sqftRuleText(b)}
                    </p>
                  ) : null}

                  {b.description ? (
                    <PackageDetails item={b} />
                  ) : null}
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
        <ul className="grid gap-2">
          {aLaCarte.map((a) => {
            const selected = selectedSlugs.includes(a.slug);
            return (
              <li key={a.id}>
                <article
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  onClick={() => toggleALaCarte(a.slug)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleALaCarte(a.slug);
                    }
                  }}
                  className={
                    "realtor-service-tile flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition focus:outline-none focus:ring-2 focus:ring-realtor-primary/35 " +
                    (selected ? "realtor-service-tile-selected" : "")
                  }
                >
                  <span
                    aria-hidden="true"
                    className={
                      "mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition " +
                      (selected
                        ? "border-realtor-primary bg-realtor-primary text-white shadow-sm"
                        : "border-realtor-primary/35 bg-white text-transparent")
                    }
                  >
                    ✓
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 pr-2">
                      <p className="font-semibold leading-5 text-realtor-text">
                        {a.name}
                      </p>
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
                  </div>
                  <div className="shrink-0 rounded-2xl bg-white px-3 py-2 text-right ring-1 ring-realtor-primary/20">
                    <p className="text-sm font-semibold text-realtor-text">
                      ${(a.price_cents / 100).toFixed(0)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-realtor-muted">
                      {formatMinutes(a.duration_minutes)}
                    </p>
                  </div>
                </article>
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
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {visibleAddons.map((a) => {
              const selected = selectedAddOnSlugs.includes(a.slug);
              return (
                <li key={a.id}>
                  <label
                    className={
                      "flex h-full cursor-pointer items-start gap-3 rounded-2xl p-3 transition " +
                      (selected
                        ? "realtor-choice-selected"
                        : "realtor-choice hover:border-realtor-primary/50")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleAddon(a.slug)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={
                        "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition " +
                        (selected
                          ? "border-realtor-primary bg-realtor-primary text-white"
                          : "border-realtor-primary/35 bg-white text-transparent")
                      }
                    >
                      ✓
                    </span>
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

      <BookingTotalBar
        items={[...bundles, ...aLaCarte, ...addons]}
        selectedSlugs={selectedSlugs}
        selectedAddOnSlugs={selectedAddOnSlugs}
        squareFootage={squareFootage}
        href={continueHref}
        ctaLabel="Continue"
        note={
          squareFootage
            ? undefined
            : "Square footage adjustments appear after property details."
        }
      />
    </div>
  );
}

function MediaBadges({
  item,
  inverted = false,
}: {
  item: CatalogItemDTO;
  inverted?: boolean;
}) {
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
          className={
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
            (inverted
              ? "border-white/25 bg-white/10 text-white/82"
              : "border-realtor-primary/25 bg-white text-realtor-primary")
          }
        >
          {badge}
        </span>
      ))}
    </span>
  );
}

function PackageDetails({
  item,
  inverted = false,
}: {
  item: CatalogItemDTO;
  inverted?: boolean;
}) {
  const lines = descriptionLines(item.description);
  const content = lines.length > 0 ? (
    <ul
      className={
        "grid gap-1.5 text-xs sm:grid-cols-2 " +
        (inverted ? "text-white/78" : "text-realtor-muted")
      }
    >
      {lines.map((line) => (
        <li key={line} className="flex gap-2">
          <span className={inverted ? "mt-0.5 text-realtor-accent" : "mt-0.5 text-realtor-primary"}>✓</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className={inverted ? "text-xs text-white/72" : "text-xs text-realtor-muted"}>
      Package details will appear here once configured.
    </p>
  );

  const boxClass =
    "booking-package-details mt-3 rounded-2xl border p-3 " +
    (inverted
      ? "border-white/20 bg-white/10"
      : "border-realtor-primary/20 bg-white");

  return (
    <>
      <div className={`${boxClass} hidden md:block`}>{content}</div>
      <details
        className={`${boxClass} md:hidden`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-realtor-primary [&::-webkit-details-marker]:hidden">
          <span>Package details</span>
          <span aria-hidden="true">▾</span>
        </summary>
        <div className="mt-3">{content}</div>
      </details>
    </>
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
          : "realtor-elevated-panel")
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

/**
 * Same overage math as BookingTotalBar/getPrice: once we know the
 * property's square footage (returning from step 2), package cards show
 * the price the realtor will actually pay instead of the base price.
 */
function priceForSqft(item: CatalogItemDTO, squareFootage: number | null): number {
  if (
    !item.sqft_pricing_enabled ||
    !item.included_sqft ||
    !item.overage_increment_sqft ||
    !item.overage_price_cents ||
    !squareFootage ||
    squareFootage <= item.included_sqft
  ) {
    return item.price_cents;
  }
  const overageSqft = squareFootage - item.included_sqft;
  const overageUnits = Math.ceil(overageSqft / item.overage_increment_sqft);
  return item.price_cents + overageUnits * item.overage_price_cents;
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
