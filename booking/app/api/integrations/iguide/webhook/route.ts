import { createHash, timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

import type { IGuideReadyEvent } from "@/lib/integrations/iguide/portal-client";
import { syncIGuideFromWebhook } from "@/lib/integrations/iguide/sync";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 512 * 1024;

interface IGuideCredentialRow {
  organization_id: string;
  credentials: Record<string, string> | null;
}

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
 *   - 200 for "unknown-to-us tour" (unrelated tours are not retained)
 *   - 200 for malformed payloads (same — retrying won't help)
 *   - 500 only for transient DB/network failures our side
 */
export async function POST(request: NextRequest) {
  const provided = request.nextUrl.searchParams.get("secret");
  const organizationId = provided
    ? await resolveWebhookOrganizationId(provided)
    : null;

  if (!provided || !organizationId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
      return NextResponse.json(
        { ok: false, error: "payload_too_large" },
        { status: 413 },
      );
    }
    body = JSON.parse(rawBody);
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

  const result = await syncIGuideFromWebhook(body, { organizationId });

  if (result.skipped) {
    return NextResponse.json({ ok: true, skipped: result.skipped });
  }

  if (!result.ok) {
    console.error("[iguide.webhook] sync failed", result.error);
    // 500 triggers iGuide's retry — appropriate for transient failures.
    return NextResponse.json(
      { ok: false, error: "sync_failed" },
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

async function resolveWebhookOrganizationId(
  provided: string,
): Promise<string | null> {
  const envSecret = process.env.IGUIDE_WEBHOOK_SECRET?.trim();
  if (envSecret && secretsMatch(provided, normalizeWebhookSecret(envSecret))) {
    return DEFAULT_ORGANIZATION_ID;
  }

  const { data, error } = await getServiceSupabase()
    .from("integration_credentials")
    .select("organization_id, credentials")
    .eq("provider", "iguide")
    .returns<IGuideCredentialRow[]>();

  if (error) {
    console.warn("[iguide.webhook] failed to resolve webhook organization", error);
    return null;
  }

  for (const row of data ?? []) {
    const secret = row.credentials?.webhook_secret?.trim();
    if (secret && secretsMatch(provided, normalizeWebhookSecret(secret))) {
      return row.organization_id;
    }
  }

  return null;
}

/** Compare fixed-size digests so secret length does not short-circuit. */
function secretsMatch(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

function normalizeWebhookSecret(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("secret")?.trim() || trimmed;
  } catch {
    return trimmed;
  }
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
