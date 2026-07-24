import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const headingSource = await readFile(
  new URL("../app/admin/AdminPageHeading.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const jobsSource = await readFile(
  new URL("../app/admin/bookings/page.tsx", import.meta.url),
  "utf8",
);
const todaySource = await readFile(
  new URL("../app/admin/today/page.tsx", import.meta.url),
  "utf8",
);
const realtorsSource = await readFile(
  new URL("../app/admin/realtors/page.tsx", import.meta.url),
  "utf8",
);
const settingsSource = await readFile(
  new URL("../app/admin/settings/page.tsx", import.meta.url),
  "utf8",
);

test("top-level admin pages share one compact flat heading system", () => {
  assert.match(headingSource, /data-admin-page-heading/);
  assert.match(headingSource, /items-baseline/);
  assert.match(headingSource, /text-2xl font-bold/);
  assert.match(headingSource, /mobileTitle\?: ReactNode/);
  assert.match(headingSource, /aria-label=\{titleLabel\}/);
  assert.match(headingSource, /flex w-full flex-wrap items-center gap-2 sm:w-auto/);
  assert.doesNotMatch(headingSource, /rounded-|shadow-|bg-realtor-surface/);
  assert.equal(headingSource.match(/<h1/g)?.length, 1);

  for (const source of [jobsSource, todaySource, realtorsSource, settingsSource]) {
    assert.match(source, /<AdminPageHeading/);
    assert.equal(source.match(/<h1/g)?.length ?? 0, 0);
  }
});

test("Jobs uses one Job Board identity without a redundant elevated title card", () => {
  assert.match(jobsSource, /eyebrow="Work queue"/);
  assert.match(jobsSource, /title="Jobs Board"/);
  assert.match(jobsSource, /active job.*shown/s);
  assert.match(jobsSource, /href="\/admin\/calendar"/);
  assert.match(jobsSource, /id="booking-search"/);
  assert.match(jobsSource, /FILTERS\.map/);
  assert.doesNotMatch(jobsSource, /<header className="rounded-2xl/);
  assert.doesNotMatch(jobsSource, />\s*Jobs\s*<\/h1>/);
});

test("Realtors keeps its count and search beside a compact page identity", () => {
  assert.match(realtorsSource, /eyebrow="Clients"/);
  assert.match(realtorsSource, /title="Realtors"/);
  assert.match(realtorsSource, /profile.*shown/s);
  assert.match(realtorsSource, /htmlFor="realtor-search"/);
  assert.match(realtorsSource, /id="realtor-search"/);
  assert.doesNotMatch(realtorsSource, /<header className="realtor-panel/);
});

test("Today leads with the date and shoot count instead of an overview title card", () => {
  assert.match(todaySource, /eyebrow="Today"/);
  assert.match(todaySource, /title=\{formatFullDate\(start\)\}/);
  assert.match(todaySource, /mobileTitle=\{formatCompactDate\(start\)\}/);
  assert.match(todaySource, /titleLabel=\{`Today, \$\{formatFullDate\(start\)\}`\}/);
  assert.match(todaySource, /meta=\{`\$\{\(bookings \?\? \[\]\)\.length\} shoot/);
  assert.match(todaySource, /<DailyAIBriefPanel actions=\{actionButtons\}/);
  assert.match(todaySource, /href="\/admin\/calendar"/);
  assert.doesNotMatch(todaySource, /Today at a glance/);
});

test("Settings uses the same compact heading and removes recurring helper copy", () => {
  assert.match(settingsSource, /eyebrow="Company controls"/);
  assert.match(settingsSource, /title="Settings"/);
  assert.doesNotMatch(settingsSource, /Set the essentials once/);
});
