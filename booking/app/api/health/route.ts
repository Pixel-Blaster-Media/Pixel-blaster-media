import { NextResponse } from "next/server";

// Simple liveness probe so we can verify Vercel deploys are healthy
// from the browser or a status checker. Returns 200 with build info.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "pixel-blaster-booking",
    phase: 1,
    timestamp: new Date().toISOString(),
  });
}
