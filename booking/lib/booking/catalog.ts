import "server-only";

import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { addonEligibilityError } from "@/lib/booking/catalog-rules";

export type CatalogItemRow =
  Database["public"]["Tables"]["catalog_items"]["Row"];

export interface Catalog {
  bundles: CatalogItemRow[];
  aLaCarte: CatalogItemRow[];
  addons: CatalogItemRow[];
}

export interface CatalogScope {
  organizationId?: string;
}

function catalogOrganizationId(scope?: CatalogScope): string {
  return scope?.organizationId ?? DEFAULT_ORGANIZATION_ID;
}

/**
 * Load the active catalog for the public booking form.
 * Uses the service role so anonymous visitors can read it regardless of RLS
 * timing — the table is public-readable anyway, this just avoids a round-trip
 * through auth for unauthenticated requests.
 */
export async function getActiveCatalog(
  scope?: CatalogScope,
): Promise<Catalog> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("catalog_items")
    .select("*")
    .eq("organization_id", catalogOrganizationId(scope))
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<CatalogItemRow[]>();

  if (error) {
    throw new Error(`Failed to load catalog: ${error.message}`);
  }

  const rows = data ?? [];
  return {
    bundles: rows.filter((r) => r.kind === "bundle"),
    aLaCarte: rows.filter((r) => r.kind === "a_la_carte"),
    addons: rows.filter((r) => r.kind === "addon"),
  };
}

/**
 * Load the FULL catalog (active + inactive) for the admin pricing page.
 */
export async function getFullCatalog(scope?: CatalogScope): Promise<Catalog> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("catalog_items")
    .select("*")
    .eq("organization_id", catalogOrganizationId(scope))
    .order("kind", { ascending: true })
    .order("display_order", { ascending: true })
    .returns<CatalogItemRow[]>();

  if (error) {
    throw new Error(`Failed to load catalog: ${error.message}`);
  }

  const rows = data ?? [];
  return {
    bundles: rows.filter((r) => r.kind === "bundle"),
    aLaCarte: rows.filter((r) => r.kind === "a_la_carte"),
    addons: rows.filter((r) => r.kind === "addon"),
  };
}

export interface CartLine {
  /** Catalog item id. */
  catalogItemId: string;
  /** Always 1 for bundles + addons; can be >1 for à la carte. */
  quantity: number;
}

export interface CartTotals {
  totalDurationMinutes: number;
  totalPriceCents: number;
  hasVideo: boolean;
}

export interface PriceBreakdown {
  basePriceCents: number;
  overageCents: number;
  totalPriceCents: number;
  overageSqft: number;
  overageUnits: number;
  ruleLabel: string | null;
}

/**
 * Compute totals from a cart against a catalog snapshot. Unknown ids are
 * ignored — a stale id on the client shouldn't crash the server.
 */
export function computeCartTotals(
  cart: readonly CartLine[],
  catalog: Catalog,
  squareFootage: number | null = null,
): CartTotals {
  const byId = new Map<string, CatalogItemRow>();
  for (const r of catalog.bundles) byId.set(r.id, r);
  for (const r of catalog.aLaCarte) byId.set(r.id, r);
  for (const r of catalog.addons) byId.set(r.id, r);

  let totalPriceCents = 0;
  let totalDurationMinutes = 0;
  let hasVideo = false;

  for (const line of cart) {
    const item = byId.get(line.catalogItemId);
    if (!item) continue;
    const qty = Math.max(1, line.quantity);
    totalPriceCents += getCatalogItemPrice(item, squareFootage).totalPriceCents * qty;
    totalDurationMinutes += item.duration_minutes * qty;
    if (item.is_video) hasVideo = true;
  }

  return { totalDurationMinutes, totalPriceCents, hasVideo };
}

/**
 * Enforce the cart rules:
 *   - At least one bundle OR one à la carte item.
 *   - At most one bundle (bundles are mutually exclusive).
 *   - Add-on capability rules are checked against the selected non-add-ons.
 * Returns null if valid; otherwise a user-facing error string.
 */
export function validateCart(
  cart: readonly CartLine[],
  catalog: Catalog,
): string | null {
  const byId = new Map<string, CatalogItemRow>();
  for (const r of catalog.bundles) byId.set(r.id, r);
  for (const r of catalog.aLaCarte) byId.set(r.id, r);
  for (const r of catalog.addons) byId.set(r.id, r);

  const items = cart
    .map((l) => ({ row: byId.get(l.catalogItemId), qty: l.quantity }))
    .filter((x): x is { row: CatalogItemRow; qty: number } => !!x.row);

  if (items.length === 0) {
    return "Pick at least one package or à la carte item.";
  }

  const bundles = items.filter((x) => x.row.kind === "bundle");
  if (bundles.length > 1) {
    return "Only one bundle can be selected per booking.";
  }

  const nonAddon = items.filter((x) => x.row.kind !== "addon");
  if (nonAddon.length === 0) {
    return "Pick at least one package or à la carte item (add-ons alone are not enough).";
  }

  for (const { row } of items) {
    if (row.kind !== "addon") continue;
    const eligibilityError = addonEligibilityError(
      row,
      nonAddon.map((item) => item.row),
    );
    if (eligibilityError === "requires_video") {
      return `"${row.name}" requires a video package or à la carte item.`;
    }
    if (eligibilityError === "requires_media") {
      return `"${row.name}" requires photos, iGUIDE, or video.`;
    }
    if (eligibilityError === "already_has_aerial") {
      return `"${row.name}" cannot be added because aerial coverage is already included.`;
    }
  }

  return null;
}

export function getCatalogItemPrice(
  item: CatalogItemRow,
  squareFootage: number | null | undefined,
): PriceBreakdown {
  const basePriceCents = item.price_cents;
  const ruleLabel = formatSqftPricingRule(item);
  if (
    !item.sqft_pricing_enabled ||
    !item.included_sqft ||
    !item.overage_increment_sqft ||
    !item.overage_price_cents ||
    !squareFootage ||
    squareFootage <= item.included_sqft
  ) {
    return {
      basePriceCents,
      overageCents: 0,
      totalPriceCents: basePriceCents,
      overageSqft: 0,
      overageUnits: 0,
      ruleLabel,
    };
  }

  const overageSqft = squareFootage - item.included_sqft;
  const overageUnits = Math.ceil(overageSqft / item.overage_increment_sqft);
  const overageCents = overageUnits * item.overage_price_cents;
  return {
    basePriceCents,
    overageCents,
    totalPriceCents: basePriceCents + overageCents,
    overageSqft,
    overageUnits,
    ruleLabel,
  };
}

function formatSqftPricingRule(item: CatalogItemRow): string | null {
  if (
    !item.sqft_pricing_enabled ||
    !item.included_sqft ||
    !item.overage_increment_sqft ||
    !item.overage_price_cents
  ) {
    return null;
  }
  return `Includes up to ${item.included_sqft.toLocaleString()} sq ft. +${formatPrice(
    item.overage_price_cents,
  )} per extra ${item.overage_increment_sqft.toLocaleString()} sq ft.`;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
