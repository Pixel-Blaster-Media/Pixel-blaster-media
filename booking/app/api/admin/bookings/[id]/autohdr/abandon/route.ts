import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { parseAutoHDRAbandonInput, readBoundedAutoHDRJson, toAutoHDRRouteError } from "@/lib/integrations/autohdr/request-core";
import { abandonBookingAutoHDR } from "@/lib/integrations/autohdr/workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  try {
    const [{ id }, raw] = await Promise.all([params, readBoundedAutoHDRJson(request)]);
    const input = parseAutoHDRAbandonInput(raw);
    const result = await abandonBookingAutoHDR({ admin, bookingId: id, ...input });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = toAutoHDRRouteError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
