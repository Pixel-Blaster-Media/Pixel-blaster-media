import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  groupDueIntegrationJobs,
  integrationOutboxDispatchEnabled,
  mapWithConcurrencyAndDeadline,
  parseDispatchWatermark,
} from "../lib/integrations/scheduler-core.ts";

const schedulerSource = readFileSync(
  new URL("../lib/integrations/scheduler.ts", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(
  new URL("../app/api/cron/integration-outbox/route.ts", import.meta.url),
  "utf8",
);
const jobsSource = readFileSync(
  new URL("../lib/integrations/jobs.ts", import.meta.url),
  "utf8",
);
const outboxDocsSource = readFileSync(
  new URL("../docs/INTEGRATION_OUTBOX.md", import.meta.url),
  "utf8",
);
const readmeSource = readFileSync(
  new URL("../README.md", import.meta.url),
  "utf8",
);
const vercelConfig = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
);

test("dispatch stays off unless explicitly set to true", () => {
  assert.equal(integrationOutboxDispatchEnabled(undefined), false);
  assert.equal(integrationOutboxDispatchEnabled("false"), false);
  assert.equal(integrationOutboxDispatchEnabled("1"), false);
  assert.equal(integrationOutboxDispatchEnabled("true"), true);
});

test("scheduler requires a canonical ISO invocation watermark", () => {
  assert.equal(
    parseDispatchWatermark("2026-07-19T16:00:00.000Z"),
    "2026-07-19T16:00:00.000Z",
  );
  for (const invalid of [undefined, "", "2026-07-19", "later", "2026-07-19T12:00:00-04:00"]) {
    assert.throws(() => parseDispatchWatermark(invalid), /ISO watermark/);
  }
});

test("scheduler groups only listed job types per booking in due order", () => {
  const grouped = groupDueIntegrationJobs([
    {
      organizationId: "org-a",
      bookingId: "booking-a",
      jobType: "quickbooks.invoice.create",
    },
    {
      organizationId: "org-b",
      bookingId: "booking-b",
      jobType: "email.admin.new_booking",
    },
    {
      organizationId: "org-a",
      bookingId: "booking-a",
      jobType: "email.booking.confirmation",
    },
  ]);

  assert.deepEqual(grouped, [
    {
      organizationId: "org-a",
      bookingId: "booking-a",
      jobTypes: [
        "quickbooks.invoice.create",
        "email.booking.confirmation",
      ],
    },
    {
      organizationId: "org-b",
      bookingId: "booking-b",
      jobTypes: ["email.admin.new_booking"],
    },
  ]);
  assert.equal(
    grouped[0].jobTypes.includes("google_calendar.event.create"),
    false,
  );
});

test("scheduler work is bounded to concurrency two and stops at the deadline", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrencyAndDeadline(
    [1, 2, 3, 4, 5],
    2,
    Date.now() + 1_000,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    },
  );
  assert.equal(peak, 2);
  assert.deepEqual(result.values, [2, 4, 6, 8, 10]);
  assert.equal(result.deadlineReached, false);

  const expired = await mapWithConcurrencyAndDeadline(
    [1, 2, 3],
    2,
    Date.now() - 1,
    async (value) => value,
  );
  assert.deepEqual(expired.values, []);
  assert.equal(expired.deadlineReached, true);
});

test("scheduler lists five identities, dispatches with concurrency two, and returns aggregates only", () => {
  assert.match(jobsSource, /export async function listDueIntegrationJobs/);
  assert.match(jobsSource, /\.rpc\("list_due_integration_jobs"/);
  assert.match(schedulerSource, /const SCHEDULED_BATCH_SIZE = 5/);
  assert.match(schedulerSource, /const SCHEDULED_CONCURRENCY = 2/);
  assert.match(schedulerSource, /const SCHEDULED_DEADLINE_MS = 45_000/);
  assert.match(schedulerSource, /buildIntegrationWorkerId\("scheduled-outbox"/);
  assert.match(schedulerSource, /dispatchBookingIntegrationJobs\(/);
  assert.match(schedulerSource, /mapWithConcurrencyAndDeadline\(/);
  assert.doesNotMatch(schedulerSource, /payload/);
  assert.doesNotMatch(schedulerSource, /console\.(log|warn|error)\([^\n]*organizationId/);
});

test("cron route fails closed and uses only a configured rollout watermark", () => {
  assert.match(routeSource, /if \(!secret\)[\s\S]*status: 503/);
  assert.match(routeSource, /authorization[\s\S]*`Bearer \$\{secret\}`[\s\S]*status: 401/);
  assert.match(routeSource, /INTEGRATION_OUTBOX_DISPATCH_ENABLED/);
  assert.match(routeSource, /integrationOutboxDispatchEnabled/);
  assert.match(routeSource, /INTEGRATION_OUTBOX_DISPATCH_NOT_BEFORE/);
  assert.match(routeSource, /parseDispatchWatermark/);
  assert.doesNotMatch(routeSource, /const dispatchNotBefore = new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(routeSource, /searchParams/);
  assert.match(routeSource, /runScheduledIntegrationOutbox\(\{ dispatchNotBefore \}\)/);
  assert.doesNotMatch(routeSource, /err instanceof Error \? err\.message/);
});

test("a second daily cron stays inside documented Hobby plan limits", () => {
  assert.deepEqual(vercelConfig.crons, [
    { path: "/api/cron/reminders", schedule: "0 21 * * *" },
    { path: "/api/cron/integration-outbox", schedule: "5 21 * * *" },
  ]);
});

test("rollout documentation is fail-closed and migration-first", () => {
  assert.match(outboxDocsSource, /INTEGRATION_OUTBOX_DISPATCH_NOT_BEFORE/);
  assert.match(outboxDocsSource, /timeout[\s\S]*lease[\s\S]*ambiguous/i);
  assert.match(
    outboxDocsSource,
    /apply and verify migration `20260719124500`[\s\S]*deploy the compatible application[\s\S]*enable scheduled dispatch/i,
  );
  assert.match(
    readmeSource,
    /apply and verify migration `20260719124500`[\s\S]*deploy the compatible application/i,
  );
});
