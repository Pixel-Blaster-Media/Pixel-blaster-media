import { NextResponse } from "next/server";
import { runPostShootIGuideDiscovery } from "@/lib/integrations/iguide/post-shoot-discovery";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false }, { status: 503 });
  if (request.headers.get("authorization") !== "Bearer " + secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...await runPostShootIGuideDiscovery() });
  } catch {
    return NextResponse.json({ ok: false, error: "iGUIDE discovery unavailable" }, { status: 503 });
  }
}
