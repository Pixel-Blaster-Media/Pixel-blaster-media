import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  parseAutoHDRPrepareInput,
  readBoundedAutoHDRJson,
  toAutoHDRRouteError,
} from "@/lib/integrations/autohdr/request-core";
import { prepareBookingAutoHDR } from "@/lib/integrations/autohdr/workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  try {
    const [{ id }, raw] = await Promise.all([
      params,
      readBoundedAutoHDRJson(request),
    ]);
    const input = parseAutoHDRPrepareInput(raw);
    const result = await prepareBookingAutoHDR({
      admin,
      bookingId: id,
      ...input,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    const response = toAutoHDRRouteError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
