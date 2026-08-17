export interface CatalogRuleItem {
  kind: "bundle" | "a_la_carte" | "addon";
  is_photo: boolean;
  is_video: boolean;
  is_iguide: boolean;
  is_aerial: boolean;
  require_has_video: boolean;
  require_has_media: boolean;
  require_has_iguide: boolean;
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
): "requires_video" | "requires_media" | "requires_iguide" | "already_has_aerial" | null {
  const capabilities = catalogCapabilities(selectedItems);
  if (addon.require_has_video && !capabilities.hasVideo) {
    return "requires_video";
  }
  if (addon.require_has_media && !capabilities.hasMedia) {
    return "requires_media";
  }
  if (addon.require_has_iguide && !capabilities.hasIGuide) {
    return "requires_iguide";
  }
  if (addon.exclude_has_aerial && capabilities.hasAerial) {
    return "already_has_aerial";
  }
  return null;
}

export function catalogAddonEligibilityMessage(
  addon: CatalogRuleItem & { name: string },
  selectedItems: readonly CatalogRuleItem[],
): string | null {
  const error = addonEligibilityError(addon, selectedItems);
  if (error === "requires_video") {
    return `"${addon.name}" requires a video package or à la carte item.`;
  }
  if (error === "requires_media") {
    return `"${addon.name}" requires photos, iGUIDE, or video.`;
  }
  if (error === "requires_iguide") {
    return `"${addon.name}" requires an iGUIDE package or à la carte item.`;
  }
  if (error === "already_has_aerial") {
    return `"${addon.name}" cannot be added because aerial coverage is already included.`;
  }
  return null;
}

export function isAddonEligible(
  addon: CatalogRuleItem,
  selectedItems: readonly CatalogRuleItem[],
): boolean {
  return addon.kind === "addon" && addonEligibilityError(addon, selectedItems) === null;
}
