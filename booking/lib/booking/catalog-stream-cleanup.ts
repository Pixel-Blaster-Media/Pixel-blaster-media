import {
  deleteStreamVideo,
  findStreamVideosByClaimIds,
} from "@/lib/booking/catalog-examples-core";
import { getServiceSupabase } from "@/lib/supabase/server";

export interface CatalogStreamCleanupResult {
  ok: boolean;
  reconciled: number;
  attempted: number;
  cleaned: number;
  retryable: number;
  providerUnknown: number;
}

export async function runCatalogStreamCleanup(): Promise<CatalogStreamCleanupResult> {
  const supabase = getServiceSupabase();
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const abandonedUploadBefore = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: unknownClaims, error: unknownError } = await supabase
    .from("catalog_stream_upload_claims")
    .select("id, organization_id")
    .in("state", ["provider_unknown", "claimed"])
    .lt("created_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(10);
  if (unknownError) throw new Error("Could not load Stream reconciliation work.");

  const reconciliationOutcomes = await Promise.all((unknownClaims ?? []).map(async (claim) => {
    let inventory: Awaited<ReturnType<typeof findStreamVideosByClaimIds>>;
    try {
      inventory = await findStreamVideosByClaimIds([claim.id]);
    } catch {
      await supabase
        .from("catalog_stream_upload_claims")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", claim.id)
        .eq("organization_id", claim.organization_id)
        .in("state", ["provider_unknown", "claimed"]);
      return false;
    }

    const uid = inventory.found.get(claim.id);
    const update = uid
      ? { stream_uid: uid, state: "cleanup_required" as const, updated_at: new Date().toISOString() }
      : inventory.absent.has(claim.id)
        ? { state: "cleaned" as const, updated_at: new Date().toISOString() }
        : null;
    if (!update) return false;
    const { error } = await supabase
      .from("catalog_stream_upload_claims")
      .update(update)
      .eq("id", claim.id)
      .eq("organization_id", claim.organization_id)
      .in("state", ["provider_unknown", "claimed"]);
    return !error;
  }));
  const reconciled = reconciliationOutcomes.filter(Boolean).length;

  const { error: provisionedError } = await supabase
    .from("catalog_stream_upload_claims")
    .update({ state: "cleanup_required", updated_at: new Date().toISOString() })
    .eq("state", "provisioned")
    .lt("updated_at", staleBefore);
  if (provisionedError) throw new Error("Could not reconcile interrupted Stream attachments.");

  const { error: attachedError } = await supabase
    .from("catalog_stream_upload_claims")
    .update({ state: "cleanup_required", updated_at: new Date().toISOString() })
    .eq("state", "attached")
    .lt("updated_at", abandonedUploadBefore);
  if (attachedError) throw new Error("Could not reconcile abandoned Stream uploads.");

  const { data: claims, error } = await supabase
    .from("catalog_stream_upload_claims")
    .select("id, organization_id, stream_uid, example_id")
    .eq("state", "cleanup_required")
    .not("stream_uid", "is", null)
    .order("updated_at", { ascending: true })
    .limit(3);
  if (error) throw new Error("Could not load Stream cleanup work.");

  const deferCleanup = async (id: string, organizationId: string) => {
    await supabase
      .from("catalog_stream_upload_claims")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", organizationId)
      .eq("state", "cleanup_required");
  };

  const outcomes = await Promise.all((claims ?? []).map(async (claim) => {
    if (claim.example_id) {
      const { data: hidden, error: hideError } = await supabase
        .from("catalog_item_examples")
        .update({ active: false, status: "deleting" })
        .eq("id", claim.example_id)
        .eq("organization_id", claim.organization_id)
        .in("status", ["uploading", "failed", "deleting"])
        .select("id")
        .maybeSingle();
      if (hideError || !hidden) {
        await deferCleanup(claim.id, claim.organization_id);
        return false;
      }
    }
    if (!claim.stream_uid || !(await deleteStreamVideo(claim.stream_uid))) {
      await deferCleanup(claim.id, claim.organization_id);
      return false;
    }
    if (claim.example_id) {
      const { error: deleteError } = await supabase
        .from("catalog_item_examples")
        .delete()
        .eq("id", claim.example_id)
        .eq("organization_id", claim.organization_id)
        .eq("status", "deleting");
      if (deleteError) {
        await deferCleanup(claim.id, claim.organization_id);
        return false;
      }
    }
    const { error: updateError } = await supabase
      .from("catalog_stream_upload_claims")
      .update({ state: "cleaned", updated_at: new Date().toISOString() })
      .eq("id", claim.id)
      .eq("organization_id", claim.organization_id)
      .eq("state", "cleanup_required");
    if (updateError) await deferCleanup(claim.id, claim.organization_id);
    return !updateError;
  }));
  const cleaned = outcomes.filter(Boolean).length;
  const retryable = outcomes.length - cleaned;

  const { count: providerUnknown, error: countError } = await supabase
    .from("catalog_stream_upload_claims")
    .select("id", { count: "exact", head: true })
    .in("state", ["provider_unknown", "claimed"])
    .lt("created_at", staleBefore);
  if (countError) throw new Error("Could not verify Stream reconciliation state.");

  return {
    ok: retryable === 0 && (providerUnknown ?? 0) === 0,
    reconciled,
    attempted: claims?.length ?? 0,
    cleaned,
    retryable,
    providerUnknown: providerUnknown ?? 0,
  };
}
