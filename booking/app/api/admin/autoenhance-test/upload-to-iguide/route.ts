import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  AutoenhanceError,
  fetchEnhancedImage,
  getImage,
} from "@/lib/integrations/autoenhance/client";
import { uploadAssetToIGuide } from "@/lib/integrations/iguide/portal-client";

import { jsonError } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UploadToIGuideRequest = {
  iguideId?: string;
  imageIds?: string[];
};

type IGuideUploadResult = {
  imageId: string;
  filename: string;
  assetName?: string;
  jid?: string;
  ok: boolean;
  error?: string;
  warning?: string;
  processComplete?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as UploadToIGuideRequest;
    const iguideId = parseIGuideId(body.iguideId ?? "");
    const imageIds = [...new Set(body.imageIds ?? [])]
      .map((id) => String(id).trim())
      .filter((id) => id && !id.startsWith("bracket"));

    if (!iguideId) return jsonError("iGUIDE Portal ID is required.", 400);
    if (!imageIds.length) {
      return jsonError("No finished Autoenhance image IDs were provided.", 400);
    }
    if (imageIds.length > 80) {
      return jsonError("Upload 80 photos or fewer at a time for this test.", 400);
    }

    const results: IGuideUploadResult[] = [];
    for (const [index, imageId] of imageIds.entries()) {
      try {
        const image = await getImage(imageId, admin.organizationId).catch(
          () => null,
        );
        if (image?.status && image.status.toLowerCase().includes("fail")) {
          results.push({
            imageId,
            filename: defaultFilename(imageId, index),
            ok: false,
            error: `Autoenhance status is ${image.status}.`,
          });
          continue;
        }

        const enhancedResult = await fetchEnhancedForIGuide(
          imageId,
          admin.organizationId,
        );
        const enhanced = enhancedResult.response;
        const bytes = await enhanced.arrayBuffer();
        const filename = safePhotoFilename(
          image?.image_name ?? defaultFilename(imageId, index),
          index,
          enhancedResult.usedPreview,
        );

        const uploaded = await uploadAssetToIGuide(
          {
            iguideId,
            filename,
            bytes,
            contentType: enhanced.headers.get("content-type") ?? "image/jpeg",
            appendToViews: "default",
            waitForProcess: true,
          },
          { organizationId: admin.organizationId },
        );
        if (!uploaded.ok || !uploaded.data) {
          results.push({
            imageId,
            filename,
            ok: false,
            error: uploaded.error ?? "iGUIDE upload failed.",
          });
          continue;
        }

        results.push({
          imageId,
          filename,
          ok: true,
          assetName: uploaded.data.assetName,
          jid: uploaded.data.jid,
          warning: [enhancedResult.warning, uploaded.data.processWarning]
            .filter(Boolean)
            .join(" "),
          processComplete: uploaded.data.processComplete,
        });
      } catch (err) {
        results.push({
          imageId,
          filename: defaultFilename(imageId, index),
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      iguideId,
      uploadedCount: results.filter((result) => result.ok).length,
      failedCount: results.filter((result) => !result.ok).length,
      results,
    });
  } catch (err) {
    return jsonError(err);
  }
}

async function fetchEnhancedForIGuide(
  imageId: string,
  organizationId: string,
): Promise<{ response: Response; usedPreview: boolean; warning?: string }> {
  try {
    return {
      response: await fetchEnhancedImage(imageId, {
        organizationId,
        format: "jpeg",
        quality: 90,
        preview: false,
      }),
      usedPreview: false,
    };
  } catch (err) {
    if (err instanceof AutoenhanceError && err.status === 402) {
      try {
        return {
          response: await fetchEnhancedImage(imageId, {
            organizationId,
            format: "jpeg",
            quality: 90,
            preview: false,
            devMode: true,
          }),
          usedPreview: false,
          warning:
            "Autoenhance full-resolution download returned 402/no plan, so this test used Autoenhance development mode. The image may be watermarked. Add an Autoenhance plan before using this for client delivery.",
        };
      } catch {
        return {
          response: await fetchEnhancedImage(imageId, {
            organizationId,
            format: "jpeg",
            quality: 85,
            preview: true,
          }),
          usedPreview: true,
          warning:
            "Autoenhance full-resolution download returned 402/no plan, so this test uploaded the preview image. Add an Autoenhance plan before using this for client delivery.",
        };
      }
    }
    throw err;
  }
}

function safePhotoFilename(name: string, index: number, preview: boolean) {
  const cleaned = name
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${cleaned || `autoenhance-photo-${index + 1}`}${preview ? "-preview" : ""}.jpg`;
}

function defaultFilename(imageId: string, index: number) {
  return `autoenhance-${index + 1}-${imageId}.jpg`;
}

function parseIGuideId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  } catch {
    return trimmed;
  }
}
