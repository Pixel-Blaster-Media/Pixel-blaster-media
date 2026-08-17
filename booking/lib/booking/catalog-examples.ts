import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import {
  parseExampleUrl,
  toExampleEmbedUrl,
  toStreamEmbedUrl,
} from "./catalog-examples-core";
import type { CatalogItemExampleDTO } from "./catalog-dto";

export type CatalogItemExampleRow =
  Database["public"]["Tables"]["catalog_item_examples"]["Row"];

export async function getActiveCatalogExamples(
  organizationId: string,
): Promise<Map<string, CatalogItemExampleDTO[]>> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("catalog_item_examples")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .eq("status", "ready")
    .order("display_order", { ascending: true })
    .returns<CatalogItemExampleRow[]>();
  if (error) throw new Error(`Failed to load catalog examples: ${error.message}`);

  const grouped = new Map<string, CatalogItemExampleDTO[]>();
  for (const row of data ?? []) {
    const dto = toPublicDTO(row);
    if (!dto) continue;
    const current = grouped.get(row.catalog_item_id) ?? [];
    current.push(dto);
    grouped.set(row.catalog_item_id, current);
  }
  return grouped;
}

export async function getFullCatalogExamples(
  organizationId: string,
): Promise<Map<string, CatalogItemExampleRow[]>> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("catalog_item_examples")
    .select("*")
    .eq("organization_id", organizationId)
    .order("display_order", { ascending: true })
    .returns<CatalogItemExampleRow[]>();
  if (error) throw new Error(`Failed to load catalog examples: ${error.message}`);

  const grouped = new Map<string, CatalogItemExampleRow[]>();
  for (const row of data ?? []) {
    const current = grouped.get(row.catalog_item_id) ?? [];
    current.push(row);
    grouped.set(row.catalog_item_id, current);
  }
  return grouped;
}

function toPublicDTO(row: CatalogItemExampleRow): CatalogItemExampleDTO | null {
  const externalUrl = row.source_type === "external_url"
    ? parseExampleUrl(row.external_url ?? "")
    : null;
  const embedUrl = row.source_type === "cloudflare_stream"
    ? toStreamEmbedUrl(row.stream_uid ?? "")
    : externalUrl ? toExampleEmbedUrl(externalUrl) : null;
  if (row.source_type === "cloudflare_stream" && !embedUrl) return null;
  if (row.source_type === "external_url" && !externalUrl) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: row.kind,
    embed_url: embedUrl,
    external_url: externalUrl,
  };
}
