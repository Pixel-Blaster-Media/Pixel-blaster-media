import type { DeliverableType } from "../supabase/database.types.ts";

const PHOTO_DELIVERY_KINDS = new Set(["mls", "high_res"]);
const VIDEO_DELIVERY_KINDS = new Set(["download", "streaming"]);

export function validateManualDeliveryKind(
  type: DeliverableType,
  deliveryKind: string | null,
): string | null {
  if (!deliveryKind) return null;

  if (type === "photo_gallery") {
    return PHOTO_DELIVERY_KINDS.has(deliveryKind)
      ? null
      : "Pick a supported photo delivery slot.";
  }

  if (PHOTO_DELIVERY_KINDS.has(deliveryKind)) {
    return "Photo delivery slots require a photo gallery.";
  }

  if (type === "video") {
    return VIDEO_DELIVERY_KINDS.has(deliveryKind)
      ? null
      : "Unsupported delivery kind.";
  }

  return "Unsupported delivery kind.";
}
