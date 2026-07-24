import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { prioritizeActiveJobs } from "../app/admin/bookings/active-jobs.ts";
import {
  findCommonPackageLines,
  withoutCommonPackageLines,
} from "../app/book/_components/package-description.ts";

const packageSource = await readFile(
  new URL("../app/book/_components/PackageAccordion.tsx", import.meta.url),
  "utf8",
);
const recommenderSource = await readFile(
  new URL("../app/book/_components/AIPackageRecommender.tsx", import.meta.url),
  "utf8",
);
const propertySource = await readFile(
  new URL("../app/book/property/PropertyForm.tsx", import.meta.url),
  "utf8",
);
const addressSource = await readFile(
  new URL("../app/_components/AddressAutocomplete.tsx", import.meta.url),
  "utf8",
);
const confirmSource = await readFile(
  new URL("../app/book/confirm/page.tsx", import.meta.url),
  "utf8",
);
const bookingsSource = await readFile(
  new URL("../app/admin/bookings/page.tsx", import.meta.url),
  "utf8",
);
const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const bottomNavSource = await readFile(
  new URL("../app/admin/AdminBottomNav.tsx", import.meta.url),
  "utf8",
);

test("package comparison shows shared inclusions once and removes them from each card", () => {
  assert.match(packageSource, /Every package includes/);
  assert.match(packageSource, /commonPackageLines/);
  assert.match(packageSource, /uniquePackageLines/);
  assert.match(packageSource, /uniquePackageLines\[0\]/);
});

test("common package features are found after line eight and removed before display limits", () => {
  const shared = "Outside Sq Ft.";
  const descriptions = [
    ["Photos", "Tour", "Plans", shared, "A only"].join("\n"),
    ["Photos", "Tour", "Plans", "B only", shared].join("\n"),
    [
      "Photos",
      "Tour",
      "Plans",
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      shared,
      "C only",
    ].join("\n"),
  ];

  const common = findCommonPackageLines(descriptions);
  assert.deepEqual(common, ["Photos", "Tour", "Plans", shared]);
  for (const description of descriptions) {
    assert.equal(withoutCommonPackageLines(description, common).includes(shared), false);
  }
});

test("AI package helper is inline instead of covering package cards", () => {
  assert.match(recommenderSource, /Need help choosing\?/);
  assert.doesNotMatch(recommenderSource, /className="fixed/);
});

test("property form exposes persistent validation and focuses the first invalid field", () => {
  assert.match(propertySource, /role="alert"/);
  assert.match(propertySource, /Please fix the highlighted fields/);
  assert.match(propertySource, /firstInvalidField\.current\?\.focus\(\)/);
  assert.match(propertySource, /aria-invalid/);
});

test("optional shot requests are collapsed by default", () => {
  assert.match(propertySource, /<details[^>]*className="realtor-green-panel/);
  assert.match(propertySource, /Optional shot requests/);
});

test("selected autocomplete address reports success instead of no matches", () => {
  assert.match(addressSource, /Address selected\./);
  assert.match(addressSource, /selected:/);
});

test("confirmation presents the booking summary before optional recommendations", () => {
  const summary = confirmSource.indexOf("Booking summary");
  const upsell = confirmSource.indexOf("<ConfirmUpsellPanel");
  assert.ok(summary >= 0 && upsell > summary, "summary should appear before upsells");
});

test("active jobs include unscheduled requested work and call it out", () => {
  const active = prioritizeActiveJobs([
    { id: "scheduled", status: "confirmed", scheduled_at: "2026-07-18T14:00:00Z" },
    { id: "complete", status: "delivered", scheduled_at: "2026-07-10T14:00:00Z" },
    { id: "unscheduled", status: "requested", scheduled_at: null },
    { id: "editing", status: "editing", scheduled_at: "2026-06-01T14:00:00Z" },
  ]);
  assert.deepEqual(active.map((job) => job.id), [
    "unscheduled",
    "scheduled",
    "editing",
  ]);
  assert.match(bookingsSource, /Needs scheduling/);
  assert.match(bookingsSource, /title="Jobs Board"/);
  assert.match(bottomNavSource, /label: "Jobs"/);
});

test("mobile avatar menu contains secondary tools rather than duplicated primary tabs", () => {
  assert.match(layoutSource, /mobileNavigationForUser/);
  assert.match(layoutSource, /\/admin\/inbox/);
  assert.match(layoutSource, /\/admin\/iguide/);
  assert.match(layoutSource, /items=\{mobileNav\}/);
});
