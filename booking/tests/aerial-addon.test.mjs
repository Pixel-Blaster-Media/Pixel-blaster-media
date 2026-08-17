import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

const root = process.cwd();
const rulesModule = await tsImport(
  "../lib/booking/catalog-rules.ts",
  import.meta.url,
);
const {
  addonEligibilityError,
  catalogAddonEligibilityMessage,
  isAddonEligible,
} = rulesModule.default;

function item(overrides = {}) {
  return {
    kind: "a_la_carte",
    is_photo: false,
    is_video: false,
    is_iguide: false,
    is_aerial: false,
    require_has_video: false,
    require_has_media: false,
    require_has_iguide: false,
    exclude_has_aerial: false,
    ...overrides,
  };
}

const aerialAddon = item({
  kind: "addon",
  is_aerial: true,
  require_has_media: true,
  exclude_has_aerial: true,
});

test("aerial add-on qualifies with photos, iGUIDE, or video", () => {
  for (const capability of ["is_photo", "is_iguide", "is_video"]) {
    assert.equal(
      isAddonEligible(aerialAddon, [item({ [capability]: true })]),
      true,
      `${capability} should qualify`,
    );
  }
});

test("aerial add-on is hidden without media or when aerial is included", () => {
  assert.equal(addonEligibilityError(aerialAddon, [item()]), "requires_media");
  assert.equal(
    addonEligibilityError(aerialAddon, [
      item({ is_photo: true, is_aerial: true }),
    ]),
    "already_has_aerial",
  );
});

test("site plan is eligible only when iGUIDE is selected", () => {
  const sitePlan = item({ kind: "addon", require_has_iguide: true });

  assert.equal(addonEligibilityError(sitePlan, [item({ is_photo: true })]), "requires_iguide");
  assert.equal(addonEligibilityError(sitePlan, [item({ is_video: true })]), "requires_iguide");
  assert.equal(addonEligibilityError(sitePlan, [item({ is_iguide: true })]), null);
  assert.equal(isAddonEligible(sitePlan, [item({ is_iguide: true })]), true);
});

test("cart validation explains that Site Plan requires iGUIDE", () => {
  const photos = item({ is_photo: true });
  const sitePlan = {
    name: "Site Plan",
    ...item({ kind: "addon", require_has_iguide: true }),
  };

  assert.equal(typeof catalogAddonEligibilityMessage, "function");
  assert.equal(
    catalogAddonEligibilityMessage(sitePlan, [photos]),
    '"Site Plan" requires an iGUIDE package or à la carte item.',
  );
});

test("catalog migration seeds and protects the $100 aerial add-on", async () => {
  const migrations = await fs.readdir(path.join(root, "supabase/migrations"));
  const name = migrations.find((file) =>
    file.endsWith("_aerial_addon_catalog_rules.sql"),
  );
  assert.ok(name, "Missing aerial add-on migration");
  const sql = await fs.readFile(
    path.join(root, "supabase/migrations", name),
    "utf8",
  );
  assert.match(sql, /'aerial_add_on'[\s\S]*?'Aerial Add-on'/);
  assert.match(sql, /10000/);
  assert.match(sql, /require_has_media[\s\S]*exclude_has_aerial/);
  assert.match(sql, /create function public\.create_public_booking_with_jobs\(/);
  assert.match(sql, /Selected add-on is not eligible for these services/);
});

test("public picker uses the shared add-on eligibility rule", async () => {
  const source = await fs.readFile(
    path.join(root, "app/book/_components/PackageAccordion.tsx"),
    "utf8",
  );
  assert.match(source, /isAddonEligible\(addon, selectedServices\)/);
  assert.match(source, /isAddonEligible\(a, nextSelectedServices\)/);
});
