import type { DeliveryLinkCategory } from "./delivery-links.ts";

export type DeliverySource = "iguide" | "pixel_release" | "manual";
export type PhotoDeliverySlot = "photos_mls" | "photos_full_res";

export interface DeliverySourceCandidate {
  category: DeliveryLinkCategory;
  label: string;
  url: string;
  source: DeliverySource;
  slot?: PhotoDeliverySlot;
}

export interface DeliverySourcePolicy {
  pixelFallbackEnabled: boolean;
  pixelPackageSetComplete?: boolean;
}

const PHOTO_SLOTS: PhotoDeliverySlot[] = ["photos_mls", "photos_full_res"];
const SOURCE_PRIORITY: DeliverySource[] = ["iguide", "pixel_release", "manual"];

export function selectDeliverySources<T extends DeliverySourceCandidate>(
  candidates: readonly T[],
  policy: DeliverySourcePolicy,
): T[] {
  const selectedBySlot = new Map<PhotoDeliverySlot, T>();

  for (const slot of PHOTO_SLOTS) {
    for (const source of SOURCE_PRIORITY) {
      if (source === "pixel_release") {
        if (!policy.pixelFallbackEnabled || policy.pixelPackageSetComplete !== true) {
          continue;
        }
      }
      const candidate = candidates.find(
        (item) => item.slot === slot && item.source === source,
      );
      if (candidate) {
        selectedBySlot.set(slot, candidate);
        break;
      }
    }
  }

  const output: T[] = [];
  for (const slot of PHOTO_SLOTS) {
    const selected = selectedBySlot.get(slot);
    if (selected) output.push(selected);
  }
  for (const candidate of candidates) {
    if (!candidate.slot) output.push(candidate);
  }
  return output;
}
