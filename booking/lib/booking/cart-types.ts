/**
 * Cart shape persisted on booking_requests.cart (and consumed by the
 * /portal/book submit path). Kept separate from the DB types so client
 * components can import it without pulling server-only code.
 */

export interface CartLinePayload {
  /** catalog_items.id — source of truth for pricing/duration lookups. */
  catalog_item_id: string;
  /** catalog_items.slug — denormalized for display without a join. */
  slug: string;
  /** Always 1 for bundles + addons; >1 allowed for a-la-carte. */
  quantity: number;
}

export function isCartLineArray(value: unknown): value is CartLinePayload[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (x) =>
      x !== null &&
      typeof x === "object" &&
      typeof (x as CartLinePayload).catalog_item_id === "string" &&
      typeof (x as CartLinePayload).slug === "string" &&
      typeof (x as CartLinePayload).quantity === "number" &&
      (x as CartLinePayload).quantity > 0,
  );
}

export function parseCart(value: unknown): CartLinePayload[] {
  if (isCartLineArray(value)) return value;
  return [];
}
