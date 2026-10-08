import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { AdminAccessError, requireAdmin } from "@/lib/auth/require-admin";
import { getStreamVideoDetails } from "@/lib/booking/catalog-examples-core";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin("json");
    const { id } = await params;
    const supabase = getServiceSupabase();
    const { data: example, error } = await supabase
      .from("catalog_item_examples")
      .select("id, stream_uid, status")
      .eq("id", id)
      .eq("organization_id", admin.organizationId)
      .eq("source_type", "cloudflare_stream")
      .maybeSingle();
    if (error) return verificationPending("Could not read the video status yet.");
    if (!example?.stream_uid) return jsonError("Video example not found.", 404);
    if (example.status === "failed") return jsonError("Cloudflare could not process that video.", 422);
    if (example.status !== "uploading" && example.status !== "ready") {
      return jsonError("Video example is no longer processing.", 409);
    }

    const details = await getStreamVideoDetails(example.stream_uid);
    if (details.state === "processing") {
      return NextResponse.json({ status: "processing" }, { status: 202, headers: noStoreHeaders() });
    }

    if (details.state === "failed") {
      if (example.status === "uploading") {
        const { data: finalized, error: finalizeError } = await supabase.rpc(
          "finalize_catalog_stream_upload",
          {
            p_example_id: example.id,
            p_organization_id: admin.organizationId,
            p_stream_uid: example.stream_uid,
            p_outcome: "failed",
          },
        );
        if (finalizeError) return verificationPending("Could not confirm the video status yet.");
        if (finalized !== true) {
          return jsonError("Could not safely finalize the video example.", 409);
        }
      }
      revalidatePath("/admin/settings/pricing");
      revalidatePath("/book");
      return jsonError("Cloudflare could not process that video.", 422);
    }
    if (details.width === null || details.height === null) {
      return verificationPending("Cloudflare has not returned usable video dimensions yet.");
    }

    const operation = example.status === "uploading"
      ? "finalize_catalog_stream_upload_with_dimensions"
      : "record_catalog_stream_example_dimensions";
    const { data: recorded, error: recordError } = await supabase.rpc(
      operation,
      {
        p_example_id: example.id,
        p_organization_id: admin.organizationId,
        p_stream_uid: example.stream_uid,
        p_video_width: details.width,
        p_video_height: details.height,
      },
    );
    if (recordError) return verificationPending("Could not confirm the video details yet.");
    if (recorded !== true) {
      return jsonError("Could not safely record the video dimensions.", 409);
    }

    revalidatePath("/admin/settings/pricing");
    revalidatePath("/book");
    return NextResponse.json({ ok: true, status: "ready" }, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof AdminAccessError) {
      if (error.kind === "unavailable") {
        return verificationPending("Could not verify your access yet.", "authentication_unavailable");
      }
      return jsonError(
        error.kind === "unauthenticated"
          ? "Sign in again, then check this video's status. You do not need to upload it again."
          : "You do not have permission to check this video.",
        error.kind === "unauthenticated" ? 401 : 403,
      );
    }
    return verificationPending("Could not check the video yet.");
  }
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error, retryable: false }, { status, headers: noStoreHeaders() });
}

function verificationPending(error: string, code = "verification_unavailable") {
  return NextResponse.json(
    { status: "verification_pending", error, code, retryable: true },
    { status: 503, headers: { ...noStoreHeaders(), "Retry-After": "3" } },
  );
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
}
