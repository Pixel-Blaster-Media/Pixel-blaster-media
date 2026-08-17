"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  CatalogItemDTO,
  CatalogItemExampleDTO,
} from "@/lib/booking/catalog-dto";
import { isAddonEligible } from "@/lib/booking/catalog-rules";
import BookingTotalBar from "./BookingTotalBar";
import {
  findCommonPackageLines,
  packageDescriptionLines,
  withoutCommonPackageLines,
} from "./package-description";

/**
 * Step 1 picker — two collapsible sections (Bundles, A-La-Carte) plus
 * auto-revealed Add-ons when the selected services satisfy their rules.
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
  const [exampleItem, setExampleItem] = useState<CatalogItemDTO | null>(null);

  const bySlug = useMemo(() => {
    const m = new Map<string, CatalogItemDTO>();
    for (const r of [...bundles, ...aLaCarte, ...addons]) m.set(r.slug, r);
    return m;
  }, [bundles, aLaCarte, addons]);

  const selectedServices = selectedSlugs
    .map((slug) => bySlug.get(slug))
    .filter((item): item is CatalogItemDTO => Boolean(item));
  // isCatalogAddonEligible is the server-side name for this same shared rule.
  const visibleAddons = addons.filter((addon) =>
    isAddonEligible(addon, selectedServices),
  );
  const commonPackageLines = useMemo(
    () => findCommonPackageLines(bundles.map((bundle) => bundle.description)),
    [bundles],
  );

  function updateUrl(nextServices: string[], nextAddons: string[]) {
    const next = new URLSearchParams(params.toString());
    // Prune addons that no longer qualify after the service change.
    const nextSelectedServices = nextServices
      .map((slug) => bySlug.get(slug))
      .filter((item): item is CatalogItemDTO => Boolean(item));
    const cleanedAddons = nextAddons.filter((s) => {
      const a = bySlug.get(s);
      return a && isAddonEligible(a, nextSelectedServices);
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

        {commonPackageLines.length > 0 ? (
          <aside className="mb-4 border-y border-realtor-primary/12 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
              Every package includes
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-realtor-muted">
              {commonPackageLines.map((line) => (
                <li key={line} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="text-realtor-primary">✓</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}

        <ul className="booking-package-grid">
          {bundles.map((b) => {
            const selected = selectedSlugs.includes(b.slug);
            const uniquePackageLines = withoutCommonPackageLines(
              b.description,
              commonPackageLines,
            );
            return (
              <li key={b.id}>
                <article
                  onClick={() => selectBundle(b.slug)}
                  className={
                    "realtor-package-card booking-package-card flex h-full min-w-0 cursor-pointer flex-col rounded-[1.65rem] border p-4 transition md:p-5 " +
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
                          {uniquePackageLines[0] ??
                            "A practical fit for a standard real estate listing."}
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
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${selected ? "Selected" : "Select"} ${b.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectBundle(b.slug);
                        }}
                        className={
                          "mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-realtor-primary/35 " +
                          (selected
                            ? "border-realtor-primary bg-realtor-primary text-white shadow-sm"
                            : "border-realtor-primary/35 bg-white text-transparent")
                        }
                      >
                        ✓
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <MediaBadges item={b} />
                    <ViewExampleButton
                      item={b}
                      onOpen={() => setExampleItem(b)}
                    />
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

                  {uniquePackageLines.length > 0 ? (
                    <PackageDetails lines={uniquePackageLines} />
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
                  onClick={() => toggleALaCarte(a.slug)}
                  className={
                    "realtor-service-tile flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition " +
                    (selected ? "realtor-service-tile-selected" : "")
                  }
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${selected ? "Remove" : "Add"} ${a.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleALaCarte(a.slug);
                    }}
                    className={
                      "mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-realtor-primary/35 " +
                      (selected
                        ? "border-realtor-primary bg-realtor-primary text-white shadow-sm"
                        : "border-realtor-primary/35 bg-white text-transparent")
                    }
                  >
                    ✓
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 pr-2">
                      <p className="font-semibold leading-5 text-realtor-text">
                        {a.name}
                      </p>
                      <MediaBadges item={a} />
                      <ViewExampleButton
                        item={a}
                        onOpen={() => setExampleItem(a)}
                      />
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

      {/* Add-ons auto-reveal when the selected services satisfy their rules. */}
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
                  <article
                    onClick={() => toggleAddon(a.slug)}
                    className={
                      "flex h-full cursor-pointer items-start gap-3 rounded-2xl p-3 transition " +
                      (selected
                        ? "realtor-choice-selected"
                        : "realtor-choice hover:border-realtor-primary/50")
                    }
                  >

                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${selected ? "Remove" : "Add"} ${a.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleAddon(a.slug);
                      }}
                      className={
                        "mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition focus:outline-none focus:ring-2 focus:ring-realtor-primary/35 " +
                        (selected
                          ? "border-realtor-primary bg-realtor-primary text-white"
                          : "border-realtor-primary/35 bg-white text-transparent")
                      }
                    >
                      ✓
                    </button>
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
                      {a.examples.length > 0 ? <div className="mt-2">
                        <ViewExampleButton
                          item={a}
                          onOpen={() => setExampleItem(a)}
                        />
                      </div> : null}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {exampleItem ? (
        <ExampleViewer
          key={exampleItem.id}
          item={exampleItem}
          onClose={() => setExampleItem(null)}
        />
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

function ViewExampleButton({
  item,
  onOpen,
}: {
  item: CatalogItemDTO;
  onOpen: () => void;
}) {
  if (item.examples.length === 0) return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="tap-target inline-flex items-center gap-1 rounded-full border border-realtor-primary/25 bg-white px-2.5 py-1 text-[11px] font-semibold text-realtor-primary transition hover:border-realtor-primary/50 hover:bg-realtor-primary/5"
    >
      <span aria-hidden="true">▶</span>
      {item.examples.length === 1 ? "View example" : "View examples"}
    </button>
  );
}

function ExampleViewer({
  item,
  onClose,
}: {
  item: CatalogItemDTO;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDialogElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [selectedId, setSelectedId] = useState(item.examples[0]?.id ?? "");
  const selected =
    item.examples.find((example) => example.id === selectedId) ?? item.examples[0];

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        if (focusable.length === 0) {
          event.preventDefault();
          dialogRef.current?.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyboard);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!modalRef.current?.open) modalRef.current?.showModal();
    requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", handleKeyboard);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, []);

  if (!selected) return null;
  return (
    <dialog
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="catalog-example-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 !m-0 h-dvh max-h-none w-full max-w-none items-center justify-center bg-transparent p-4 open:flex backdrop:bg-realtor-text/55 backdrop:backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="max-h-[92dvh] w-full max-w-3xl overscroll-contain overflow-y-auto rounded-[1.75rem] bg-realtor-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-primary">
              {item.name}
            </p>
            <h2 id="catalog-example-title" className="mt-1 text-xl font-semibold text-realtor-text">
              {selected.title}
            </h2>
            {selected.description ? (
              <p className="mt-1 text-sm text-realtor-muted">{selected.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close example"
            className="tap-target flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-realtor-primary/20 bg-white text-xl text-realtor-text"
          >
            ×
          </button>
        </div>

        {item.examples.length > 1 ? (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Available examples">
            {item.examples.map((example) => (
              <button
                key={example.id}
                id={`catalog-example-tab-${example.id}`}
                type="button"
                role="tab"
                aria-selected={example.id === selected.id}
                aria-controls={`catalog-example-panel-${example.id}`}
                tabIndex={example.id === selected.id ? 0 : -1}
                onClick={() => setSelectedId(example.id)}
                onKeyDown={(event) => {
                  const current = item.examples.findIndex((candidate) => candidate.id === example.id);
                  let next = current;
                  if (event.key === "ArrowRight") next = (current + 1) % item.examples.length;
                  else if (event.key === "ArrowLeft") next = (current - 1 + item.examples.length) % item.examples.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = item.examples.length - 1;
                  else return;
                  event.preventDefault();
                  const nextExample = item.examples[next];
                  if (!nextExample) return;
                  setSelectedId(nextExample.id);
                  requestAnimationFrame(() => {
                    document.getElementById(`catalog-example-tab-${nextExample.id}`)?.focus();
                  });
                }}
                className={
                  "tap-target shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition " +
                  (example.id === selected.id
                    ? "border-realtor-primary bg-realtor-primary text-white"
                    : "border-realtor-primary/20 bg-white text-realtor-text")
                }
              >
                {example.title}
              </button>
            ))}
          </div>
        ) : null}

        <ExampleFrame example={selected} hasTabs={item.examples.length > 1} />
      </section>
    </dialog>
  );
}

function ExampleFrame({
  example,
  hasTabs,
}: {
  example: CatalogItemExampleDTO;
  hasTabs: boolean;
}) {
  const embedUrl = example.embed_url;
  const trustedEmbed = embedUrl ? trustedExampleEmbed(embedUrl) : false;
  return (
    <div className="mt-4">
      {embedUrl ? (
        <div
          id={`catalog-example-panel-${example.id}`}
          role="tabpanel"
          aria-labelledby={hasTabs ? `catalog-example-tab-${example.id}` : undefined}
          aria-label={hasTabs ? undefined : example.title}
          className="relative aspect-video overflow-hidden rounded-2xl bg-black shadow-inner"
        >
          <iframe
            key={example.id}
            src={embedUrl}
            title={example.title}
            className="absolute inset-0 h-full w-full border-0"
            loading="lazy"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox={
              trustedEmbed
                ? "allow-forms allow-popups allow-presentation allow-same-origin allow-scripts"
                : "allow-presentation allow-scripts"
            }
          />
        </div>
      ) : (
        <div
          id={`catalog-example-panel-${example.id}`}
          role="tabpanel"
          aria-labelledby={hasTabs ? `catalog-example-tab-${example.id}` : undefined}
          aria-label={hasTabs ? undefined : example.title}
          className="rounded-2xl border border-realtor-primary/15 bg-white p-5 text-sm text-realtor-muted"
        >
          This example opens on the provider’s website. Your booking selections will remain here.
        </div>
      )}
      {example.external_url ? (
        <a
          href={example.external_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-realtor-primary hover:text-realtor-text"
        >
          Open full example in a new tab ↗
        </a>
      ) : null}
    </div>
  );
}

function trustedExampleEmbed(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return (
      host === "www.youtube-nocookie.com" ||
      host === "player.vimeo.com" ||
      host === "youriguide.com" ||
      host.endsWith(".youriguide.com") ||
      host.endsWith(".cloudflarestream.com")
    );
  } catch {
    return false;
  }
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

function PackageDetails({ lines }: { lines: string[] }) {
  const content = lines.length > 0 ? (
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
  );

  const boxClass =
    "booking-package-details mt-3 rounded-2xl border border-realtor-primary/20 bg-white p-3";

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

function shortDescription(description: string): string {
  const first = packageDescriptionLines(description)[0];
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
