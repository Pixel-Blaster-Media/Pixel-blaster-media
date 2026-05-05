import { NextResponse, type NextRequest } from "next/server";

import { getCredential } from "@/lib/integrations/credentials";
import { iguideViewerUrl } from "@/lib/integrations/iguide/parse-id";
import type { IGuideReadyEvent } from "@/lib/integrations/iguide/portal-client";
import { syncIGuideFromWebhook } from "@/lib/integrations/iguide/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * iGuide webhook receiver.
 *
 * iGuide POSTs JSON when an event fires. Currently the only supported
 * event type is `ready` — a tour just published. Payload shape is
 * documented at https://docs.youriguide.com/rest/webhooks.html and
 * modeled in `IGuideReadyEvent`.
 *
 * Auth: iGuide's webhook spec doesn't describe HMAC signing, so we use
 * a long shared secret passed as a URL query param (?secret=...). Set
 * the same value in your iGuide Portal's webhook config and in Vercel
 * env `IGUIDE_WEBHOOK_SECRET`.
 *
 * Retry semantics: per iGuide's docs, 2xx = processed; 5xx = retry
 * (they'll try again every 10-15 min up to 5 times); any other status
 * silently drops the event. So we:
 *   - 200 for success
 *   - 200 for "unknown-to-us tour" (don't want infinite retries for
 *     tours that were never tagged to a booking)
 *   - 200 for malformed payloads (same — retrying won't help)
 *   - 500 only for transient DB/network failures our side
 */
export async function POST(request: NextRequest) {
  const expected = await getCredential(
    "iguide",
    "webhook_secret",
    "IGUIDE_WEBHOOK_SECRET",
  );
  if (!expected) {
    console.error(
      "[iguide.webhook] webhook secret is not configured — refusing to process event.",
    );
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const provided = request.nextUrl.searchParams.get("secret");
  if (!provided || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!isReadyEvent(body)) {
    console.warn(
      "[iguide.webhook] Ignoring event (unsupported type or no iguideId).",
      summarize(body),
    );
    // 200 so iGuide doesn't retry — retrying won't help for malformed events.
    return NextResponse.json({ ok: true, skipped: "unsupported_event" });
  }

  const result = await syncIGuideFromWebhook(body);

  if (!result.ok) {
    const untagged = result.error?.startsWith("No booking is tagged");
    if (untagged) {
      console.warn(
        `[iguide.webhook] Received 'ready' for iGuide ${body.iguideId} (${iguideViewerUrl(
          body.iguideAlias ?? body.iguideId,
        )}) but no booking matched it confidently. Event was kept for admin review if the event inbox table exists.`,
      );
      return NextResponse.json({ ok: true, skipped: "unmatched_for_review" });
    }
    console.error("[iguide.webhook] sync failed", result.error);
    // 500 triggers iGuide's retry — appropriate for transient failures.
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    booking_id: result.bookingId,
    upserts: result.upserts,
    address: result.address,
  });
}

/** Constant-time string compare so an attacker can't bisect the secret. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Narrow an unknown webhook body to a ready event. iGuide docs spell
 * out the shape — we only require type='ready' + a non-empty
 * iguideId to accept it; everything else is optional.
 */
function isReadyEvent(body: unknown): body is IGuideReadyEvent {
  if (!body || typeof body !== "object") return false;
  const obj = body as Record<string, unknown>;
  if (obj.type !== "ready") return false;
  if (typeof obj.iguideId !== "string" || !obj.iguideId.trim()) return false;
  return true;
}

/** Log-friendly summary of an unknown payload (never logs secrets). */
function summarize(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return { kind: typeof body };
  const obj = body as Record<string, unknown>;
  return {
    type: obj.type,
    keys: Object.keys(obj).slice(0, 12),
  };
}
