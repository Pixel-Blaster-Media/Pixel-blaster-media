/** Client-safe catalog shape used by the public booking experience. */
export interface CatalogItemExampleDTO {
  id: string;
  title: string;
  description: string | null;
  kind: "video" | "interactive" | "link";
  sample_group_key: string | null;
  sample_group_label: string | null;
  embed_url: string | null;
  external_url: string | null;
  orientation: "portrait" | "landscape";
}

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
  is_photo: boolean;
  is_video: boolean;
  is_iguide: boolean;
  is_aerial: boolean;
  require_has_video: boolean;
  require_has_media: boolean;
  require_has_iguide: boolean;
  exclude_has_aerial: boolean;
  display_order: number;
  badge: string | null;
  highlight: boolean;
  ideal_for: string | null;
  examples: CatalogItemExampleDTO[];
}
