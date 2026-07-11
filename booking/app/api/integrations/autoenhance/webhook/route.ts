import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { getCredential } from "@/lib/integrations/credentials";
import { refreshBookingAutoenhanceBatch } from "@/lib/integrations/autoenhance/workflow";
import { getServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type BatchLookupRow = {
  id: string;
  booking_id: string;
};

export async function POST(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("org")?.trim() ?? "";
  if (!isUuid(organizationId)) {
    return NextResponse.json({ ok: false, error: "Invalid organization." }, { status: 400 });
  }

  const configuredSecret = await getCredential(
    "autoenhance",
    "webhook_secret",
    "AUTOENHANCE_WEBHOOK_SECRET",
    organizationId,
  );
  if (!configuredSecret) {
    return NextResponse.json(
      { ok: false, error: "Autoenhance webhook authentication is not configured." },
      { status: 503 },
    );
  }
  const suppliedSecret = webhookSecretFrom(request);
  if (!suppliedSecret || !safeEqual(suppliedSecret, configuredSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return NextResponse.json({ ok: false, error: "Webhook body is too large." }, { status: 413 });
  }

  const rawBody = await request.text();
  if (rawBody.length > 16_384) {
    return NextResponse.json({ ok: false, error: "Webhook body is too large." }, { status: 413 });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!isRecord(parsed)) throw new Error("Payload must be an object.");
    payload = parsed;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const event = firstString(payload, ["event", "event_type", "type"]);
  if (event === "webhook_updated" || event === "image_registered") {
    return NextResponse.json({ ok: true, accepted: event });
  }
  if (event !== "image_processed") {
    return NextResponse.json({ ok: true, ignored: event ?? "unknown" });
  }

  const data = isRecord(payload.data) ? payload.data : payload;
  const orderId = firstString(data, ["order_id", "orderId"]);
  const imageId = firstString(data, ["image_id", "imageId"]);
  if (!orderId || !imageId) {
    return NextResponse.json(
      { ok: false, error: "image_processed requires order_id and image_id." },
      { status: 400 },
    );
  }

  const service = getServiceSupabase();
  const { data: batch, error } = await service
    .from("autoenhance_batches")
    .select("id, booking_id")
    .eq("organization_id", organizationId)
    .eq("order_id", orderId)
    .maybeSingle<BatchLookupRow>();
  if (error) {
    return NextResponse.json({ ok: false, error: "Could not find Autoenhance batch." }, { status: 500 });
  }
  if (!batch) {
    return NextResponse.json({ ok: true, ignored: "order_not_tracked" });
  }

  const orderIsProcessing = booleanField(data, "order_is_processing");
  const imageHasError = booleanField(data, "error") === true;
  const result = await refreshBookingAutoenhanceBatch({
    admin: {
      userId: "system:autoenhance-webhook",
      organizationId,
      email: "system@pixelbooking.local",
      fullName: "Autoenhance Webhook",
    },
    bookingId: batch.booking_id,
    batchId: batch.id,
    preferredImageId:
      imageHasError || orderIsProcessing === false ? undefined : imageId,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    status: result.batch.status,
  });
}

function webhookSecretFrom(request: Request): string | null {
  for (const name of [
    "authorization",
    "authentication",
    "x-autoenhance-webhook-secret",
    "x-webhook-secret",
  ]) {
    const value = request.headers.get(name)?.trim();
    if (value) return value.replace(/^Bearer\s+/i, "").trim();
  }
  return null;
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function booleanField(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  return typeof record[key] === "boolean" ? record[key] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
