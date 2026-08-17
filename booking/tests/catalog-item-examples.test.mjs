import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

const coreModule = await tsImport("../lib/booking/catalog-examples-core.ts", import.meta.url);
const core = coreModule.default;

test("external examples accept bounded HTTPS URLs and derive privacy-friendly video embeds", () => {
  assert.equal(core.parseExampleUrl("http://example.com/demo"), null);
  assert.equal(core.parseExampleUrl("javascript:alert(1)"), null);
  assert.equal(core.parseExampleUrl("https://localhost/example"), null);
  assert.equal(core.parseExampleUrl("https://127.0.0.1/example"), null);
  assert.equal(core.toExampleEmbedUrl("https://example.com/portfolio"), null);
  assert.equal(core.toExampleEmbedUrl("https://youriguide.com.evil.test/tour"), null);
  assert.equal(core.parseExampleUrl(`https://example.com/${"a".repeat(2050)}`), null);

  assert.equal(
    core.toExampleEmbedUrl("https://youtu.be/dQw4w9WgXcQ?t=3"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  assert.equal(
    core.toExampleEmbedUrl("https://vimeo.com/123456789"),
    "https://player.vimeo.com/video/123456789",
  );
  assert.equal(
    core.toExampleEmbedUrl("https://youriguide.com/abc123"),
    "https://youriguide.com/abc123",
  );
});

test("catalog items expose at most eight deterministic example positions", () => {
  assert.equal(core.nextExampleDisplayOrder([]), 0);
  assert.equal(core.nextExampleDisplayOrder([{ display_order: 0 }, { display_order: 2 }]), 1);
  assert.equal(
    core.nextExampleDisplayOrder(Array.from({ length: 8 }, (_, display_order) => ({ display_order }))),
    null,
  );
});

test("Cloudflare Stream direct upload fails closed and returns only a bounded upload capability", async () => {
  assert.equal(core.isStreamConfigured({}), false);
  assert.throws(
    () => core.loadStreamConfig({ CLOUDFLARE_STREAM_ACCOUNT_ID: "bad", CLOUDFLARE_STREAM_API_TOKEN: "x" }),
    /account/i,
  );

  const calls = [];
  const result = await core.createStreamDirectUpload({
    env: {
      CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
      NEXT_PUBLIC_APP_URL: "https://book.pixelblastermedia.com",
    },
    name: "Full video example",
    operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        success: true,
        result: {
          uid: "1234567890abcdef1234567890abcdef",
          uploadURL: "https://upload.videodelivery.net/capability-token",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.deepEqual(result, {
    uid: "1234567890abcdef1234567890abcdef",
    uploadUrl: "https://upload.videodelivery.net/capability-token",
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/stream/direct_upload",
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token");
  const requestBody = JSON.parse(calls[0].init.body);
  assert.equal(requestBody.maxDurationSeconds, 600);
  assert.deepEqual(requestBody.allowedOrigins, ["book.pixelblastermedia.com"]);
  assert.equal(requestBody.meta.name, "Full video example");
  assert.equal(requestBody.creator, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(requestBody.meta.catalogUploadClaimId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(await core.deleteStreamVideo("d".repeat(32), {}), false);
  assert.equal(
    await core.deleteStreamVideo(
      "d".repeat(32),
      {
        CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
      },
      async () => new Response(null, { status: 200 }),
    ),
    true,
  );
  assert.equal(
    await core.deleteStreamVideo(
      "d".repeat(32),
      {
        CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
      },
      async () => new Response(null, { status: 404 }),
    ),
    true,
  );
  const inventory = await core.findStreamVideosByClaimIds(
    ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    {
      CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
    },
    async (requestUrl) => {
      const inventoryUrl = new URL(requestUrl);
      assert.equal(inventoryUrl.searchParams.get("limit"), "2");
      assert.equal(inventoryUrl.searchParams.get("creator"), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      return new Response(JSON.stringify({
      success: true,
      result: [{
        uid: "1234567890abcdef1234567890abcdef",
        creator: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        meta: { catalogUploadClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      }],
      result_info: { count: 1, page: 1, per_page: 2, total_count: 1, total_pages: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  );
  assert.equal(inventory.found.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "1234567890abcdef1234567890abcdef");
  const currentInventory = await core.findStreamVideosByClaimIds(
    ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
    {
      CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
    },
    async () => new Response(JSON.stringify({
      success: true,
      result: { videos: [], range: 0, total: 0 },
      errors: [],
      messages: [],
    }), { status: 200 }),
  );
  assert.equal(currentInventory.absent.has("ffffffff-ffff-4fff-8fff-ffffffffffff"), true);
  await assert.rejects(
    core.findStreamVideosByClaimIds(
      ["abababab-abab-4bab-8bab-abababababab"],
      {
        CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
      },
      async () => new Response(JSON.stringify({
        success: true,
        result: { videos: [] },
        result_info: { count: 0, page: 1, per_page: 2, total_count: 0, total_pages: 0 },
      }), { status: 200 }),
    ),
    /inventory was invalid/i,
  );
  await assert.rejects(
    core.createStreamDirectUpload({
      env: {
        CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
        NEXT_PUBLIC_APP_URL: "https://book.pixelblastermedia.com",
      },
      name: "Rejected",
      operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      fetchImpl: async () => new Response(JSON.stringify({ success: false }), { status: 403 }),
    }),
    (error) => error instanceof core.StreamProvisioningError && error.outcome === "definitive",
  );
  await assert.rejects(
    core.createStreamDirectUpload({
      env: {
        CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
        NEXT_PUBLIC_APP_URL: "https://book.pixelblastermedia.com",
      },
      name: "Ambiguous",
      operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      fetchImpl: async () => { throw new Error("network"); },
    }),
    (error) => error instanceof core.StreamProvisioningError && error.outcome === "ambiguous",
  );
  await assert.rejects(
    core.createStreamDirectUpload({
      env: {
        CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
        NEXT_PUBLIC_APP_URL: "https://book.pixelblastermedia.com",
      },
      name: "Provider 500",
      operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      fetchImpl: async () => new Response(JSON.stringify({ success: false }), { status: 500 }),
    }),
    (error) => error instanceof core.StreamProvisioningError && error.outcome === "ambiguous",
  );
  await assert.rejects(
    core.findStreamVideosByClaimIds(
      ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
      {
        CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
      },
      async () => new Response(JSON.stringify({ success: true, result: [] }), { status: 200 }),
    ),
    /inventory was invalid/i,
  );
});

test("Cloudflare Stream details preserve validated native video dimensions", async () => {
  const details = await core.getStreamVideoDetails(
    "1234567890abcdef1234567890abcdef",
    {
      CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
      NEXT_PUBLIC_APP_URL: "https://pixelblastermedia.com",
    },
    async () => new Response(JSON.stringify({
      success: true,
      result: {
        readyToStream: true,
        status: { state: "ready" },
        input: { width: 1080, height: 1920 },
      },
    }), { status: 200 }),
  );
  assert.deepEqual(details, { state: "ready", width: 1080, height: 1920 });

  await assert.rejects(
    core.getStreamVideoDetails(
      "1234567890abcdef1234567890abcdef",
      {
        CLOUDFLARE_STREAM_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        CLOUDFLARE_STREAM_API_TOKEN: "secret-token",
        NEXT_PUBLIC_APP_URL: "https://pixelblastermedia.com",
      },
      async () => new Response(JSON.stringify({
        success: true,
        result: { readyToStream: true, input: { width: 0, height: 1920 } },
      }), { status: 200 }),
    ),
    /dimensions/i,
  );
});

test("catalog examples cross schema, admin, public booking, and SaaS cloning boundaries", async () => {
  const [migration, portraitMigration, dto, page, picker, editor, actions, uploadRoute, completeRoute, cleanupRoute, cleanupWorker, sharedCron, companySetup, types] =
    await Promise.all([
      readFile(new URL("../supabase/migrations/20260816120000_catalog_item_examples.sql", import.meta.url), "utf8"),
      readFile(new URL("../supabase/migrations/20260817173000_catalog_video_dimensions.sql", import.meta.url), "utf8"),
      readFile(new URL("../lib/booking/catalog-dto.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/book/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/book/_components/PackageAccordion.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/admin/settings/pricing/CatalogExamplesEditor.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/admin/settings/pricing/example-actions.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/admin/catalog-examples/upload/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/admin/catalog-examples/[id]/complete/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/cron/catalog-stream-cleanup/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/booking/catalog-stream-cleanup.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/cron/integration-outbox/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/platform/company-setup.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    ]);

  assert.match(migration, /create table public\.catalog_item_examples/i);
  assert.match(migration, /organization_id uuid not null/i);
  assert.doesNotMatch(migration, /on delete cascade/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /https:\/\//i);
  assert.match(migration, /catalog_item_examples_catalog_tenant_fk[\s\S]*on delete restrict/i);
  assert.match(migration, /display_order between 0 and 7/i);
  assert.match(migration, /unique \(organization_id, catalog_item_id, display_order\)/i);
  assert.match(migration, /create table public\.catalog_stream_upload_claims/i);
  assert.match(migration, /foreign key \(catalog_item_id, organization_id\)[\s\S]*references public\.catalog_items\(id, organization_id\)/i);
  assert.match(migration, /foreign key \(example_id, organization_id\)[\s\S]*references public\.catalog_item_examples\(id, organization_id\)/i);
  assert.match(migration, /claim_catalog_stream_upload/i);
  assert.match(migration, /attach_catalog_stream_upload/i);
  assert.match(types, /catalog_item_examples: CatalogItemExamplesTable/);
  assert.match(portraitMigration, /video_width integer/);
  assert.match(portraitMigration, /video_height integer/);
  assert.match(portraitMigration, /record_catalog_stream_example_dimensions/);
  assert.match(portraitMigration, /finalize_catalog_stream_upload_with_dimensions/);
  assert.match(portraitMigration, /video_width is not null[\s\S]*video_height is not null/i);
  assert.match(dto, /orientation: "portrait" \| "landscape"/);
  assert.match(dto, /examples: CatalogItemExampleDTO\[\]/);
  assert.match(page, /getActiveCatalogExamples/);
  assert.match(picker, /MediaBadges/);
  assert.match(picker, /role="dialog"/);
  assert.match(picker, /className="fixed inset-0 !m-0 h-dvh max-h-none[^\"]*items-center[^\"]*p-4/);
  assert.doesNotMatch(picker, /className="fixed inset-0 !m-0 h-dvh max-h-none[^\"]*items-end/);
  assert.match(picker, /max-h-\[92dvh\] w-full max-w-3xl[^\"]*overscroll-contain[^\"]*rounded-\[1\.75rem\]/);
  assert.match(picker, /example\.orientation === "portrait"/);
  assert.match(picker, /aspect-\[9\/16\]/);
  assert.match(picker, /event\.stopPropagation\(\)/);
  assert.match(picker, /previousFocusRef/);
  assert.match(picker, /event\.key === "Tab"/);
  assert.match(picker, /dialogRef\.current\?\.focus/);
  assert.match(picker, /trustedExampleEmbed/);
  assert.match(editor, /Upload video/);
  assert.match(editor, /Use existing video/);
  assert.match(editor, /Recover video details/);
  assert.match(editor, /Attach URL/);
  assert.match(editor, /YouTube, Vimeo, and iGUIDE open in the player/i);
  assert.match(editor, /Check processing/);
  assert.match(actions, /requireAdmin/);
  assert.match(actions, /eq\("organization_id", admin\.organizationId\)/);
  assert.match(uploadRoute, /createStreamDirectUpload/);
  assert.match(uploadRoute, /claim_catalog_stream_upload/);
  assert.match(uploadRoute, /cleanup_required/);
  assert.match(uploadRoute, /attach_catalog_stream_upload/);
  assert.match(uploadRoute, /if \(attachError \|\| !exampleId[\s\S]*setClaimCleanup[\s\S]*Could not attach the prepared upload safely/);
  assert.match(completeRoute, /finalize_catalog_stream_upload/);
  assert.match(completeRoute, /getStreamVideoDetails/);
  assert.match(completeRoute, /record_catalog_stream_example_dimensions/);
  assert.match(completeRoute, /finalize_catalog_stream_upload_with_dimensions/);
  assert.match(types, /video_width: number \| null/);
  assert.match(types, /video_height: number \| null/);
  assert.match(actions, /begin_catalog_stream_example_deletion/);
  assert.match(uploadRoute, /requireAdmin/);
  assert.match(cleanupRoute, /runCatalogStreamCleanup/);
  assert.match(cleanupRoute, /CRON_SECRET/);
  assert.match(cleanupWorker, /findStreamVideosByClaimIds/);
  assert.match(cleanupWorker, /inventory\.absent\.has\(claim\.id\)[\s\S]*state: "cleaned"/);
  assert.match(cleanupWorker, /ascending: true/);
  assert.match(cleanupWorker, /\.eq\("state", "provisioned"\)/);
  assert.match(cleanupWorker, /interrupted Stream attachments/);
  assert.match(sharedCron, /runCatalogStreamCleanup/);
  assert.match(companySetup, /catalog_item_examples/);
});

test("catalog video processing checks use an HTTP method implemented by the completion route", async () => {
  const [editor, completeRoute] = await Promise.all([
    readFile(new URL("../app/admin/settings/pricing/CatalogExamplesEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/catalog-examples/[id]/complete/route.ts", import.meta.url), "utf8"),
  ]);
  const completionFetch = editor.match(
    /fetch\(`\/api\/admin\/catalog-examples\/\$\{encodeURIComponent\(exampleId\)\}\/complete`,\s*\{[\s\S]*?method:\s*"([A-Z]+)"/,
  );
  assert.ok(completionFetch, "the editor must declare the completion request method");
  const implementedMethods = [...completeRoute.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)]
    .map((match) => match[1]);
  assert.ok(
    implementedMethods.includes(completionFetch[1]),
    `editor uses ${completionFetch[1]} but route implements ${implementedMethods.join(", ")}`,
  );
  assert.match(
    completeRoute,
    /NextResponse\.json\(\{\s*ok:\s*true,\s*status:\s*"ready"\s*\}/,
    "the completion route must return the success flag required by the editor",
  );
});

test("catalog samples live in grouped capability pills instead of a duplicate example action", async () => {
  const [picker, sampleGroups, dto, databaseTypes, editor, actions, migration, companySetup, dedicatedRunner, fullRunner, behavior] = await Promise.all([
    readFile(new URL("../app/book/_components/PackageAccordion.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/booking/catalog-sample-groups.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/booking/catalog-dto.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/settings/pricing/CatalogExamplesEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/settings/pricing/example-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817190000_grouped_catalog_sample_pills.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/platform/company-setup.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/verify-catalog-item-examples-postgres.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/verify-atomic-booking-postgres.sh", import.meta.url), "utf8"),
    readFile(new URL("./postgres/grouped-catalog-sample-pills.behavior.sql", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(picker, /function ViewExampleButton/);
  assert.doesNotMatch(picker, />View examples?</);
  assert.match(picker, /getCatalogSampleGroups/);
  assert.match(picker, /View \$\{group\.examples\.length\} \$\{group\.label\}/);
  assert.match(sampleGroups, /item\.is_photo/);
  assert.match(sampleGroups, /item\.is_video/);
  assert.match(sampleGroups, /item\.is_iguide/);
  assert.match(sampleGroups, /item\.is_aerial/);
  assert.match(dto, /sample_group_key: string \| null/);
  assert.match(dto, /sample_group_label: string \| null/);
  assert.match(databaseTypes, /p_sample_group_key\?: string/);
  assert.match(databaseTypes, /p_sample_group_label\?: string/);
  assert.match(editor, /Show sample under/);
  assert.match(editor, /Custom pill/);
  assert.match(actions, /normalizeCatalogSampleGroupInput/);
  assert.match(actions, /p_sample_group_key/);
  assert.match(actions, /p_sample_group_label/);
  assert.match(migration, /add column sample_group_key text/);
  assert.match(migration, /add column sample_group_label text/);
  assert.match(migration, /catalog_item_examples_sample_group_pair/);
  assert.match(migration, /attach_external_catalog_example[\s\S]*p_sample_group_key text[\s\S]*p_sample_group_label text/i);
  assert.match(companySetup, /sample_group_key: example\.sample_group_key/);
  assert.match(companySetup, /sample_group_label: example\.sample_group_label/);
  assert.match(dedicatedRunner, /20260817190000_grouped_catalog_sample_pills\.sql/);
  assert.match(fullRunner, /20260817190000_grouped_catalog_sample_pills\.sql/);
  assert.match(behavior, /partial-null/i);
  assert.match(behavior, /custom_site_plan/);
  assert.match(behavior, /authenticated role can attach grouped examples/i);
});

test("Pixel catalog copy offers both Reel styles at the same product level", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260817190000_grouped_catalog_sample_pills.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /Choose a smooth One-Take walkthrough or an Edited Reel made from short clips cut to music/);
  assert.match(migration, /Your choice of a One-Take Reel or Edited Reel, complemented by drone footage/);
  assert.match(migration, /organization_id = '00000000-0000-0000-0000-000000000001'/);
  assert.match(migration, /slug = 'social_media_reel'/);
  assert.match(migration, /slug = 'social_media_special'/);
});

test("capability pills share one compact visual box while playable pills retain a coarse-pointer target", async () => {
  const picker = await readFile(
    new URL("../app/book/_components/PackageAccordion.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    picker,
    /const capabilityPillClass\s*=\s*[\s\S]*?h-7[\s\S]*?leading-none/,
    "all visible capability pills should use one fixed-height visual class",
  );
  assert.match(
    picker,
    /className="tap-target group inline-flex items-center/,
    "the playable wrapper should retain the coarse-pointer hit target",
  );
  assert.match(
    picker,
    /className="flex flex-wrap items-center gap-x-1\.5 gap-y-1"/,
    "wrapped pill lines should center visual pills instead of stretching them",
  );
  assert.match(
    picker,
    /className=\{`\$\{capabilityPillClass\}[\s\S]*group-focus-visible:ring-2/,
    "hover and focus treatment should live on the same visual shell",
  );
  assert.doesNotMatch(
    picker,
    />\s*Selected\s*</,
    "the redundant Selected text pill should not crowd the capability row",
  );
});
