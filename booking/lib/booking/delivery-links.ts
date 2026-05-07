import { deliverableTypeLabel } from "@/lib/booking/booking-status";
import {
  iguideFloorplanMetricPdfUrl,
  iguideFloorplanPdfUrl,
  iguideUnbrandedUrl,
  iguideViewerUrl,
  parseIGuideAlias,
} from "@/lib/integrations/iguide/parse-id";
import {
  isIGuidePhotoZipUrl,
  type IGuidePhotoZipKind,
} from "@/lib/integrations/iguide/photo-downloads";
import type { DeliverableType, Json } from "@/lib/supabase/database.types";

export type DeliveryLinkCategory =
  | "photos"
  | "tour"
  | "floor_plans"
  | "video"
  | "tools"
  | "other";

export interface DeliveryLinkInput {
  id: string;
  type: DeliverableType;
  url: string;
  source: string;
  metadata: Json | null;
}

export interface DeliveryLink {
  label: string;
  url: string;
  category: DeliveryLinkCategory;
}

export function buildDeliveryLinks(
  deliverables: DeliveryLinkInput[],
  appUrl: string,
): DeliveryLink[] {
  const links: DeliveryLink[] = [];
  const seen = new Set<string>();

  function add(
    category: DeliveryLinkCategory,
    label: string,
    url: string | null | undefined,
  ) {
    if (!url || url === "about:blank" || seen.has(`${label}:${url}`)) return;
    seen.add(`${label}:${url}`);
    links.push({ category, label, url });
  }

  const iGuideAlias = findIGuideAlias(deliverables);
  for (const deliverable of deliverables) {
    if (deliverable.source === "fotello") continue;
    if (deliverable.source === "iguide" && deliverable.type === "photo_gallery") {
      add(
        "photos",
        "MLS / low-res photos download",
        proxiedIGuideDownloadUrl(
          appUrl,
          photoDownloadUrlForDeliverable(deliverable, "mls"),
        ),
      );
      add(
        "photos",
        "High-res photos download",
        proxiedIGuideDownloadUrl(
          appUrl,
          photoDownloadUrlForDeliverable(deliverable, "high_res"),
        ),
      );
      continue;
    }
    if (deliverable.source === "iguide" && iGuideAlias) continue;
    add(
      categoryForDeliverable(deliverable),
      deliveryLinkLabel(deliverable),
      deliverable.url,
    );
  }

  if (iGuideAlias) {
    add("tour", "iGUIDE branded tour", iguideViewerUrl(iGuideAlias));
    add("tour", "iGUIDE unbranded tour", iguideUnbrandedUrl(iGuideAlias));
    add("floor_plans", "Floor plan PDF (feet)", iguideFloorplanPdfUrl(iGuideAlias));
    add(
      "floor_plans",
      "Floor plan PDF (meters)",
      iguideFloorplanMetricPdfUrl(iGuideAlias),
    );
    add(
      "floor_plans",
      "Property overview PDF (feet)",
      `https://youriguide.com/${iGuideAlias}/doc/branded_property_overview_imperial.pdf`,
    );
    add(
      "floor_plans",
      "Property overview PDF (meters)",
      `https://youriguide.com/${iGuideAlias}/doc/branded_property_overview_metric.pdf`,
    );
    add(
      "tools",
      "Feature sheet creator",
      `https://manage.youriguide.com/feature_sheet/?g=${iGuideAlias}`,
    );
    add("tools", "iGUIDE embed tool", `https://manage.youriguide.com/embed/${iGuideAlias}/`);
    add(
      "tools",
      "Create virtual showing",
      `https://show.youriguide.com/create?url=${encodeURIComponent(
        iguideViewerUrl(iGuideAlias),
      )}`,
    );
  }

  return links;
}

export function isStreamingVideoUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return [
      "youtube.com",
      "youtu.be",
      "vimeo.com",
      "player.vimeo.com",
      "facebook.com",
      "instagram.com",
      "tiktok.com",
    ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function metadataString(
  metadata: Json | null | undefined,
  key: string,
): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function photoDownloadUrl(
  metadata: Json | null | undefined,
  key: string,
  kind: IGuidePhotoZipKind = key === "mls_photo_zip_url" ? "mls" : "high_res",
): string | null {
  const url = metadataString(metadata, key);
  return photoDownloadUrlFromString(url, kind);
}

function photoDownloadUrlForDeliverable(
  deliverable: DeliveryLinkInput,
  kind: IGuidePhotoZipKind,
): string | null {
  const metadataKey =
    kind === "mls" ? "mls_photo_zip_url" : "high_res_photo_zip_url";

  return (
    photoDownloadUrl(deliverable.metadata, metadataKey, kind) ??
    photoDownloadUrlFromString(deliverable.url, kind)
  );
}

function photoDownloadUrlFromString(
  url: string | null,
  kind?: IGuidePhotoZipKind,
): string | null {
  return isIGuidePhotoZipUrl(url, kind) ? url : null;
}

function proxiedIGuideDownloadUrl(
  appUrl: string,
  url: string | null,
): string | null {
  if (!url) return null;
  const base = appUrl.replace(/\/+$/, "");
  const path = `/api/iguide/download?url=${encodeURIComponent(url)}`;
  return base ? `${base}${path}` : path;
}

function deliveryLinkLabel(deliverable: DeliveryLinkInput): string {
  const savedLabel = metadataString(deliverable.metadata, "delivery_label");
  if (savedLabel) return savedLabel;
  if (deliverable.type === "video" || deliverable.type === "aerial") {
    return isStreamingVideoUrl(deliverable.url)
      ? "YouTube / video link"
      : "Video download";
  }
  return deliverableTypeLabel(deliverable.type);
}

function categoryForDeliverable(
  deliverable: DeliveryLinkInput,
): DeliveryLinkCategory {
  if (deliverable.type === "photo_gallery") return "photos";
  if (deliverable.type === "virtual_tour") return "tour";
  if (deliverable.type === "floor_plan") return "floor_plans";
  if (deliverable.type === "video" || deliverable.type === "aerial") {
    return "video";
  }
  return "other";
}

function findIGuideAlias(deliverables: DeliveryLinkInput[]): string | null {
  for (const deliverable of deliverables) {
    if (deliverable.source !== "iguide") continue;
    const candidates = [
      metadataString(deliverable.metadata, "branded_url"),
      metadataString(deliverable.metadata, "pdf_imperial"),
      metadataString(deliverable.metadata, "pdf_metric"),
      deliverable.url,
      metadataString(deliverable.metadata, "alias"),
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const parsed = parseIGuideAlias(candidate);
      if (parsed) return parsed;
    }
  }
  return null;
}
