/** Shared, client-safe calculations for new booking quotes. Stored bookings use snapshots. */
export interface CatalogPricingItem {
  price_cents: number;
  sqft_pricing_enabled: boolean;
  included_sqft: number | null;
  overage_increment_sqft: number | null;
  overage_price_cents: number | null;
  video_overage_threshold_sqft?: number | null;
  video_overage_price_cents?: number;
}

export interface PriceBreakdown {
  basePriceCents: number;
  measurementOverageCents: number;
  videoOverageCents: number;
  overageCents: number;
  totalPriceCents: number;
  overageSqft: number;
  overageUnits: number;
  ruleLabel: string | null;
}

export const BASEMENT_DURATION_MINUTES = 15;

/** Apply the on-site minimum first, then add basement time once per booking. */
export function bookingDurationMinutes(baseMinutes: number, includeBasement: boolean | null = false): number {
  return Math.max(baseMinutes, 60) + (includeBasement === true ? BASEMENT_DURATION_MINUTES : 0);
}

export function videoOverageRule(item: CatalogPricingItem): string | null {
  return (item.video_overage_threshold_sqft ?? 0) > 0 && (item.video_overage_price_cents ?? 0) > 0
    ? `+$${((item.video_overage_price_cents ?? 0) / 100).toFixed(2)} video overage above ${item.video_overage_threshold_sqft!.toLocaleString()} sq ft, once per package.`
    : null;
}

export function getCatalogItemPrice(item: CatalogPricingItem, squareFootage: number | null | undefined): PriceBreakdown {
  const sqft = Number.isFinite(squareFootage) && (squareFootage ?? 0) > 0 ? squareFootage! : 0;
  const hasMeasurementRule = item.sqft_pricing_enabled && (item.included_sqft ?? 0) > 0
    && (item.overage_increment_sqft ?? 0) > 0 && (item.overage_price_cents ?? 0) > 0;
  const overageSqft = hasMeasurementRule ? Math.max(sqft - item.included_sqft!, 0) : 0;
  const overageUnits = overageSqft > 0 ? Math.ceil(overageSqft / item.overage_increment_sqft!) : 0;
  const measurementOverageCents = overageUnits * (item.overage_price_cents ?? 0);
  const videoRule = videoOverageRule(item);
  // One flat fee for the selected catalog item, irrespective of bundle components.
  const videoOverageCents = videoRule && sqft > item.video_overage_threshold_sqft!
    ? item.video_overage_price_cents! : 0;
  const overageCents = measurementOverageCents + videoOverageCents;
  const measurementRule = hasMeasurementRule
    ? `Includes up to ${item.included_sqft!.toLocaleString()} sq ft. +$${((item.overage_price_cents ?? 0) / 100).toFixed(2)} per extra ${item.overage_increment_sqft!.toLocaleString()} sq ft.`
    : null;
  return {
    basePriceCents: item.price_cents, measurementOverageCents, videoOverageCents, overageCents,
    totalPriceCents: item.price_cents + overageCents, overageSqft, overageUnits,
    ruleLabel: [measurementRule, videoRule].filter(Boolean).join(" ") || null,
  };
}
