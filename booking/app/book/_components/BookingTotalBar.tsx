"use client";

import { useLayoutEffect, useRef } from "react";
import { bookingDurationMinutes, getCatalogItemPrice, type CatalogPricingItem } from "@/lib/booking/quote";
export interface BookingTotalItem extends CatalogPricingItem {
  slug: string;
  name: string;
  price_cents: number;
  duration_minutes: number;
  sqft_pricing_enabled: boolean;
  included_sqft: number | null;
  overage_increment_sqft: number | null;
  overage_price_cents: number | null;
}

export default function BookingTotalBar({
  items,
  selectedSlugs,
  selectedAddOnSlugs,
  squareFootage,
  includeBasement = false,
  href,
  submit = false,
  ctaLabel = "Continue",
  disabled = false,
  note,
  sticky = true,
  selectionSummary = false,
}: {
  items: BookingTotalItem[];
  selectedSlugs: string[];
  selectedAddOnSlugs: string[];
  squareFootage: number | null;
  includeBasement?: boolean | null;
  href?: string;
  submit?: boolean;
  ctaLabel?: string;
  disabled?: boolean;
  note?: string;
  sticky?: boolean;
  selectionSummary?: boolean;
}) {
  const footerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const footer = footerRef.current;
    if (!selectionSummary || !footer) return;

    const root = document.documentElement;
    const shell = footer.closest(".booking-shell");
    const property = "--booking-footer-height";
    const previousValue = root.style.getPropertyValue(property);
    const previousPriority = root.style.getPropertyPriority(property);
    let focusFrame = 0;

    const keepFocusVisible = () => {
      focusFrame = 0;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || footer.contains(active) || !shell?.contains(active)) return;
      const target = active.getBoundingClientRect();
      const availableBottom = footer.getBoundingClientRect().top - 12;
      // A disclosure/resize can cover a control that already has focus; focus
      // navigation can also scroll after the ResizeObserver has delivered.
      if (target.top < 12) {
        window.scrollBy({ top: target.top - 12, behavior: "instant" });
      } else if (target.bottom > availableBottom) {
        window.scrollBy({ top: target.bottom - availableBottom, behavior: "instant" });
      }
    };
    const scheduleFocusCheck = () => {
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(keepFocusVisible);
    };
    const measure = () => {
      root.style.setProperty(property, `${Math.ceil(footer.getBoundingClientRect().height)}px`);
      scheduleFocusCheck();
    };

    const observer = new ResizeObserver(measure);
    observer.observe(footer);
    window.addEventListener("resize", measure);
    document.addEventListener("focusin", scheduleFocusCheck);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", scheduleFocusCheck);
      cancelAnimationFrame(focusFrame);
      if (previousValue) root.style.setProperty(property, previousValue, previousPriority);
      else root.style.removeProperty(property);
    };
  }, [selectionSummary]);

  const selected = [...new Set([...selectedSlugs, ...selectedAddOnSlugs])]
    .map((slug) => items.find((item) => item.slug === slug))
    .filter((item): item is BookingTotalItem => Boolean(item));

  if (selected.length === 0 && !selectionSummary) return null;

  const rows = selected.map((item) => ({
    item,
    price: getCatalogItemPrice(item, squareFootage),
  }));
  const totalCents = rows.reduce((sum, row) => sum + row.price.totalPriceCents, 0);
  const totalMinutes = bookingDurationMinutes(
    selected.reduce((sum, item) => sum + item.duration_minutes, 0),
    includeBasement,
  );
  const overageRows = rows.filter((row) => row.price.overageCents > 0);

  if (selectionSummary) {
    return (
      <section ref={footerRef} className="booking-refresh-total" aria-label="Booking selection">
        <div className="booking-refresh-total-inner">
          <div className="booking-refresh-total-summary" aria-live="polite" aria-atomic="true">
            <p className="booking-refresh-selection-name" title={selected.map((item) => item.name).join(", ")}>
              {selected.length ? `${selected[0].name}${selected.length > 1 ? ` + ${selected.length - 1} more` : ""}` : "Choose your services"}
            </p>
            {selected.length ? (
              <p className="booking-refresh-total-price"><strong>${(totalCents / 100).toFixed(0)} <span>CAD</span></strong><span>~{formatMinutes(totalMinutes)} on-site</span></p>
            ) : <p>Select a package or build a custom order.</p>}
            <p className="booking-refresh-total-note">{note ?? "Final total shown before confirmation."}</p>
          </div>
          {selected.length > 0 && href && !disabled ? (
            <a className="booking-refresh-continue" href={href}>{ctaLabel}<span aria-hidden="true">→</span></a>
          ) : <button className="booking-refresh-continue" type="button" disabled>{ctaLabel}<span aria-hidden="true">→</span></button>}
          {selected.length > 0 ? (
            <details className="booking-refresh-total-breakdown">
              <summary>Price details</summary>
              <ul>{rows.map((row) => <li key={row.item.slug}><span>{row.item.name}</span><span>${(row.price.totalPriceCents / 100).toFixed(0)}</span></li>)}</ul>
              {overageRows.length > 0 ? <p>{squareFootage?.toLocaleString()} sqft home: {overageRows.map((row) => `${row.item.name} +$${(row.price.overageCents / 100).toFixed(0)}`).join(", ")}</p> : null}
              {includeBasement ? <p>Includes 15 minutes for the finished basement.</p> : null}
            </details>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <div
      className={
        (sticky ? "sticky bottom-[max(0px,env(safe-area-inset-bottom))] z-20 " : "") +
        "precision-panel mt-5 rounded-2xl border border-realtor-primary/15 bg-realtor-surface/95 px-3 py-3 shadow-lg shadow-realtor-primary/5 backdrop-blur md:static md:rounded-3xl md:p-4"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-realtor-muted">
            Running total
          </p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xl font-semibold text-realtor-text">
              ${(totalCents / 100).toFixed(0)}
            </span>
            <span className="text-sm text-realtor-muted">
              ~{formatMinutes(totalMinutes)} on-site
            </span>
          </div>
          {includeBasement ? <p className="mt-1 text-[11px] text-realtor-muted">Includes 15 minutes for the finished basement.</p> : null}
          {overageRows.length > 0 ? (
            <p className="mt-1 text-[11px] leading-relaxed text-realtor-primary">
              {squareFootage?.toLocaleString()} sqft home:{" "}
              {overageRows
                .map(
                  (row) =>
                    `${row.item.name} +$${(row.price.overageCents / 100).toFixed(0)}`,
                )
                .join(", ")}
            </p>
          ) : note ? (
            <p className="mt-1 text-[11px] leading-relaxed text-realtor-muted">
              {note}
            </p>
          ) : null}
        </div>

        {submit ? (
          <button
            type="submit"
            disabled={disabled}
            className="shrink-0 rounded-full bg-realtor-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-realtor-primary/20 transition hover:bg-realtor-primary-light disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
          >
            {ctaLabel}
          </button>
        ) : href ? (
          <a
            href={href}
            aria-disabled={disabled}
            className={
              "shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold shadow-sm shadow-realtor-primary/20 transition sm:px-5 " +
              (disabled
                ? "pointer-events-none bg-realtor-primary/35 text-white/80"
                : "bg-realtor-primary text-white hover:bg-realtor-primary-light")
            }
          >
            {ctaLabel}
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="shrink-0 rounded-full bg-realtor-primary/35 px-4 py-2.5 text-sm font-semibold text-white/80 shadow-sm shadow-realtor-primary/10 sm:px-5"
          >
            {ctaLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}min` : `${hours}h`;
}
