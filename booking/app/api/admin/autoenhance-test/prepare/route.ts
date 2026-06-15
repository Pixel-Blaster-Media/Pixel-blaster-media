import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  createBracket,
  createImage,
  createOrder,
} from "@/lib/integrations/autoenhance/client";

import {
  formatImageResult,
  jsonError,
  type PreparedUpload,
} from "../_helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as {
      orderName?: string;
      fileNames?: string[];
      uploadMode?: string;
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
    const fileNames = (body.fileNames ?? [])
      .map((name) => String(name).trim())
      .filter(Boolean);
    if (!fileNames.length) {
      return jsonError("Pick at least one image.", 400);
    }

    const orderName =
      body.orderName?.trim() || `Autoenhance test ${new Date().toISOString()}`;
    const order = await createOrder(orderName, admin.organizationId);
    const orderId = order.order_id;
    if (!orderId) {
      return jsonError("Autoenhance did not return order_id.", 502);
    }

    const uploadMode = body.uploadMode === "hdr" ? "hdr" : "single";
    const uploads: PreparedUpload[] = [];
    for (const fileName of fileNames) {
      if (uploadMode === "single") {
        const image = await createImage(
          {
            orderId,
            imageName: fileName,
            enhanceType: normalizeEnhanceType(body.enhanceType),
            presetId: body.presetId?.trim() || undefined,
            skyReplacement: Boolean(body.skyReplacement),
            cloudType: normalizeCloudType(body.cloudType),
            windowPullType: normalizeWindowPullType(body.windowPullType),
            privacy: body.privacy !== false,
            upscale: Boolean(body.upscale),
            tripodHide: Boolean(body.tripodHide),
            restage: {
              ...(body.fireInFireplaces
                ? { fire_in_fireplaces: "ALIGHT" as const }
                : {}),
              ...(body.greenGrass ? { grass: "GREEN" as const } : {}),
              ...(body.removePhotographer
                ? { photographer: "REMOVE" as const }
                : {}),
              ...(body.blackOutTvs ? { tvs: "BLACK_OUT" as const } : {}),
            },
          },
          admin.organizationId,
        );
        if (!image.image_id || !image.upload_url) {
          return jsonError(
            `Autoenhance did not return image_id/upload_url for ${fileName}.`,
            502,
          );
        }
        uploads.push({
          ...formatImageResult(
            {
              image_id: image.image_id,
              image_name: image.image_name ?? fileName,
              status: image.status ?? "registered",
            },
            fileName,
          ),
          uploadKind: "image",
          uploadUrl: image.upload_url,
        });
        continue;
      }

      const bracket = await createBracket(
        { orderId, name: fileName },
        admin.organizationId,
      );
      if (!bracket.bracket_id || !bracket.upload_url) {
        return jsonError(
          `Autoenhance did not return bracket_id/upload_url for ${fileName}.`,
          502,
        );
      }
      const pendingId = bracket.image_id ?? `bracket:${bracket.bracket_id}`;
      uploads.push({
        ...formatImageResult(
          {
            image_id: pendingId,
            image_name: bracket.name ?? fileName,
            status: bracket.is_uploaded ? "uploaded" : "registered",
          },
          fileName,
        ),
        uploadKind: "bracket",
        bracketId: bracket.bracket_id,
        uploadUrl: bracket.upload_url,
      });
    }

    return NextResponse.json({
      ok: true,
      orderId,
      orderName,
      uploadMode,
      uploads,
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
