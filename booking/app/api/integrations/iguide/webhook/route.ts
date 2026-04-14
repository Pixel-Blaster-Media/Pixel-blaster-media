import { NextResponse, type NextRequest } from "next/server";

import {
  parseIGuideId,
  iguideViewerUrl,
} from "@/lib/integrations/iguide/parse-id";
import { syncIGuideById } from "@/lib/integrations/iguide/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * iGuide webhook receiver.
 *
 * iGuide POSTs JSON when an event fires (currently the only documented
 * event is `ready` — a tour just published). We:
 *   1. Verify the shared secret from `?secret=` against the env var.
 *      iGuide's docs (as of writing) don't describe HMAC signing, so
 *      we use a long secret in the URL itself; configure the same
 *      value in your iGuide portal webhook config.
 *   2. Pull the iguide_id out of the payload (tolerating a few shapes).
 *   3. Look up the matching booking and sync deliverables. If no
 *      booking is tagged with this iguide_id yet, we still 200 so iGuide
 *      doesn't keep retrying — log a warning so the admin can investigate.
 *   4. On transient failure (DB/network), 500 — iGuide will retry every
 *      10–15 min up to five times.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.IGUIDE_WEBHOOK_SECRET;
  if (!expected) {
    console.error(
      "[iguide.webhook] IGUIDE_WEBHOOK_SECRET is not configured — refusing to process event.",
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

  const iguideId = extractIGuideId(body);
  if (!iguideId) {
    console.warn(
      "[iguide.webhook] Couldn't find iguide_id in payload — accepting to avoid retry storm.",
      body,
    );
    return NextResponse.json({ ok: true, skipped: "no_id" });
  }

  const result = await syncIGuideById(iguideId);

  if (!result.ok) {
    // Distinguish "not in our system" (don't retry) from a real failure (do retry).
    if (
      result.error?.startsWith("No booking is tagged") ||
      result.error?.includes("not found")
    ) {
      console.warn(
        `[iguide.webhook] Received 'ready' for ${iguideId} (${iguideViewerUrl(
          iguideId,
        )}) but no booking is tagged with it. Tag the booking and click Sync.`,
      );
      return NextResponse.json({ ok: true, skipped: "untagged" });
    }
    console.error("[iguide.webhook] sync failed", result.error);
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    booking_id: result.bookingId,
    upserts: result.upserts,
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
 * iGuide's `ready` event payload shape isn't fully publicly documented.
 * We try a few common field placements before giving up — the iguide_id
 * (URL slug) is the only field we strictly require.
 */
function extractIGuideId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;

  const candidates: unknown[] = [
    obj.iguide_id,
    obj.id,
    obj.viewId,
    obj.view_id,
    obj.slug,
    obj.url,
    (obj.data as Record<string, unknown> | undefined)?.id,
    (obj.data as Record<string, unknown> | undefined)?.iguide_id,
    (obj.data as Record<string, unknown> | undefined)?.url,
    (obj.view as Record<string, unknown> | undefined)?.id,
    (obj.view as Record<string, unknown> | undefined)?.url,
  ];

  for (const c of candidates) {
    if (typeof c !== "string" || !c.trim()) continue;
    const parsed = parseIGuideId(c);
    if (parsed) return parsed;
  }
  return null;
}
