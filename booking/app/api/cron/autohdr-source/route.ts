import { NextResponse } from "next/server";

import { runBoundedAutoHDRQuarantineCleanup, runBoundedAutoHDRSourceWorker } from "@/lib/integrations/autohdr/source-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "Scheduled AutoHDR source work is unavailable." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [source, cleanup] = await Promise.all([
      runBoundedAutoHDRSourceWorker(), runBoundedAutoHDRQuarantineCleanup(),
    ]);
    return NextResponse.json({ ok: true, source, cleanup });
  } catch {
    return NextResponse.json({ ok: false, error: "Scheduled AutoHDR source work failed." }, { status: 500 });
  }
}
