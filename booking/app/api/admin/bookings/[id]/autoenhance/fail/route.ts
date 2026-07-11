import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { markBookingAutoenhanceBatchAttention } from "@/lib/integrations/autoenhance/workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = (await request.json()) as {
      batchId?: string;
      message?: string;
    };
    if (!body.batchId) {
      return NextResponse.json(
        { ok: false, error: "Autoenhance batch ID is required." },
        { status: 400 },
      );
    }
    const result = await markBookingAutoenhanceBatchAttention({
      admin,
      bookingId: id,
      batchId: body.batchId,
      message: body.message ?? "Photo upload did not finish.",
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
