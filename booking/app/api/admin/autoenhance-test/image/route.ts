import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getImage } from "@/lib/integrations/autoenhance/client";

import { formatImageResult, jsonError } from "../_helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const imageId = request.nextUrl.searchParams.get("imageId")?.trim();
    if (!imageId) return jsonError("Image ID is required.", 400);
    const image = await getImage(imageId, admin.organizationId);
    return NextResponse.json({
      ok: true,
      image: formatImageResult(image, imageId),
    });
  } catch (err) {
    return jsonError(err);
  }
}
