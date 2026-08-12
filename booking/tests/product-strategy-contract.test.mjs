import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const strategyPath = new URL("../docs/PRODUCT_STRATEGY.md", import.meta.url);

function strategy() {
  return readFileSync(strategyPath, "utf8");
}

test("product strategy defines the category, buyers, workflow, and north star", () => {
  const document = strategy();

  assert.match(document, /listing-readiness, media-production, approval, release, and publishing command centre/i);
  assert.match(document, /Solo photographers/);
  assert.match(document, /Brokerage-approved media vendors/);
  assert.match(document, /Book → coordinate → verify access\/readiness → capture → upload → edit/);
  assert.match(document, /Percentage of listing releases completed and verified without operator intervention/);
});

test("product strategy preserves production safety and rejects commodity positioning", () => {
  const document = strategy();

  assert.match(document, /actively used for Pixel Blaster business operations/i);
  assert.match(document, /No destructive migration, deletion, or irreversible cutover/i);
  assert.match(document, /additive migrations, compatibility reads, tenant-scoped feature flags, exact-data backfills, supervised pilots/i);
  assert.match(document, /Existing customer records and deliverables remain intact/i);
  assert.match(document, /provisional profiles are labelled honestly/i);
  assert.match(document, /legacy field or route may be retired only after all callers are inventoried, migrated, monitored at zero supported use/i);
  assert.match(document, /Provider URLs are transport, never truth/);
  assert.match(document, /Sent is not live/);
  assert.match(document, /Do not lead with/i);
  assert.match(document, /universal MLS compliance/i);
});
