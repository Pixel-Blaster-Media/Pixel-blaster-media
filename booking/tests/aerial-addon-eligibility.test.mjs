import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  getSelectedServiceCapabilities,
  isCatalogAddonEligible,
} = await import("../lib/booking/catalog-eligibility.ts");

const capability = (overrides = {}) => ({
  is_photo: false,
  is_video: false,
  is_iguide: false,
  is_aerial: false,
  require_has_video: false,
  require_has_media: false,
  exclude_has_aerial: false,
  ...overrides,
});

test("aerial add-on eligibility matches the production database rule", () => {
  const aerialAddon = capability({
    require_has_media: true,
    exclude_has_aerial: true,
  });

  assert.equal(
    isCatalogAddonEligible(aerialAddon, getSelectedServiceCapabilities([])),
    false,
    "an add-on cannot be booked alone",
  );
  assert.equal(
    isCatalogAddonEligible(
      aerialAddon,
      getSelectedServiceCapabilities([capability({ is_photo: true })]),
    ),
    true,
  );
  assert.equal(
    isCatalogAddonEligible(
      aerialAddon,
      getSelectedServiceCapabilities([capability({ is_iguide: true })]),
    ),
    true,
  );
  assert.equal(
    isCatalogAddonEligible(
      aerialAddon,
      getSelectedServiceCapabilities([
        capability({ is_photo: true, is_aerial: true }),
      ]),
    ),
    false,
    "aerial cannot be added when coverage is already included",
  );
});

test("video-only add-ons continue to use the same fail-closed helper", () => {
  const videoAddon = capability({ require_has_video: true });
  assert.equal(
    isCatalogAddonEligible(
      videoAddon,
      getSelectedServiceCapabilities([capability({ is_photo: true })]),
    ),
    false,
  );
  assert.equal(
    isCatalogAddonEligible(
      videoAddon,
      getSelectedServiceCapabilities([capability({ is_video: true })]),
    ),
    true,
  );
});

test("catalog capability fields cross every booking and company-cloning boundary", async () => {
  const [
    dto,
    page,
    picker,
    action,
    recommender,
    confirm,
    confirmUpsell,
    catalog,
    adminCreate,
    adminEdit,
    companySetup,
    postgresRunner,
    postgresBehavior,
  ] = await Promise.all([
    readFile(new URL("../lib/booking/catalog-dto.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/book/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/book/_components/PackageAccordion.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/book/actions.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/book/recommendation-actions.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/book/confirm/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/book/confirm/ConfirmUpsellPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/booking/catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/calendar/actions.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/admin/bookings/[id]/actions.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/platform/company-setup.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/verify-atomic-booking-postgres.sh", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../tests/postgres/aerial-addon-catalog.behavior.sql", import.meta.url),
      "utf8",
    ),
  ]);

  for (const field of [
    "is_iguide",
    "is_aerial",
    "require_has_media",
    "exclude_has_aerial",
  ]) {
    for (const [boundary, source] of Object.entries({
      dto,
      page,
      action,
      confirm,
      confirmUpsell,
      companySetup,
    })) {
      assert.match(source, new RegExp(`\\b${field}\\b`), `${boundary} drops ${field}`);
    }
  }

  assert.match(picker, /isCatalogAddonEligible/);
  assert.match(action, /isCatalogAddonEligible/);
  assert.match(recommender, /isCatalogAddonEligible/);
  assert.match(confirm, /isCatalogAddonEligible/);
  assert.match(confirmUpsell, /isCatalogAddonEligible/);
  assert.match(page, /selection_notice[\s\S]*role="status"/);
  assert.match(page, /selectedSlugs\.length !== state\.services\.length/);
  assert.match(page, /selectedAddOnSlugs\.length !== state\.addOns\.length/);
  assert.match(confirm, /selection_notice[\s\S]*role="status"/);
  assert.match(recommender, /unavailable add-on was left out/);
  assert.match(
    recommender,
    /notes:\s*\[[\s\S]*unavailable add-on was left out[\s\S]*\.\.\.modelResult\.notes/,
  );
  assert.match(catalog, /new Set\(cart\.map/);
  assert.match(catalog, /items\.length !== cart\.length/);
  assert.doesNotMatch(adminCreate, /\.filter\(\(line\) => byId\.has/);
  assert.doesNotMatch(adminEdit, /\.filter\(\(line\) => byId\.has/);
  assert.match(companySetup, /is_iguide:\s*item\.is_iguide/);
  assert.match(companySetup, /is_aerial:\s*item\.is_aerial/);
  assert.match(companySetup, /require_has_media:\s*item\.require_has_media/);
  assert.match(companySetup, /exclude_has_aerial:\s*item\.exclude_has_aerial/);
  assert.match(postgresRunner, /20260810173824_aerial_addon_catalog_rules\.sql/);
  assert.match(postgresRunner, /aerial-addon-catalog\.behavior\.sql/);
  assert.match(postgresBehavior, /sqlstate 'PB002'/i);
  assert.match(postgresBehavior, /committed request did not replay/i);
  assert.match(postgresBehavior, /has_function_privilege/i);
});
