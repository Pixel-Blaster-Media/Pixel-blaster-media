import { NextResponse } from "next/server";

import { syncPendingAutoenhanceBatches } from "@/lib/integrations/autoenhance/workflow";

import { runPostShootIGuideDiscovery } from "@/lib/integrations/iguide/post-shoot-discovery";

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
    // Reuse this ten-minute cadence. Discovery is read-only and must not change
    // the Autoenhance result, even if the iGUIDE Portal is unavailable.
    const discovery = process.env.IGUIDE_POST_SHOOT_DISCOVERY_ENABLED === "true"
      ? runPostShootIGuideDiscovery().catch(() => { console.warn("[iguide-post-shoot] discovery unavailable"); })
      : Promise.resolve();
    const [result] = await Promise.all([syncPendingAutoenhanceBatches({ limit: 8 }), discovery]);
    return NextResponse.json(result);
  } catch (err) {
    console.warn("[autoenhance-sync] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
