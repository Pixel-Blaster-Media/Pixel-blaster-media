import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { projectActiveCatalogExamples } from "./catalog-examples-projection";
import type { CatalogItemExampleDTO } from "./catalog-dto";

export type CatalogItemExampleRow =
  Database["public"]["Tables"]["catalog_item_examples"]["Row"];
type CatalogItemExamplePlacementRow =
  Database["public"]["Tables"]["catalog_item_example_placements"]["Row"];

export interface CatalogItemExampleAdminRow extends CatalogItemExampleRow {
  is_shared: boolean;
  placement_id: string | null;
  source_example_id: string;
}

export interface ReusableCatalogVideo {
  id: string;
  catalog_item_id: string;
  title: string;
  description: string | null;
}

export async function getActiveCatalogExamples(
  organizationId: string,
): Promise<Map<string, CatalogItemExampleDTO[]>> {
  const supabase = getServiceSupabase();
  const [{ data: examples, error: examplesError }, { data: placements, error: placementsError }] =
    await Promise.all([
      supabase
        .from("catalog_item_examples")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("active", true)
        .eq("status", "ready")
        .order("display_order", { ascending: true })
        .returns<CatalogItemExampleRow[]>(),
      supabase
        .from("catalog_item_example_placements")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("active", true)
        .order("display_order", { ascending: true })
        .returns<CatalogItemExamplePlacementRow[]>(),
    ]);
  if (examplesError) throw new Error(`Failed to load catalog examples: ${examplesError.message}`);
  if (placementsError) throw new Error(`Failed to load shared catalog videos: ${placementsError.message}`);

  return projectActiveCatalogExamples(examples ?? [], placements ?? []);
}

export async function getFullCatalogExamples(
  organizationId: string,
): Promise<Map<string, CatalogItemExampleAdminRow[]>> {
  const supabase = getServiceSupabase();
  const [{ data: examples, error: examplesError }, { data: placements, error: placementsError }] =
    await Promise.all([
      supabase
        .from("catalog_item_examples")
        .select("*")
        .eq("organization_id", organizationId)
        .order("display_order", { ascending: true })
        .returns<CatalogItemExampleRow[]>(),
      supabase
        .from("catalog_item_example_placements")
        .select("*")
        .eq("organization_id", organizationId)
        .order("display_order", { ascending: true })
        .returns<CatalogItemExamplePlacementRow[]>(),
    ]);
  if (examplesError) throw new Error(`Failed to load catalog examples: ${examplesError.message}`);
  if (placementsError) throw new Error(`Failed to load shared catalog videos: ${placementsError.message}`);

  const sources = new Map((examples ?? []).map((row) => [row.id, row]));
  const grouped = new Map<string, CatalogItemExampleAdminRow[]>();
  for (const row of examples ?? []) {
    addAdmin(grouped, row.catalog_item_id, {
      ...row,
      is_shared: false,
      placement_id: null,
      source_example_id: row.id,
    });
  }
  for (const placement of placements ?? []) {
    const source = sources.get(placement.source_example_id);
    if (!source) continue;
    addAdmin(grouped, placement.catalog_item_id, {
      ...source,
      id: placement.id,
      catalog_item_id: placement.catalog_item_id,
      title: placement.title,
      description: placement.description,
      active: placement.active && source.active,
      display_order: placement.display_order,
      created_at: placement.created_at,
      updated_at: placement.updated_at,
      is_shared: true,
      placement_id: placement.id,
      source_example_id: source.id,
    });
  }
  for (const rows of grouped.values()) rows.sort((a, b) => a.display_order - b.display_order);
  return grouped;
}

export async function getReusableCatalogVideos(
  organizationId: string,
): Promise<ReusableCatalogVideo[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("catalog_item_examples")
    .select("id, catalog_item_id, title, description")
    .eq("organization_id", organizationId)
    .eq("source_type", "cloudflare_stream")
    .eq("status", "ready")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .returns<ReusableCatalogVideo[]>();
  if (error) throw new Error(`Failed to load reusable catalog videos: ${error.message}`);
  return data ?? [];
}

function addAdmin(
  grouped: Map<string, CatalogItemExampleAdminRow[]>,
  catalogItemId: string,
  row: CatalogItemExampleAdminRow,
) {
  const current = grouped.get(catalogItemId) ?? [];
  current.push(row);
  grouped.set(catalogItemId, current);
}
