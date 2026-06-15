import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { startBookingAutoenhanceProcessing } from "@/lib/integrations/autoenhance/workflow";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as {
      batchId?: string;
      uploadedBracketIds?: string[];
      uploadedImageIds?: string[];
    };
    if (!body.batchId) {
      return NextResponse.json(
        { ok: false, error: "Autoenhance batch ID is required." },
        { status: 400 },
      );
    }
    const result = await startBookingAutoenhanceProcessing({
      admin,
      batchId: body.batchId,
      uploadedBracketIds: body.uploadedBracketIds ?? [],
      uploadedImageIds: body.uploadedImageIds ?? [],
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
