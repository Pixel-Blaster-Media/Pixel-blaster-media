"use server";

import { revalidatePath } from "next/cache";

import {
  deleteStreamVideo,
  nextExampleDisplayOrder,
  parseExampleUrl,
} from "@/lib/booking/catalog-examples-core";
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
  const externalUrl = parseExampleUrl(text(formData, "external_url"));

  if (!catalogItemId) return { ok: false, error: "Choose a service." };
  if (!title || title.length > 120) return { ok: false, error: "Example title must be 1–120 characters." };
  if (description.length > 500) return { ok: false, error: "Description must be 500 characters or fewer." };
  if (!KINDS.has(kind)) return { ok: false, error: "Choose a valid example type." };
  if (!externalUrl) return { ok: false, error: "Enter a valid HTTPS example URL." };

  const supabase = getServiceSupabase();
  const { data: item, error: itemError } = await supabase
    .from("catalog_items")
    .select("id")
    .eq("organization_id", admin.organizationId)
    .eq("id", catalogItemId)
    .maybeSingle();
  if (itemError || !item) return { ok: false, error: "That service is unavailable." };

  const { data: existing, error: existingError } = await supabase
    .from("catalog_item_examples")
    .select("display_order")
    .eq("organization_id", admin.organizationId)
    .eq("catalog_item_id", catalogItemId);
  if (existingError) return { ok: false, error: "Could not inspect existing examples." };
  const displayOrder = nextExampleDisplayOrder(existing ?? []);
  if (displayOrder === null) return { ok: false, error: "A service can have up to eight examples." };

  const { error } = await supabase.from("catalog_item_examples").insert({
    organization_id: admin.organizationId,
    catalog_item_id: catalogItemId,
    title,
    description: description || null,
    kind: kind as "video" | "interactive" | "link",
    source_type: "external_url",
    external_url: externalUrl,
    status: "ready",
    display_order: displayOrder,
  });
  if (error) return { ok: false, error: "Could not attach the example." };

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
