export interface CatalogRuleItem {
  kind: "bundle" | "a_la_carte" | "addon";
  is_photo: boolean;
  is_video: boolean;
  is_iguide: boolean;
  is_aerial: boolean;
  require_has_video: boolean;
  require_has_media: boolean;
  exclude_has_aerial: boolean;
}

export interface CatalogCapabilities {
  hasPhoto: boolean;
  hasVideo: boolean;
  hasIGuide: boolean;
  hasAerial: boolean;
  hasMedia: boolean;
}

export function catalogCapabilities(
  selectedItems: readonly CatalogRuleItem[],
): CatalogCapabilities {
  const services = selectedItems.filter((item) => item.kind !== "addon");
  const hasPhoto = services.some((item) => item.is_photo);
  const hasVideo = services.some((item) => item.is_video);
  const hasIGuide = services.some((item) => item.is_iguide);
  const hasAerial = services.some((item) => item.is_aerial);

  return {
    hasPhoto,
    hasVideo,
    hasIGuide,
    hasAerial,
    hasMedia: hasPhoto || hasVideo || hasIGuide,
  };
}

export function addonEligibilityError(
  addon: CatalogRuleItem,
  selectedItems: readonly CatalogRuleItem[],
): "requires_video" | "requires_media" | "already_has_aerial" | null {
  const capabilities = catalogCapabilities(selectedItems);
  if (addon.require_has_video && !capabilities.hasVideo) {
    return "requires_video";
  }
  if (addon.require_has_media && !capabilities.hasMedia) {
    return "requires_media";
  }
  if (addon.exclude_has_aerial && capabilities.hasAerial) {
    return "already_has_aerial";
  }
  return null;
}

export function isAddonEligible(
  addon: CatalogRuleItem,
  selectedItems: readonly CatalogRuleItem[],
): boolean {
  return addon.kind === "addon" && addonEligibilityError(addon, selectedItems) === null;
}
