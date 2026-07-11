import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  createBookingAutoenhanceBatch,
  type AutoenhanceWorkflowSettingsInput,
} from "@/lib/integrations/autoenhance/workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = (await request.json()) as {
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
      bracketsPerImage?: number;
    };
    const settings: AutoenhanceWorkflowSettingsInput = {
      uploadMode: body.uploadMode === "single" ? "single" : "hdr",
      enhanceType: body.enhanceType,
      presetId: body.presetId,
      skyReplacement: Boolean(body.skyReplacement),
      cloudType: body.cloudType,
      windowPullType: body.windowPullType,
      privacy: body.privacy !== false,
      upscale: Boolean(body.upscale),
      tripodHide: Boolean(body.tripodHide),
      fireInFireplaces: Boolean(body.fireInFireplaces),
      greenGrass: Boolean(body.greenGrass),
      removePhotographer: Boolean(body.removePhotographer),
      blackOutTvs: Boolean(body.blackOutTvs),
      bracketsPerImage: Number(body.bracketsPerImage),
    };

    const result = await createBookingAutoenhanceBatch({
      admin,
      bookingId: id,
      fileNames: body.fileNames ?? [],
      settings,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
