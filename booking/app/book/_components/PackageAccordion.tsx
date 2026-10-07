"use client";

import { getCatalogItemPrice } from "@/lib/booking/quote";
import { publicWizardQuery } from "@/lib/booking/wizard-state";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";

import type { CatalogItemDTO } from "@/lib/booking/catalog-dto";
import { getCatalogSampleGroups } from "@/lib/booking/catalog-sample-groups";
import { isAddonEligible } from "@/lib/booking/catalog-rules";
import BookingTotalBar from "./BookingTotalBar";
import { packageDescriptionLines } from "./package-description";

/** URL-driven selection, with independent native details and example accordions. */
export default function PackageAccordion({
  bundles,
  aLaCarte,
  addons,
  selectedSlugs,
  selectedAddOnSlugs,
  squareFootage,
  includeBasement,
}: {
  bundles: CatalogItemDTO[];
  aLaCarte: CatalogItemDTO[];
  addons: CatalogItemDTO[];
  selectedSlugs: string[];
  selectedAddOnSlugs: string[];
  squareFootage: number | null;
  includeBasement?: boolean | null;
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

  const selectedServices = selectedSlugs
    .map((slug) => bySlug.get(slug))
    .filter((item): item is CatalogItemDTO => Boolean(item));
  // isCatalogAddonEligible is the server-side name for this same shared rule.
  const visibleAddons = addons.filter((addon) =>
    isAddonEligible(addon, selectedServices),
  );
  function updateUrl(nextServices: string[], nextAddons: string[]) {
    const next = publicWizardQuery(new URLSearchParams(params.toString()));
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
    // A changed selection can require a longer slot; keep the private draft
    // while making the customer choose availability for the new duration.
    next.delete("slot");
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

  const continueQuery = publicWizardQuery(new URLSearchParams(params.toString())).toString();
  const continueHref = continueQuery
    ? `/book/property?${continueQuery}`
    : "/book/property";

  return (
    <div className="booking-refresh-picker">
      <section id="packages" aria-labelledby="package-heading">
        <div className="booking-refresh-section-heading">
          <div>
            <h2 id="package-heading">Choose your package</h2>
            <p>Start with the right fit for your listing.</p>
          </div>
          <p>{squareFootage ? `Prices for ${squareFootage.toLocaleString()} sqft · CAD` : "Base prices in CAD"}</p>
        </div>
        <ul className="booking-refresh-grid">
          {bundles.map((b) => {
            const selected = selectedSlugs.includes(b.slug);
            return (
              <li key={b.id}>
                <article className="booking-refresh-card" data-selected={selected} aria-labelledby={`package-${b.slug}`}>
                  <div className="booking-refresh-card-heading">
                    <div>
                      <h3 id={`package-${b.slug}`}>{b.name}</h3>
                      {b.ideal_for ? <p>{b.ideal_for}</p> : null}
                    </div>
                    <div className="booking-refresh-price">
                      <strong>${(priceForSqft(b, squareFootage) / 100).toFixed(0)}</strong>
                      <span>{formatMinutes(b.duration_minutes)} on-site</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={selected ? `Selected ${b.name}` : `Choose package: ${b.name}`}
                    onClick={() => selectBundle(b.slug)}
                    className="booking-refresh-select"
                  >
                    {selected ? <><span aria-hidden="true">✓</span> Selected</> : "Choose package"}
                  </button>
                  <PackageDetails item={b} desktopDefaultOpen />
                </article>
              </li>
            );
          })}
        </ul>
        {hasBundle ? (
          <button
            type="button"
            className="booking-refresh-text-button"
            onClick={() => {
              const withoutBundles = selectedSlugs.filter((s) => !bundles.some((b) => b.slug === s));
              updateUrl(withoutBundles, selectedAddOnSlugs);
            }}
          >Clear package</button>
        ) : null}
      </section>

      <section className="booking-refresh-custom">
        <h2>
          <button
            type="button"
            onClick={() => setALaCarteOpen((value) => !value)}
            aria-expanded={aLaCarteOpen}
            aria-controls="custom-services"
            className="booking-refresh-custom-toggle"
          >
            <span>Build a custom order<span className="booking-refresh-custom-subtitle">
              {hasALaCarte
                ? `${selectedSlugs.filter((s) => aLaCarte.some((a) => a.slug === s)).length} services selected`
                : "Choose individual services, or add them to your package."}
            </span></span>
            <Chevron open={aLaCarteOpen} />
          </button>
        </h2>
        <div id="custom-services" hidden={!aLaCarteOpen}>
          <ul className="booking-refresh-grid booking-refresh-service-grid">
            {aLaCarte.map((a) => {
              const selected = selectedSlugs.includes(a.slug);
              return (
                <li key={a.id}>
                  <article className="booking-refresh-card booking-refresh-service" data-selected={selected} aria-labelledby={`service-${a.slug}`}>
                    <div className="booking-refresh-card-heading">
                      <div><h3 id={`service-${a.slug}`}>{a.name}</h3>{a.ideal_for ? <p>{a.ideal_for}</p> : null}</div>
                      <div className="booking-refresh-price">
                        <strong>${(priceForSqft(a, squareFootage) / 100).toFixed(0)}</strong>
                        <span>{formatMinutes(a.duration_minutes)} on-site</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={selected ? `Added: ${a.name} (remove service)` : `Add service: ${a.name}`}
                      onClick={() => toggleALaCarte(a.slug)}
                      className="booking-refresh-select"
                    >{selected ? <><span aria-hidden="true">✓</span> Added</> : "Add service"}</button>
                    <PackageDetails item={a} label="Service details" />
                  </article>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {visibleAddons.length > 0 ? (
        <section aria-labelledby="addons-heading">
          <div className="booking-refresh-section-heading">
            <div><h2 id="addons-heading">Make it yours</h2><p>Add-ons available with your selection.</p></div>
          </div>
          <ul className="booking-refresh-grid booking-refresh-service-grid">
            {visibleAddons.map((a) => {
              const selected = selectedAddOnSlugs.includes(a.slug);
              return (
                <li key={a.id}>
                  <article className="booking-refresh-card booking-refresh-service" data-selected={selected} aria-labelledby={`addon-${a.slug}`}>
                    <div className="booking-refresh-card-heading">
                      <h3 id={`addon-${a.slug}`}>{a.name}</h3>
                      <div className="booking-refresh-price"><strong>+${(priceForSqft(a, squareFootage) / 100).toFixed(0)}</strong><span>{formatMinutes(a.duration_minutes)} on-site</span></div>
                    </div>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={selected ? `Added: ${a.name} (remove add-on)` : `Add to booking: ${a.name}`}
                      onClick={() => toggleAddon(a.slug)}
                      className="booking-refresh-select"
                    >{selected ? <><span aria-hidden="true">✓</span> Added</> : "Add to booking"}</button>
                    <PackageDetails item={a} label="Add-on details" />
                  </article>
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
        includeBasement={includeBasement}
        href={continueHref}
        ctaLabel="Continue"
        selectionSummary
        note={squareFootage ? undefined : "Final total shown before confirmation."}
      />
    </div>
  );
}

function Chevron({ open }: { open?: boolean }) {
  return <svg className="booking-refresh-chevron" data-open={open} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}

function PackageDetails({ item, label = "Package details", desktopDefaultOpen = false }: {
  item: CatalogItemDTO;
  label?: string;
  desktopDefaultOpen?: boolean;
}) {
  const player = useRef<HTMLDialogElement>(null);
  const opener = useRef<{ element: HTMLButtonElement; exampleId: string } | null>(null);
  const playerTitle = useId();
  const [video, setVideo] = useState<{ src: string; title: string; orientation: string } | null>(null);
  const lines = packageDescriptionLines(item.description);
  const groups = getCatalogSampleGroups(item);
  const rule = sqftRuleText(item);
  const disclosure = (className: string, initiallyOpen = false) => (
    <details className={className} open={initiallyOpen}>
      <summary><span>{label}</span><Chevron /></summary>
      <div className="booking-refresh-detail-body">
        {groups.length > 0 ? <p className="booking-refresh-media-list">{groups.map((group) => group.label).join(" · ")}</p> : null}
        {lines.length > 0 ? (
          <ul className="booking-refresh-inclusions">
            {lines.map((line, index) => <li key={`${index}:${line}`}><span aria-hidden="true">✓</span><span>{line}</span></li>)}
          </ul>
        ) : null}
        {rule ? <p className="booking-refresh-pricing-rule">{rule}</p> : null}
        {groups.length > 0 ? (
          <details className="booking-refresh-examples">
            <summary><span>View examples</span><Chevron /></summary>
            <ul>
              {groups.map((group) => {
                const examples = group.examples.filter((example) => sampleHref(example.external_url ?? example.embed_url));
                return <li key={group.key} className="booking-refresh-example-group">
                  <span>{group.label}</span>
                  <div>
                    {examples.length > 0 ? examples.map((example) => {
                      const actionLabel = examples.length > 1 ? example.title : example.kind === "video" ? "Watch sample" : group.key === "iguide" ? "Explore iGUIDE" : "View example";
                      const streamSrc = example.kind === "video" ? streamSampleHref(example.embed_url) : undefined;
                      if (streamSrc) return (
                        <button
                          key={example.id}
                          type="button"
                          data-booking-example={example.id}
                          aria-haspopup="dialog"
                          aria-label={`${actionLabel}${examples.length === 1 ? `: ${example.title}` : ""} — ${group.label} for ${item.name} (opens video player)`}
                          onClick={(event) => {
                            opener.current = { element: event.currentTarget, exampleId: example.id };
                            setVideo({ src: streamSrc, title: example.title, orientation: example.orientation });
                            player.current?.showModal();
                          }}
                        >
                          <span aria-hidden="true">▶</span><span>{actionLabel}</span>
                        </button>
                      );
                      return (
                      <a
                        key={example.id}
                        href={sampleHref(example.external_url ?? example.embed_url)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${actionLabel}${examples.length === 1 ? `: ${example.title}` : ""} — ${group.label} for ${item.name} (opens in a new tab)`}
                      >
                        {example.kind === "video" ? <span aria-hidden="true">▶</span> : null}
                        <span>{actionLabel}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7" /></svg>
                      </a>
                      );
                    }) : <span className="booking-refresh-example-unavailable">No example yet</span>}
                  </div>
                </li>;
              })}
            </ul>
            <p>Your booking selection stays here while you view examples.</p>
          </details>
        ) : null}
      </div>
    </details>
  );

  // CSS chooses the native disclosure before hydration. Each layout keeps its
  // own manual toggles; neither resizing nor booking updates reset them.
  return <>
    {desktopDefaultOpen ? (
    <>
      {disclosure("booking-refresh-details booking-refresh-details-desktop", true)}
      {disclosure("booking-refresh-details booking-refresh-details-mobile")}
    </>
    ) : disclosure("booking-refresh-details")}
    <dialog
      ref={player}
      className="booking-refresh-sample-dialog"
      aria-labelledby={playerTitle}
      onClose={() => {
        setVideo(null);
        const previous = opener.current;
        if (!previous) return;
        const visibleButton = (button: HTMLButtonElement) => button.getClientRects().length > 0 && !button.closest('details:not([open])');
        if (visibleButton(previous.element)) return previous.element.focus();
        // The responsive counterpart may be hidden inside a closed disclosure.
        const owner = player.current?.parentElement;
        const counterpart = Array.from(owner?.querySelectorAll<HTMLButtonElement>('button[data-booking-example]') ?? [])
          .find(button => button.dataset.bookingExample === previous.exampleId && visibleButton(button));
        if (counterpart) return counterpart.focus();
        const details = Array.from(owner?.querySelectorAll<HTMLDetailsElement>(':scope > details') ?? [])
          .find(element => element.getClientRects().length);
        details?.querySelector<HTMLElement>('summary')?.focus();
      }}
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
    >
      <div className="booking-refresh-sample-panel">
        <header>
          <div><h2 id={playerTitle}>{video?.title ?? "Sample video"}</h2><p>Video example for {item.name}</p></div>
          <button type="button" aria-label="Close sample video" onClick={() => player.current?.close()}>Close <span aria-hidden="true">×</span></button>
        </header>
        {video ? <iframe
          className={`booking-refresh-sample-player${video.orientation === "portrait" ? " is-portrait" : ""}`}
          src={video.src}
          title={video.title}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        /> : null}
      </div>
    </dialog>
  </>;
}

/** Stream's domain restriction requires its player to remain inside our site. */
function streamSampleHref(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && /^customer-[a-zA-Z0-9]+\.cloudflarestream\.com$/.test(url.hostname)
      && /^\/[a-f0-9]{32}\/iframe$/.test(url.pathname) && !url.search && !url.hash
      ? url.href : undefined;
  } catch { return undefined; }
}

function sampleHref(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? raw : undefined;
  } catch {
    return undefined;
  }
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${Math.floor(hours)}h ${minutes % 60}min`;
}

/** Price the whole catalog package once, including its configured video fee. */
function priceForSqft(item: CatalogItemDTO, squareFootage: number | null): number {
  return getCatalogItemPrice(item, squareFootage).totalPriceCents;
}

function sqftRuleText(item: CatalogItemDTO): string | null {
  return getCatalogItemPrice(item, null).ruleLabel;
}
