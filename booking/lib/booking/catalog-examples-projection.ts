import type { CatalogItemExampleDTO } from "./catalog-dto.ts";
import {
  parseExampleUrl,
  toExampleEmbedUrl,
  toStreamEmbedUrl,
} from "./catalog-examples-core.ts";

export interface PublicCatalogExampleSource {
  id: string;
  organization_id: string;
  catalog_item_id: string;
  title: string;
  description: string | null;
  kind: "video" | "interactive" | "link";
  source_type: "external_url" | "cloudflare_stream";
  external_url: string | null;
  stream_uid: string | null;
  status: "uploading" | "ready" | "failed" | "deleting";
  active: boolean;
  display_order: number;
}

export interface PublicCatalogExamplePlacement {
  id: string;
  organization_id: string;
  catalog_item_id: string;
  source_example_id: string;
  title: string;
  description: string | null;
  display_order: number;
  active: boolean;
}

export function projectActiveCatalogExamples(
  examples: PublicCatalogExampleSource[],
  placements: PublicCatalogExamplePlacement[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Map<string, CatalogItemExampleDTO[]> {
  const readySources = examples.filter((row) => row.active && row.status === "ready");
  const sources = new Map(readySources.map((row) => [row.id, row]));
  const grouped = new Map<string, Array<{ order: number; dto: CatalogItemExampleDTO }>>();

  for (const row of readySources) {
    const dto = toPublicDTO(row, env);
    if (dto) add(grouped, row.catalog_item_id, row.display_order, dto);
  }
  for (const placement of placements) {
    if (!placement.active) continue;
    const source = sources.get(placement.source_example_id);
    if (
      !source
      || source.organization_id !== placement.organization_id
      || source.source_type !== "cloudflare_stream"
      || source.kind !== "video"
    ) continue;
    const dto = toPublicDTO({
      ...source,
      id: placement.id,
      catalog_item_id: placement.catalog_item_id,
      title: placement.title,
      description: placement.description,
      display_order: placement.display_order,
    }, env);
    if (dto) add(grouped, placement.catalog_item_id, placement.display_order, dto);
  }

  return new Map(
    [...grouped].map(([catalogItemId, entries]) => [
      catalogItemId,
      entries.sort((a, b) => a.order - b.order).map(({ dto }) => dto),
    ]),
  );
}

function add(
  grouped: Map<string, Array<{ order: number; dto: CatalogItemExampleDTO }>>,
  catalogItemId: string,
  order: number,
  dto: CatalogItemExampleDTO,
) {
  const current = grouped.get(catalogItemId) ?? [];
  current.push({ order, dto });
  grouped.set(catalogItemId, current);
}

function toPublicDTO(
  row: PublicCatalogExampleSource,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): CatalogItemExampleDTO | null {
  const externalUrl = row.source_type === "external_url"
    ? parseExampleUrl(row.external_url ?? "")
    : null;
  const embedUrl = row.source_type === "cloudflare_stream"
    ? toStreamEmbedUrl(row.stream_uid ?? "", env)
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
