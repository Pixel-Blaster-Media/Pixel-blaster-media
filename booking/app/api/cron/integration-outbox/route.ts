import { NextResponse } from "next/server";

import { runCatalogStreamCleanup } from "@/lib/booking/catalog-stream-cleanup";
import { runScheduledIntegrationOutbox } from "@/lib/integrations/scheduler";
import {
  integrationOutboxDispatchEnabled,
  parseDispatchWatermark,
} from "@/lib/integrations/scheduler-core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Scheduled integration dispatch is unavailable." },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  if (!integrationOutboxDispatchEnabled(
    process.env.INTEGRATION_OUTBOX_DISPATCH_ENABLED,
  )) {
    try {
      const streamCleanup = await runCatalogStreamCleanup();
      return NextResponse.json({ ok: streamCleanup.ok, enabled: false, streamCleanup });
    } catch {
      return NextResponse.json(
        { ok: false, enabled: false, error: "Scheduled Stream cleanup failed." },
        { status: 500 },
      );
    }
  }

  let dispatchNotBefore: string;
  try {
    dispatchNotBefore = parseDispatchWatermark(
      process.env.INTEGRATION_OUTBOX_DISPATCH_NOT_BEFORE,
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Scheduled integration dispatch watermark is unavailable." },
      { status: 503 },
    );
  }
  try {
    const [result, streamCleanup] = await Promise.all([
      runScheduledIntegrationOutbox({ dispatchNotBefore }),
      runCatalogStreamCleanup().catch(() => ({
        ok: false,
        reconciled: 0,
        attempted: 0,
        cleaned: 0,
        retryable: 0,
        providerUnknown: 0,
      })),
    ]);
    return NextResponse.json({ ...result, enabled: true, streamCleanup });
  } catch {
    console.error("[integration-outbox-cron] scheduler failed", {
      kind: "scheduler_failure",
    });
    return NextResponse.json(
      { ok: false, error: "Scheduled integration dispatch failed." },
      { status: 500 },
    );
  }
}
