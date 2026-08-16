import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  createStreamDirectUpload,
  deleteStreamVideo,
  StreamProvisioningError,
} from "@/lib/booking/catalog-examples-core";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  try {
    const raw = await readBoundedJson(request);
    const catalogItemId = field(raw, "catalogItemId", 80);
    const title = field(raw, "title", 120);
    const description = field(raw, "description", 500);
    const claimId = field(raw, "idempotencyKey", 40);
    if (!catalogItemId || !title || !UUID.test(claimId)) {
      return jsonError("Service, title, and a valid upload operation are required.", 400);
    }

    const supabase = getServiceSupabase();
    const { data: claimResult, error: claimError } = await supabase.rpc(
      "claim_catalog_stream_upload",
      {
        p_claim_id: claimId,
        p_organization_id: admin.organizationId,
        p_catalog_item_id: catalogItemId,
      },
    );
    if (claimError) return jsonError("Could not reserve a safe upload operation.", 503);
    if (claimResult !== "claimed") return claimFailure(claimResult);

    let upload: { uid: string; uploadUrl: string };
    try {
      upload = await createStreamDirectUpload({ name: title, operationId: claimId });
    } catch (error) {
      const claimState = error instanceof StreamProvisioningError && error.outcome === "definitive"
        ? "cleaned"
        : "provider_unknown";
      await setClaimState(claimId, admin.organizationId, claimState);
      return jsonError("Cloudflare Stream could not safely prepare the upload yet.", 503);
    }

    const { data: provisioned, error: ledgerError } = await supabase
      .from("catalog_stream_upload_claims")
      .update({
        stream_uid: upload.uid,
        state: "provisioned",
        updated_at: new Date().toISOString(),
      })
      .eq("id", claimId)
      .eq("organization_id", admin.organizationId)
      .eq("state", "claimed")
      .select("id")
      .maybeSingle();
    if (ledgerError || !provisioned) {
      const deleted = await deleteStreamVideo(upload.uid);
      await setClaimCleanup(
        claimId,
        admin.organizationId,
        upload.uid,
        deleted ? "cleaned" : "cleanup_required",
      );
      return jsonError("Could not persist the prepared upload safely.", 503);
    }

    const { data: exampleId, error: attachError } = await supabase.rpc(
      "attach_catalog_stream_upload",
      {
        p_claim_id: claimId,
        p_organization_id: admin.organizationId,
        p_catalog_item_id: catalogItemId,
        p_stream_uid: upload.uid,
        p_title: title,
        p_description: description || null,
      },
    );
    if (attachError || !exampleId || !UUID.test(exampleId)) {
      const deleted = await deleteStreamVideo(upload.uid);
      await setClaimCleanup(
        claimId,
        admin.organizationId,
        upload.uid,
        deleted ? "cleaned" : "cleanup_required",
      );
      return jsonError("Could not attach the prepared upload safely.", 503);
    }

    return NextResponse.json(
      { exampleId, uploadUrl: upload.uploadUrl },
      { headers: noStoreHeaders() },
    );
  } catch {
    return jsonError("Could not prepare the upload.", 400);
  }
}

async function setClaimState(
  claimId: string,
  organizationId: string,
  state: "provider_unknown" | "cleaned",
): Promise<void> {
  await getServiceSupabase()
    .from("catalog_stream_upload_claims")
    .update({ state, updated_at: new Date().toISOString() })
    .eq("id", claimId)
    .eq("organization_id", organizationId);
}

async function setClaimCleanup(
  claimId: string,
  organizationId: string,
  streamUid: string,
  state: "cleanup_required" | "cleaned",
): Promise<void> {
  await getServiceSupabase()
    .from("catalog_stream_upload_claims")
    .update({ stream_uid: streamUid, state, updated_at: new Date().toISOString() })
    .eq("id", claimId)
    .eq("organization_id", organizationId);
}

function claimFailure(result: string | null) {
  if (result === "rate_limited") return jsonError("This company has reached its hourly video upload limit.", 429);
  if (result === "too_many_pending") return jsonError("Finish or remove an existing pending video before starting another.", 409);
  if (result === "max_examples") return jsonError("A service can have up to eight examples.", 409);
  if (result === "catalog_not_found") return jsonError("Service not found.", 404);
  if (result === "duplicate") return jsonError("That upload operation was already used.", 409);
  return jsonError("Could not reserve the upload.", 409);
}

async function readBoundedJson(request: NextRequest): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > 8192) throw new Error("Upload request is too large.");
  const text = await request.text();
  if (text.length > 8192) throw new Error("Upload request is too large.");
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid upload request.");
  }
  return parsed as Record<string, unknown>;
}

function field(raw: Record<string, unknown>, name: string, max: number): string {
  const value = raw[name];
  return typeof value === "string" && value.trim().length <= max ? value.trim() : "";
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
}
