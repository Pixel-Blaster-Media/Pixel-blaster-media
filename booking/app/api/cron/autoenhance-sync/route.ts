import { NextResponse } from "next/server";

import { syncPendingAutoenhanceBatches } from "@/lib/integrations/autoenhance/workflow";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET must be configured before Autoenhance background sync can run.",
      },
      { status: 503 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const result = await syncPendingAutoenhanceBatches({ limit: 8 });
    return NextResponse.json(result);
  } catch (err) {
    console.warn("[autoenhance-sync] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
