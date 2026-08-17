import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getStreamVideoState } from "@/lib/booking/catalog-examples-core";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  try {
    const { id } = await params;
    const supabase = getServiceSupabase();
    const { data: example, error } = await supabase
      .from("catalog_item_examples")
      .select("id, stream_uid, status")
      .eq("id", id)
      .eq("organization_id", admin.organizationId)
      .eq("source_type", "cloudflare_stream")
      .maybeSingle();
    if (error || !example?.stream_uid) return jsonError("Video example not found.", 404);
    if (example.status === "ready") return NextResponse.json({ ok: true, status: "ready" }, { headers: noStoreHeaders() });
    if (example.status === "failed") return jsonError("Cloudflare could not process that video.", 422);
    if (example.status !== "uploading") return jsonError("Video example is no longer processing.", 409);

    const state = await getStreamVideoState(example.stream_uid);
    if (state === "processing") {
      return NextResponse.json({ status: "processing" }, { status: 202, headers: noStoreHeaders() });
    }

    const { data: finalized, error: finalizeError } = await supabase.rpc(
      "finalize_catalog_stream_upload",
      {
        p_example_id: example.id,
        p_organization_id: admin.organizationId,
        p_stream_uid: example.stream_uid,
        p_outcome: state,
      },
    );
    if (finalizeError || finalized !== true) {
      return jsonError("Could not safely finalize the video example.", 409);
    }

    revalidatePath("/admin/settings/pricing");
    revalidatePath("/book");
    if (state === "failed") return jsonError("Cloudflare could not process that video.", 422);
    return NextResponse.json({ ok: true, status: "ready" }, { headers: noStoreHeaders() });
  } catch {
    return jsonError("Could not check the video yet.", 503);
  }
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
}
