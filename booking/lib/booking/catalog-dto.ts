/** Client-safe catalog shape used by the public booking experience. */
export interface CatalogItemDTO {
  id: string;
  slug: string;
  name: string;
  description: string;
  duration_minutes: number;
  price_cents: number;
  sqft_pricing_enabled: boolean;
  included_sqft: number | null;
  overage_increment_sqft: number | null;
  overage_price_cents: number | null;
  kind: "bundle" | "a_la_carte" | "addon";
  is_video: boolean;
  require_has_video: boolean;
  display_order: number;
  is_photo: boolean;
  badge: string | null;
  highlight: boolean;
  ideal_for: string | null;
}
