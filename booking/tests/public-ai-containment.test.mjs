import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

const featureModule = await tsImport(
  "../lib/booking/public-ai-recommendations.ts",
  import.meta.url,
);
const { publicAIRecommendationsEnabled } = featureModule.default;
const root = process.cwd();
const [actionSource, pageSource] = await Promise.all([
  readFile(path.join(root, "app/book/recommendation-actions.ts"), "utf8"),
  readFile(path.join(root, "app/book/page.tsx"), "utf8"),
]);

test("public AI recommendations fail closed unless explicitly enabled", () => {
  assert.equal(publicAIRecommendationsEnabled(undefined), false);
  assert.equal(publicAIRecommendationsEnabled(""), false);
  assert.equal(publicAIRecommendationsEnabled("true"), false);
  assert.equal(publicAIRecommendationsEnabled("1"), true);
});

test("the server action checks the feature gate before tenant or provider work", () => {
  const gateIndex = actionSource.indexOf("publicAIRecommendationsEnabled(");
  const tenantIndex = actionSource.indexOf("resolvePublicBookingOrganization(");
  const providerIndex = actionSource.indexOf("getCredential(");
  assert.ok(gateIndex >= 0);
  assert.ok(tenantIndex > gateIndex);
  assert.ok(providerIndex > gateIndex);
});

test("the public booking page hides the AI component while disabled", () => {
  assert.match(pageSource, /publicAIRecommendationsEnabled\(/);
  assert.match(
    pageSource,
    /publicAIRecommendationsEnabled\(\)[\s\S]*<AIPackageRecommender/,
  );
});
