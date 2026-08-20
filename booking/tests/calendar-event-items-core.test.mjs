import assert from "node:assert/strict";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

let loadBookingCalendarSelectionItemsCore;
try {
  const importedCoreModule = await tsImport(
    "../lib/booking/calendar-event-items-core.ts",
    import.meta.url,
  );
  loadBookingCalendarSelectionItemsCore =
    importedCoreModule.default.loadBookingCalendarSelectionItemsCore;
} catch {
  // RED: the validated snapshot-loading core does not exist yet.
}

const args = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  bookingId: "22222222-2222-4222-8222-222222222222",
  services: ["blue_print"],
  addOns: ["aerial_add_on"],
};

function dependencies(overrides = {}) {
  return {
    verifyBooking: async () => true,
    loadSnapshots: async () => [
      {
        item_name: "Historical Blue Print",
        item_slug: "blue_print",
        item_kind: "bundle",
      },
      {
        item_name: "Historical Aerial",
        item_slug: "aerial_add_on",
        item_kind: "addon",
      },
    ],
    loadCatalog: async () => [],
    legacyLabel: (slug) => slug,
    legacyServiceKind: (slug) =>
      slug === "blue_print" ? "bundle" : "a_la_carte",
    ...overrides,
  };
}

test("complete snapshots remain authoritative and follow booking selection order", async () => {
  assert.equal(typeof loadBookingCalendarSelectionItemsCore, "function");
  const items = await loadBookingCalendarSelectionItemsCore(
    {
      ...args,
      services: ["video_tour", "blue_print"],
      addOns: ["site_plan", "aerial_add_on"],
    },
    dependencies({
      loadSnapshots: async () => [
        { item_name: "Aerial", item_slug: "aerial_add_on", item_kind: "addon" },
        { item_name: "Blue", item_slug: "blue_print", item_kind: "bundle" },
        { item_name: "Site Plan", item_slug: "site_plan", item_kind: "addon" },
        { item_name: "Video", item_slug: "video_tour", item_kind: "a_la_carte" },
      ],
    }),
  );

  assert.deepEqual(items, [
    { name: "Video", kind: "a_la_carte" },
    { name: "Blue", kind: "bundle" },
    { name: "Site Plan", kind: "addon" },
    { name: "Aerial", kind: "addon" },
  ]);
});

test("partial, stale, duplicate, and mixed snapshots reconcile to current membership", async () => {
  const cases = [
    {
      snapshots: [
        { item_name: "Historical Blue", item_slug: "blue_print", item_kind: "bundle" },
      ],
      expectedBlue: "Historical Blue",
    },
    {
      snapshots: [
        { item_name: "Historical Blue", item_slug: "blue_print", item_kind: "bundle" },
        { item_name: "Removed add-on", item_slug: "on_camera", item_kind: "addon" },
      ],
      expectedBlue: "Historical Blue",
    },
    {
      snapshots: [
        { item_name: "Blue old", item_slug: "blue_print", item_kind: "bundle" },
        { item_name: "Blue conflicting", item_slug: "blue_print", item_kind: "bundle" },
        { item_name: "Historical Aerial", item_slug: "aerial_add_on", item_kind: "addon" },
      ],
      expectedBlue: "Current Blue Print",
    },
    {
      snapshots: [
        { item_name: "Wrong-kind Blue", item_slug: "blue_print", item_kind: "addon" },
        { item_name: "Historical Aerial", item_slug: "aerial_add_on", item_kind: "addon" },
      ],
      expectedBlue: "Current Blue Print",
    },
  ];

  for (const { snapshots, expectedBlue } of cases) {
    const items = await loadBookingCalendarSelectionItemsCore(
      args,
      dependencies({
        loadSnapshots: async () => snapshots,
        loadCatalog: async () => [
          { slug: "blue_print", name: "Current Blue Print", kind: "bundle" },
          { slug: "aerial_add_on", name: "Current Aerial", kind: "addon" },
        ],
      }),
    );
    assert.deepEqual(items, [
      { name: expectedBlue, kind: "bundle" },
      {
        name: snapshots.some(
          (item) =>
            item.item_slug === "aerial_add_on" && item.item_kind === "addon",
        )
          ? "Historical Aerial"
          : "Current Aerial",
        kind: "addon",
      },
    ]);
  }
});

test("zero snapshots resolve every current selection from the tenant catalog", async () => {
  const items = await loadBookingCalendarSelectionItemsCore(
    args,
    dependencies({
      loadSnapshots: async () => [],
      loadCatalog: async () => [
        { slug: "blue_print", name: "Current Blue Print", kind: "bundle" },
        { slug: "aerial_add_on", name: "Current Aerial", kind: "addon" },
      ],
    }),
  );

  assert.deepEqual(items, [
    { name: "Current Blue Print", kind: "bundle" },
    { name: "Current Aerial", kind: "addon" },
  ]);
});

test("zero snapshots survive catalog failure with established legacy labels", async () => {
  const items = await loadBookingCalendarSelectionItemsCore(
    {
      ...args,
      services: ["iguide_tour", "floor_plan"],
      addOns: ["aerial_add_on"],
    },
    dependencies({
      loadSnapshots: async () => [],
      loadCatalog: async () => {
        throw new Error("catalog unavailable");
      },
      legacyLabel: (slug, kind) => {
        if (slug === "iguide_tour") return "iGuide Virtual Tour";
        if (slug === "floor_plan") return "Floor Plan Only";
        return kind === "addon" ? slug : slug;
      },
    }),
  );

  assert.deepEqual(items, [
    { name: "iGuide Virtual Tour", kind: "a_la_carte" },
    { name: "Floor Plan Only", kind: "a_la_carte" },
    { name: "Aerial Add On", kind: "addon" },
  ]);
});

test("tenant verification fails before snapshot or catalog reads", async () => {
  let reads = 0;
  await assert.rejects(
    loadBookingCalendarSelectionItemsCore(
      args,
      dependencies({
        verifyBooking: async () => false,
        loadSnapshots: async () => {
          reads += 1;
          return [];
        },
        loadCatalog: async () => {
          reads += 1;
          return [];
        },
      }),
    ),
    /verify/i,
  );
  assert.equal(reads, 0);
});
