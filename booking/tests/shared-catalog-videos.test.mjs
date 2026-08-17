import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SOURCE = {
  id: "30000000-0000-0000-0000-000000000001",
  organization_id: "00000000-0000-0000-0000-000000000001",
  catalog_item_id: "10000000-0000-0000-0000-000000000001",
  title: "À-la-carte reel",
  description: "Original placement",
  kind: "video",
  source_type: "cloudflare_stream",
  external_url: null,
  stream_uid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  video_width: 1080,
  video_height: 1920,
  status: "ready",
  active: true,
  display_order: 0,
  created_at: "2026-08-17T00:00:00.000Z",
  updated_at: "2026-08-17T00:00:00.000Z",
};

const PLACEMENT = {
  id: "50000000-0000-0000-0000-000000000001",
  organization_id: SOURCE.organization_id,
  catalog_item_id: "10000000-0000-0000-0000-000000000002",
  source_example_id: SOURCE.id,
  title: "Social Media Special reel",
  description: "Bundle-specific explanation",
  display_order: 1,
  active: true,
  created_at: SOURCE.created_at,
  updated_at: SOURCE.updated_at,
};

test("one managed video projects into distinct public catalog placements", async () => {
  const { projectActiveCatalogExamples } = await import("../lib/booking/catalog-examples-projection.ts");
  const grouped = projectActiveCatalogExamples(
    [SOURCE],
    [PLACEMENT],
    { CLOUDFLARE_STREAM_CUSTOMER_CODE: "testcode" },
  );
  const original = grouped.get(SOURCE.catalog_item_id)?.[0];
  const shared = grouped.get(PLACEMENT.catalog_item_id)?.[0];

  assert.equal(original?.id, SOURCE.id);
  assert.equal(original?.title, SOURCE.title);
  assert.equal(shared?.id, PLACEMENT.id);
  assert.equal(shared?.title, PLACEMENT.title);
  assert.equal(shared?.description, PLACEMENT.description);
  assert.equal(shared?.embed_url, original?.embed_url);
  assert.equal(original?.orientation, "portrait");
  assert.equal(shared?.orientation, "portrait");

  const landscape = projectActiveCatalogExamples(
    [{ ...SOURCE, video_width: 1920, video_height: 1080 }],
    [],
    { CLOUDFLARE_STREAM_CUSTOMER_CODE: "testcode" },
  ).get(SOURCE.catalog_item_id)?.[0];
  assert.equal(landscape?.orientation, "landscape");

  const missingDimensions = projectActiveCatalogExamples(
    [{ ...SOURCE, video_width: null, video_height: null }],
    [PLACEMENT],
    { CLOUDFLARE_STREAM_CUSTOMER_CODE: "testcode" },
  );
  assert.equal(missingDimensions.has(SOURCE.catalog_item_id), false);
  assert.equal(missingDimensions.has(PLACEMENT.catalog_item_id), false);
});

async function optional(path) {
  try {
    return await readFile(new URL(path, import.meta.url), "utf8");
  } catch {
    return "";
  }
}

test("shared video placements are tenant-scoped, bounded, and provider-safe", async () => {
  const migration = await optional("../supabase/migrations/20260817143000_shared_catalog_video_placements.sql");

  assert.match(migration, /create table public\.catalog_item_example_placements/i);
  assert.match(migration, /foreign key \(catalog_item_id, organization_id\)[\s\S]*references public\.catalog_items\(id, organization_id\)[\s\S]*on delete restrict/i);
  assert.match(migration, /foreign key \(source_example_id, organization_id\)[\s\S]*references public\.catalog_item_examples\(id, organization_id\)[\s\S]*on delete restrict/i);
  assert.match(migration, /unique \(organization_id, catalog_item_id, source_example_id\)/i);
  assert.match(migration, /display_order between 0 and 7/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /attach_shared_catalog_stream_example/i);
  assert.match(migration, /remove_shared_catalog_stream_placement/i);
  assert.match(migration, /source_type[^;]*cloudflare_stream/is);
  assert.match(migration, /status[^;]*ready/is);
  assert.match(migration, /catalog_item_id\s*=\s*v_source_catalog_item_id/i);
  assert.match(migration, /catalog_item_example_placements[\s\S]*begin_catalog_stream_example_deletion/i);
  assert.match(migration, /revoke all on (?:table|function)[\s\S]*anon[\s\S]*authenticated/i);
  assert.match(migration, /grant execute on function public\.attach_shared_catalog_stream_example[\s\S]*to service_role/i);
});

test("shared video placements cross admin, public catalog, types, and setup boundaries", async () => {
  const [loader, actions, editor, page, priceRow, types, setup, companySetup, runner, dedicatedRunner, cleanupWorker, behavior] = await Promise.all([
    optional("../lib/booking/catalog-examples.ts"),
    optional("../app/admin/settings/pricing/example-actions.ts"),
    optional("../app/admin/settings/pricing/CatalogExamplesEditor.tsx"),
    optional("../app/admin/settings/pricing/page.tsx"),
    optional("../app/admin/settings/pricing/PriceRow.tsx"),
    optional("../lib/supabase/database.types.ts"),
    optional("../supabase/setup.sql"),
    optional("../lib/platform/company-setup.ts"),
    optional("../scripts/verify-atomic-booking-postgres.sh"),
    optional("../scripts/verify-catalog-item-examples-postgres.sh"),
    optional("../lib/booking/catalog-stream-cleanup.ts"),
    optional("./postgres/shared-catalog-videos.behavior.sql"),
  ]);

  assert.match(loader, /catalog_item_example_placements/);
  assert.match(loader, /source_example_id/);
  assert.match(loader, /getReusableCatalogVideos/);
  assert.match(actions, /attachSharedCatalogVideo/);
  assert.match(actions, /attach_shared_catalog_stream_example/);
  assert.match(actions, /removeSharedCatalogVideoPlacement/);
  assert.match(actions, /remove_shared_catalog_stream_placement/);
  assert.match(editor, /Use existing video/);
  assert.match(editor, /shared placement/i);
  assert.match(page, /getReusableCatalogVideos/);
  assert.match(priceRow, /reusableVideos/);
  assert.match(types, /catalog_item_example_placements:/);
  assert.match(setup, /create table public\.catalog_item_example_placements/i);
  assert.match(companySetup, /\.eq\("source_type", "external_url"\)/);
  assert.match(runner, /20260817143000_shared_catalog_video_placements\.sql/);
  assert.match(runner, /shared-catalog-videos\.behavior\.sql/);
  assert.match(dedicatedRunner, /20260817143000_shared_catalog_video_placements\.sql/);
  assert.match(dedicatedRunner, /shared-catalog-videos\.behavior\.sql/);
  assert.match(cleanupWorker, /catalog_item_example_placements[\s\S]*source_example_id[\s\S]*deleteStreamVideo/);
  assert.match(behavior, /cross-tenant/i);
  assert.match(behavior, /last placement|final placement|still shared/i);
  assert.match(behavior, /rollback/i);
});
