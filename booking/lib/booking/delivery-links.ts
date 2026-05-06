import { deliverableTypeLabel } from "@/lib/booking/booking-status";
import {
  iguideFloorplanMetricPdfUrl,
  iguideFloorplanPdfUrl,
  iguideUnbrandedUrl,
  iguideViewerUrl,
  parseIGuideAlias,
} from "@/lib/integrations/iguide/parse-id";
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
    if (deliverable.source === "iguide" && iGuideAlias) continue;
    if (deliverable.source === "fotello") {
      add(
        "photos",
        deliverableTypeLabel(deliverable.type),
        `${appUrl}/api/fotello/embed/${deliverable.id}`,
      );
      continue;
    }
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
