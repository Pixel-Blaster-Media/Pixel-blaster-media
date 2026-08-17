"use server";

import { revalidatePath } from "next/cache";

import {
  deleteStreamVideo,
  parseExampleUrl,
} from "@/lib/booking/catalog-examples-core";
import { normalizeCatalogSampleGroupInput } from "@/lib/booking/catalog-sample-groups";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getServiceSupabase } from "@/lib/supabase/server";

export interface ExampleActionResult {
  ok: boolean;
  error?: string;
}

const KINDS = new Set(["video", "interactive", "link"]);

export async function attachCatalogExample(formData: FormData): Promise<ExampleActionResult> {
  const admin = await requireAdmin();
  const catalogItemId = text(formData, "catalog_item_id");
  const title = text(formData, "title");
  const description = text(formData, "description");
  const kind = text(formData, "kind");
  const sampleGroup = normalizeCatalogSampleGroupInput(
    text(formData, "sample_group"),
    text(formData, "custom_sample_group_label"),
  );
  const externalUrl = parseExampleUrl(text(formData, "external_url"));

  if (!catalogItemId) return { ok: false, error: "Choose a service." };
  if (!title || title.length > 120) return { ok: false, error: "Example title must be 1–120 characters." };
  if (description.length > 500) return { ok: false, error: "Description must be 500 characters or fewer." };
  if (!KINDS.has(kind)) return { ok: false, error: "Choose a valid example type." };
  if (!sampleGroup) return { ok: false, error: "Choose where this sample should appear." };
  if (!externalUrl) return { ok: false, error: "Enter a valid HTTPS example URL." };

  const supabase = getServiceSupabase();
  const { data: attachedId, error } = await supabase.rpc(
    "attach_external_catalog_example",
    {
      p_organization_id: admin.organizationId,
      p_catalog_item_id: catalogItemId,
      p_title: title,
      p_description: description || null,
      p_kind: kind,
      p_external_url: externalUrl,
      p_sample_group_key: sampleGroup.key,
      p_sample_group_label: sampleGroup.label,
    },
  );
  if (error || !attachedId) {
    return { ok: false, error: "Could not attach the example. The service may already have eight examples." };
  }

  revalidatePath("/admin/settings/pricing");
  revalidatePath("/book");
  return { ok: true };
}

export async function attachSharedCatalogVideo(formData: FormData): Promise<ExampleActionResult> {
  const admin = await requireAdmin();
  const catalogItemId = text(formData, "catalog_item_id");
  const sourceExampleId = text(formData, "source_example_id");
  const title = text(formData, "title");
  const description = text(formData, "description");
  if (!catalogItemId || !sourceExampleId) return { ok: false, error: "Choose a reusable video." };
  if (!title || title.length > 120) return { ok: false, error: "Example title must be 1–120 characters." };
  if (description.length > 500) return { ok: false, error: "Description must be 500 characters or fewer." };

  const supabase = getServiceSupabase();
  const [{ data: source, error: sourceError }, { data: target, error: targetError }] = await Promise.all([
    supabase
      .from("catalog_item_examples")
      .select("id, catalog_item_id")
      .eq("organization_id", admin.organizationId)
      .eq("id", sourceExampleId)
      .eq("source_type", "cloudflare_stream")
      .eq("status", "ready")
      .eq("active", true)
      .maybeSingle(),
    supabase
      .from("catalog_items")
      .select("id")
      .eq("organization_id", admin.organizationId)
      .eq("id", catalogItemId)
      .maybeSingle(),
  ]);
  if (sourceError || targetError || !source || !target || source.catalog_item_id === catalogItemId) {
    return { ok: false, error: "That reusable video is unavailable for this service." };
  }

  const { data: placementId, error } = await supabase.rpc(
    "attach_shared_catalog_stream_example",
    {
      p_organization_id: admin.organizationId,
      p_catalog_item_id: catalogItemId,
      p_source_example_id: sourceExampleId,
      p_title: title,
      p_description: description || null,
    },
  );
  if (error || !placementId) {
    return { ok: false, error: "Could not reuse the video. It may already be attached or the service may have eight examples." };
  }
  revalidatePath("/admin/settings/pricing");
  revalidatePath("/book");
  return { ok: true };
}

export async function removeSharedCatalogVideoPlacement(id: string): Promise<ExampleActionResult> {
  const admin = await requireAdmin();
  if (!id) return { ok: false, error: "Missing shared placement." };
  const supabase = getServiceSupabase();
  const { data: placement, error: readError } = await supabase
    .from("catalog_item_example_placements")
    .select("id")
    .eq("organization_id", admin.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (readError || !placement) return { ok: false, error: "Shared placement not found." };

  const { data: removed, error } = await supabase.rpc(
    "remove_shared_catalog_stream_placement",
    { p_organization_id: admin.organizationId, p_placement_id: id },
  );
  if (error || removed !== true) return { ok: false, error: "Could not unlink the shared video." };
  revalidatePath("/admin/settings/pricing");
  revalidatePath("/book");
  return { ok: true };
}

export async function deleteCatalogExample(id: string): Promise<ExampleActionResult> {
  const admin = await requireAdmin();
  if (!id) return { ok: false, error: "Missing example." };
  const supabase = getServiceSupabase();

  const { data: example, error: readError } = await supabase
    .from("catalog_item_examples")
    .select("id, source_type, stream_uid")
    .eq("organization_id", admin.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (readError || !example) return { ok: false, error: "Example not found." };

  if (example.source_type === "cloudflare_stream" && example.stream_uid) {
    const { count: sharedUsageCount, error: usageError } = await supabase
      .from("catalog_item_example_placements")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", admin.organizationId)
      .eq("source_example_id", id);
    if (usageError) return { ok: false, error: "Could not inspect where this video is used." };
    if ((sharedUsageCount ?? 0) > 0) {
      return {
        ok: false,
        error: `This video is used in ${sharedUsageCount} other ${sharedUsageCount === 1 ? "service" : "services"}. Unlink those shared placements before deleting it everywhere.`,
      };
    }

    const { data: deletionUid, error: transitionError } = await supabase.rpc(
      "begin_catalog_stream_example_deletion",
      {
        p_example_id: id,
        p_organization_id: admin.organizationId,
      },
    );
    if (transitionError || deletionUid !== example.stream_uid) {
      return { ok: false, error: "Could not durably begin video removal." };
    }

    const deleted = await deleteStreamVideo(example.stream_uid);
    if (!deleted) {
      revalidatePath("/admin/settings/pricing");
      revalidatePath("/book");
      return { ok: false, error: "The video is hidden and queued for automatic Cloudflare cleanup." };
    }

    const { data: removedExample, error: exampleError } = await supabase
      .from("catalog_item_examples")
      .delete()
      .eq("organization_id", admin.organizationId)
      .eq("id", id)
      .eq("status", "deleting")
      .select("id")
      .maybeSingle();
    if (exampleError || !removedExample) {
      return { ok: false, error: "The video was deleted and remains hidden while cleanup finishes automatically." };
    }

    const { data: cleanedClaim, error: ledgerError } = await supabase
      .from("catalog_stream_upload_claims")
      .update({ state: "cleaned", updated_at: new Date().toISOString() })
      .eq("organization_id", admin.organizationId)
      .eq("stream_uid", example.stream_uid)
      .eq("state", "cleanup_required")
      .select("id")
      .maybeSingle();
    if (ledgerError || !cleanedClaim) {
      return { ok: false, error: "The video was removed; cleanup tracking will finish automatically." };
    }
  } else {
    const { error } = await supabase
      .from("catalog_item_examples")
      .delete()
      .eq("organization_id", admin.organizationId)
      .eq("id", id);
    if (error) return { ok: false, error: "Could not remove the example." };
  }

  revalidatePath("/admin/settings/pricing");
  revalidatePath("/book");
  return { ok: true };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
