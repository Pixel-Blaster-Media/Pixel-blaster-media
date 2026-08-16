import { NextResponse } from "next/server";

import { runCatalogStreamCleanup } from "@/lib/booking/catalog-stream-cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Stream cleanup is unavailable." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await runCatalogStreamCleanup());
  } catch {
    return NextResponse.json(
      { ok: false, error: "Stream cleanup or reconciliation failed." },
      { status: 503 },
    );
  }
}
