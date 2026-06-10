"use client";

export interface BookingTotalItem {
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
  href,
  submit = false,
  ctaLabel = "Continue",
  disabled = false,
  note,
  sticky = true,
}: {
  items: BookingTotalItem[];
  selectedSlugs: string[];
  selectedAddOnSlugs: string[];
  squareFootage: number | null;
  href?: string;
  submit?: boolean;
  ctaLabel?: string;
  disabled?: boolean;
  note?: string;
  sticky?: boolean;
}) {
  const selected = [...selectedSlugs, ...selectedAddOnSlugs]
    .map((slug) => items.find((item) => item.slug === slug))
    .filter((item): item is BookingTotalItem => Boolean(item));

  if (selected.length === 0) return null;

  const rows = selected.map((item) => ({
    item,
    price: getPrice(item, squareFootage),
  }));
  const totalCents = rows.reduce((sum, row) => sum + row.price.totalCents, 0);
  const totalMinutes = Math.max(
    selected.reduce((sum, item) => sum + item.duration_minutes, 0),
    60,
  );
  const overageRows = rows.filter((row) => row.price.overageCents > 0);

  return (
    <div
      className={
        (sticky ? "sticky bottom-[max(0px,env(safe-area-inset-bottom))] z-20 " : "") +
        "mt-5 rounded-2xl border border-realtor-primary/15 bg-realtor-surface/95 px-3 py-3 shadow-lg shadow-realtor-primary/5 backdrop-blur md:static md:rounded-3xl md:p-4"
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
          {overageRows.length > 0 ? (
            <p className="mt-1 text-[11px] leading-relaxed text-realtor-primary">
              Includes sqft adjustment for{" "}
              {overageRows.map((row) => row.item.name).join(", ")}.
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

function getPrice(item: BookingTotalItem, squareFootage: number | null) {
  if (
    !item.sqft_pricing_enabled ||
    !item.included_sqft ||
    !item.overage_increment_sqft ||
    !item.overage_price_cents ||
    !squareFootage ||
    squareFootage <= item.included_sqft
  ) {
    return { totalCents: item.price_cents, overageCents: 0 };
  }
  const overageSqft = squareFootage - item.included_sqft;
  const overageUnits = Math.ceil(overageSqft / item.overage_increment_sqft);
  const overageCents = overageUnits * item.overage_price_cents;
  return { totalCents: item.price_cents + overageCents, overageCents };
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}min` : `${hours}h`;
}
