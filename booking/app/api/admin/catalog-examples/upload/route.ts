import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  createStreamDirectUpload,
  createStreamTusUpload,
  inspectStreamTusReservation,
  deleteStreamVideo,
  StreamProvisioningError,
} from "@/lib/booking/catalog-examples-core";
import { getServiceSupabase } from "@/lib/supabase/server";
import { validCatalogUploadSize, validUploadFingerprint, validStreamUploadCapability } from "@/lib/booking/catalog-upload-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Inspect an existing same-company reservation without reserving, attaching or deleting anything.
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  const claimId = new URL(request.url).searchParams.get("claimId") ?? "";
  if (!UUID.test(claimId)) return jsonError("A valid upload operation is required.", 400);
  const { data: claim, error } = await getServiceSupabase().from("catalog_stream_upload_claims")
    .select("state, stream_uid, upload_expires_at")
    .eq("id", claimId).eq("organization_id", admin.organizationId).eq("upload_protocol", "tus").maybeSingle();
  if (error) return jsonError("Could not inspect this upload operation.", 503);
  if (!claim) return jsonError("Upload operation not found.", 404);
  if (!claim.stream_uid || !claim.upload_expires_at) {
    return NextResponse.json({ state: claim.state, inspection: null }, { headers: noStoreHeaders() });
  }
  try {
    const inspection = await inspectStreamTusReservation({ uid: claim.stream_uid,
      operationId: claimId, expiresAt: claim.upload_expires_at });
    return NextResponse.json({ state: claim.state, inspection }, { headers: noStoreHeaders() });
  } catch {
    return jsonError("Could not safely inspect this upload operation.", 503);
  }
}

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
    if (raw.protocol !== undefined && raw.protocol !== "tus") return jsonError("Unsupported upload method.", 400);
    if (raw.protocol === "tus") {
      if (!validCatalogUploadSize(raw.size) || !validUploadFingerprint(raw.fingerprint)) {
        return jsonError("Choose a video of 1 GB or smaller.", 400);
      }
      return prepareResumableUpload({ catalogItemId, title, description, claimId,
        organizationId: admin.organizationId, size: raw.size, fingerprint: raw.fingerprint });
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

async function prepareResumableUpload(input: {
  catalogItemId: string; title: string; description: string; claimId: string;
  organizationId: string; size: number; fingerprint: string;
}) {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc("claim_catalog_resumable_upload", {
    p_claim_id: input.claimId, p_organization_id: input.organizationId,
    p_catalog_item_id: input.catalogItemId, p_upload_size: input.size, p_upload_fingerprint: input.fingerprint,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return jsonError("Could not reserve a resumable upload.", 503);
  const claimId = data.claim_id, expiresAt = data.expires_at;
  if (data.status !== "claimed" && data.status !== "resume") return claimFailure(typeof data.status === "string" ? data.status : null);
  if (typeof claimId !== "string" || !UUID.test(claimId) || typeof expiresAt !== "string"
      || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) return jsonError("Upload reservation is invalid or expired.", 409);
  if (data.status === "claimed") {
    let upload: { uid: string; uploadUrl: string };
    try {
      upload = await createStreamTusUpload({ name: input.title, operationId: claimId,
        size: input.size, expiresAt: new Date(expiresAt).toISOString() });
    } catch (caught) {
      const inspection = caught instanceof StreamProvisioningError ? caught.diagnostic ?? null : null;
      console.error("catalog_resumable_preparation_failed", {
        outcome: caught instanceof StreamProvisioningError ? caught.outcome : "unknown",
        knownVideo: caught instanceof StreamProvisioningError && Boolean(caught.streamUid),
        inspection,
      });
      if (caught instanceof StreamProvisioningError && caught.streamUid) {
        await setClaimCleanup(claimId, input.organizationId, caught.streamUid, "cleanup_required");
      } else await setClaimState(claimId, input.organizationId,
        caught instanceof StreamProvisioningError && caught.outcome === "definitive" ? "cleaned" : "provider_unknown");
      // This authenticated response preserves only the same safe diagnostic as the log.
      return NextResponse.json({ error: "Cloudflare could not safely prepare this upload. Resolve the pending operation before starting another copy.", inspection },
        { status: 503, headers: noStoreHeaders() });
    }
    const { data: stored, error: persistError } = await supabase.from("catalog_stream_upload_claims")
      .update({ stream_uid: upload.uid, upload_url: upload.uploadUrl, state: "provisioned", updated_at: new Date().toISOString() })
      .eq("id", claimId).eq("organization_id", input.organizationId).eq("state", "claimed")
      .eq("upload_protocol", "tus").select("id").maybeSingle();
    if (persistError || !stored) {
      const deleted = await deleteStreamVideo(upload.uid);
      await setClaimCleanup(claimId, input.organizationId, upload.uid, deleted ? "cleaned" : "cleanup_required");
      return jsonError("Could not persist the upload safely.", 503);
    }
  }
  const readClaim = () => supabase.from("catalog_stream_upload_claims")
    .select("id, state, stream_uid, example_id, upload_url, upload_size, upload_fingerprint, upload_expires_at")
    .eq("id", claimId).eq("organization_id", input.organizationId).eq("catalog_item_id", input.catalogItemId)
    .eq("upload_protocol", "tus").maybeSingle();
  let { data: claim, error: readError } = await readClaim();
  if (readError || !claim || claim.upload_size !== input.size || claim.upload_fingerprint !== input.fingerprint
      || !claim.upload_expires_at || Date.parse(claim.upload_expires_at) <= Date.now()) return jsonError("This upload cannot be resumed. Cancel it and start again.", 409);
  if (claim.state === "claimed" || claim.state === "provider_unknown") return jsonError("Upload preparation is still pending. Retry shortly; do not start another copy.", 409);
  if (claim.state === "provisioned" && claim.stream_uid) {
    const { error: attachError } = await supabase.rpc("attach_catalog_stream_upload", {
      p_claim_id: claimId, p_organization_id: input.organizationId, p_catalog_item_id: input.catalogItemId,
      p_stream_uid: claim.stream_uid, p_title: input.title, p_description: input.description || null,
    });
    if (attachError) return jsonError("Could not attach this upload safely. Retry shortly.", 503);
    // Concurrent attachment may have completed already. Read it, never delete that video.
    ({ data: claim, error: readError } = await readClaim());
  }
  if (readError || claim?.state !== "attached" || !claim.example_id || !UUID.test(claim.example_id)
      || claim.upload_size !== input.size || claim.upload_fingerprint !== input.fingerprint
      || !claim.upload_expires_at || Date.parse(claim.upload_expires_at) <= Date.now()
      || !validStreamUploadCapability(claim.upload_url)) return jsonError("This upload is no longer available to resume.", 409);
  return NextResponse.json({ exampleId: claim.example_id, uploadUrl: claim.upload_url,
    expiresAt: claim.upload_expires_at, resumed: data.status === "resume" }, { headers: noStoreHeaders() });
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
