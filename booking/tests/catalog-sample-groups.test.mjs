import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const sampleGroupModule = (await tsImport(
  "../lib/booking/catalog-sample-groups.ts",
  import.meta.url,
)).default;

const BASE_ITEM = {
  id: "item-1",
  slug: "social_media_special",
  name: "Social Media Special",
  description: "",
  duration_minutes: 120,
  price_cents: 60000,
  sqft_pricing_enabled: true,
  included_sqft: 2500,
  overage_increment_sqft: 500,
  overage_price_cents: 4000,
  kind: "bundle",
  is_photo: true,
  is_video: true,
  is_iguide: true,
  is_aerial: true,
  require_has_video: false,
  require_has_media: false,
  require_has_iguide: false,
  exclude_has_aerial: false,
  display_order: 0,
  badge: null,
  highlight: false,
  ideal_for: null,
};

function example(id, title, kind, sample_group_key = null, sample_group_label = null) {
  return {
    id,
    title,
    description: null,
    kind,
    embed_url: "https://example.com/embed",
    external_url: "https://example.com",
    orientation: "landscape",
    sample_group_key,
    sample_group_label,
  };
}

test("sample groups preserve standard capability pills and group their examples", async () => {
  const { getCatalogSampleGroups } = sampleGroupModule;
  const item = {
    ...BASE_ITEM,
    examples: [
      example("video-1", "One-Take Reel", "video"),
      example("video-2", "Edited Reel", "video", "video", "Video"),
      example("iguide-1", "iGUIDE Tour", "interactive", "iguide", "iGUIDE"),
    ],
  };

  const groups = getCatalogSampleGroups(item);
  assert.deepEqual(groups.map(({ key, label }) => [key, label]), [
    ["photos", "Photos"],
    ["video", "Video"],
    ["iguide", "iGUIDE"],
    ["aerial", "Drone"],
  ]);
  assert.deepEqual(groups.find((group) => group.key === "video")?.examples.map(({ title }) => title), [
    "One-Take Reel",
    "Edited Reel",
  ]);
  assert.equal(groups.find((group) => group.key === "photos")?.examples.length, 0);
});

test("custom sample groups create their own clickable pill without hard-coded service logic", async () => {
  const { getCatalogSampleGroups } = sampleGroupModule;
  const item = {
    ...BASE_ITEM,
    is_photo: false,
    is_video: false,
    is_iguide: false,
    is_aerial: false,
    examples: [
      example("site-plan-1", "Site Plan Sample", "link", "custom_site_plan", "Site Plan"),
      example("site-plan-2", "Second Site Plan", "link", "custom_site_plan", "Site Plan"),
    ],
  };

  const groups = getCatalogSampleGroups(item);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.key, "custom_site_plan");
  assert.equal(groups[0]?.label, "Site Plan");
  assert.equal(groups[0]?.examples.length, 2);
});

test("legacy and malformed group metadata fall back to safe media categories", async () => {
  const { resolveCatalogSampleGroup } = sampleGroupModule;
  assert.deepEqual(resolveCatalogSampleGroup(example("v", "Legacy video", "video")), {
    key: "video",
    label: "Video",
  });
  assert.deepEqual(resolveCatalogSampleGroup(example("i", "Legacy tour", "interactive")), {
    key: "iguide",
    label: "iGUIDE",
  });
  assert.deepEqual(
    resolveCatalogSampleGroup(example("x", "Unsafe", "link", "BAD KEY", "<script>")),
    { key: "custom", label: "Sample" },
  );
});

test("custom sample groups accept numeric and non-Latin labels with safe stable keys", () => {
  const { normalizeCatalogSampleGroupInput } = sampleGroupModule;

  assert.deepEqual(normalizeCatalogSampleGroupInput("custom", "360 Tour"), {
    key: "custom_360_tour",
    label: "360 Tour",
  });

  const japanese = normalizeCatalogSampleGroupInput("custom", "間取り");
  assert.equal(japanese?.label, "間取り");
  assert.match(japanese?.key ?? "", /^custom_u[0-9a-f]{8}$/);
  assert.deepEqual(
    normalizeCatalogSampleGroupInput("custom", "間取り"),
    japanese,
  );
});
