import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  getImage,
  getOrder,
  processOrder,
} from "@/lib/integrations/autoenhance/client";

import {
  extractOrderImages,
  formatImageResult,
  jsonError,
  normalizeBracketsPerImage,
  pendingAutoBracketGroup,
  pendingBracketGroup,
} from "../_helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as {
      orderId?: string;
      bracketIds?: string[];
      bracketsPerImage?: number;
      enhanceType?: string;
      presetId?: string;
      skyReplacement?: boolean;
      cloudType?: string;
      windowPullType?: string;
      privacy?: boolean;
      upscale?: boolean;
      tripodHide?: boolean;
      fireInFireplaces?: boolean;
      greenGrass?: boolean;
      removePhotographer?: boolean;
      blackOutTvs?: boolean;
    };
    const orderId = body.orderId?.trim();
    const bracketIds = (body.bracketIds ?? [])
      .map((id) => String(id).trim())
      .filter(Boolean);
    if (!orderId) return jsonError("Order ID is required.", 400);
    if (!bracketIds.length) return jsonError("No bracket IDs were uploaded.", 400);

    const bracketsPerImage = normalizeBracketsPerImage(body.bracketsPerImage);
    const processedOrder = await processOrder(orderId, admin.organizationId, {
      // Autoenhance supports three separate HDR modes:
      // - omit grouping fields entirely for visual auto grouping
      // - send number_of_brackets_per_image for fixed-size bracket sets
      // - send images[].bracket_ids for already-manual groups
      //
      // Michael normally shoots 3 brackets per photo, so use the fixed-size
      // mode and do not also send an images array.
      bracketsPerImage,
      enhanceType: normalizeEnhanceType(body.enhanceType),
      presetId: body.presetId?.trim() || undefined,
      skyReplacement: Boolean(body.skyReplacement),
      cloudType: normalizeCloudType(body.cloudType),
      windowPullType: normalizeWindowPullType(body.windowPullType),
      privacy: body.privacy !== false,
      upscale: Boolean(body.upscale),
      tripodHide: Boolean(body.tripodHide),
      restage: {
        ...(body.fireInFireplaces ? { fire_in_fireplaces: "ALIGHT" as const } : {}),
        ...(body.greenGrass ? { grass: "GREEN" as const } : {}),
        ...(body.removePhotographer ? { photographer: "REMOVE" as const } : {}),
        ...(body.blackOutTvs ? { tvs: "BLACK_OUT" as const } : {}),
      },
    });

    const order = await getOrder(orderId, admin.organizationId).catch(
      () => processedOrder,
    );
    const rawImages = extractOrderImages(order).length
      ? extractOrderImages(order)
      : extractOrderImages(processedOrder);
    const images = rawImages.length
      ? await Promise.all(
          rawImages.map(async (raw, index) => {
            const id =
              typeof raw.image_id === "string" ? raw.image_id : `image-${index + 1}`;
            const image = await getImage(id, admin.organizationId).catch(() => raw);
            return formatImageResult(image, id);
          }),
        )
      : bracketsPerImage === 0
        ? [pendingAutoBracketGroup(bracketIds)]
        : [pendingBracketGroup(bracketIds, bracketsPerImage)];

    return NextResponse.json({
      ok: true,
      orderId,
      images,
      processStatus: order.status ?? processedOrder.status ?? null,
      totalImages: order.total_images ?? processedOrder.total_images ?? null,
      debug: {
        bracketGroups:
          bracketsPerImage === 0
            ? ["auto"]
            : [`fixed:${bracketsPerImage}`],
        rawImageCount: rawImages.length,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}

function normalizeEnhanceType(value: unknown) {
  return value === "property" ||
    value === "property_usa" ||
    value === "neutral" ||
    value === "modern"
    ? value
    : "warm";
}

function normalizeCloudType(value: unknown) {
  return value === "CLEAR" || value === "LOW_CLOUD" || value === "HIGH_CLOUD"
    ? value
    : null;
}

function normalizeWindowPullType(value: unknown) {
  return value === "NONE" ||
    value === "ONLY_WINDOWS" ||
    value === "WINDOWS_WITH_SKIES"
    ? value
    : null;
}
