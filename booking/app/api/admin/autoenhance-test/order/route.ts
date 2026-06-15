import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  getImage,
  getOrder,
  getOrderBrackets,
} from "@/lib/integrations/autoenhance/client";

import { extractOrderImages, formatImageResult, jsonError } from "../_helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const orderId = request.nextUrl.searchParams.get("orderId")?.trim();
    if (!orderId) return jsonError("Order ID is required.", 400);

    const order = await getOrder(orderId, admin.organizationId);
    const brackets = await getOrderBrackets(orderId, admin.organizationId).catch(
      () => null,
    );
    const rawImages = mergeImageRecords(
      extractOrderImages(order),
      brackets?.brackets
        ?.filter((bracket) => bracket.image_id)
        .map((bracket) => ({
          image_id: bracket.image_id,
          image_name: bracket.name,
          bracket_id: bracket.bracket_id,
          status: "processing",
        })) ?? [],
    );
    const images = await Promise.all(
      rawImages.map(async (raw, index) => {
        const id =
          typeof raw.image_id === "string" ? raw.image_id : `image-${index + 1}`;
        const image = await getImage(id, admin.organizationId).catch(() => raw);
        return formatImageResult(image, id);
      }),
    );

    return NextResponse.json({
      ok: true,
      orderId,
      images,
      processStatus: order.status ?? null,
      totalImages: order.total_images ?? null,
      debug: {
        rawImageCount: rawImages.length,
        bracketCount: brackets?.brackets?.length ?? null,
        bracketImageCount:
          brackets?.brackets?.filter((bracket) => bracket.image_id).length ?? null,
        orderKeys: Object.keys(order),
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}

function mergeImageRecords(
  primary: Array<Record<string, unknown>>,
  fallback: Array<Record<string, unknown>>,
) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const record of [...primary, ...fallback]) {
    const id = typeof record.image_id === "string" ? record.image_id : null;
    if (!id) continue;
    byId.set(id, { ...byId.get(id), ...record });
  }
  return [...byId.values()];
}
