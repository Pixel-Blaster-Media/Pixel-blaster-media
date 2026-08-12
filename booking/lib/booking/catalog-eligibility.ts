export interface CatalogCapabilityFlags {
  is_photo: boolean;
  is_video: boolean;
  is_iguide: boolean;
  is_aerial: boolean;
  require_has_video: boolean;
  require_has_media: boolean;
  exclude_has_aerial: boolean;
}

export interface SelectedServiceCapabilities {
  hasVideo: boolean;
  hasMedia: boolean;
  hasAerial: boolean;
}

/** Mirrors the fail-closed capability aggregate in the production booking RPC. */
export function getSelectedServiceCapabilities(
  services: readonly CatalogCapabilityFlags[],
): SelectedServiceCapabilities {
  return {
    hasVideo: services.some((item) => item.is_video),
    hasMedia: services.some(
      (item) => item.is_photo || item.is_video || item.is_iguide,
    ),
    hasAerial: services.some((item) => item.is_aerial),
  };
}

/** Mirrors the add-on eligibility predicate enforced by PostgreSQL. */
export function isCatalogAddonEligible(
  addon: CatalogCapabilityFlags,
  selected: SelectedServiceCapabilities,
): boolean {
  if (addon.require_has_video && !selected.hasVideo) return false;
  if (addon.require_has_media && !selected.hasMedia) return false;
  if (addon.exclude_has_aerial && selected.hasAerial) return false;
  return true;
}
