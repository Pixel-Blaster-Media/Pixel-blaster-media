import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildIntegrationWorkerId,
  INTEGRATION_JOB_PHASES,
  ProviderMutationTimeoutError,
  runIntegrationDispatchSequence,
  withProviderMutationTimeout,
} from "../lib/integrations/dispatcher-core.ts";

const publicBookingSource = readFileSync(
  new URL("../app/book/actions.ts", import.meta.url),
  "utf8",
);
const dispatcherSource = readFileSync(
  new URL("../lib/integrations/dispatcher.ts", import.meta.url),
  "utf8",
);
const jobsSource = readFileSync(
  new URL("../lib/integrations/jobs.ts", import.meta.url),
  "utf8",
);
const emailSource = readFileSync(
  new URL("../lib/email/resend.ts", import.meta.url),
  "utf8",
);
const quickBooksInvoiceSource = readFileSync(
  new URL("../lib/integrations/quickbooks/invoice.ts", import.meta.url),
  "utf8",
);
const pushSource = readFileSync(
  new URL("../lib/notifications/push.ts", import.meta.url),
  "utf8",
);

test("dispatcher preserves invoice, calendar, then parallel notification phases", async () => {
  assert.deepEqual(INTEGRATION_JOB_PHASES, [
    ["quickbooks.invoice.create"],
    ["google_calendar.event.create"],
    [
      "email.booking.confirmation",
      "email.admin.new_booking",
      "push.admin.new_booking",
    ],
  ]);

  const events = [];
  const results = await runIntegrationDispatchSequence(async (jobType) => {
    events.push(`start:${jobType}`);
    if (jobType.startsWith("email.") || jobType.startsWith("push.")) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    events.push(`end:${jobType}`);
    return { jobType, outcome: "completed" };
  });

  assert.equal(results.length, 5);
  assert.deepEqual(events.slice(0, 4), [
    "start:quickbooks.invoice.create",
    "end:quickbooks.invoice.create",
    "start:google_calendar.event.create",
    "end:google_calendar.event.create",
  ]);
  const notificationStarts = events.slice(4, 7);
  assert.deepEqual(new Set(notificationStarts), new Set([
    "start:email.booking.confirmation",
    "start:email.admin.new_booking",
    "start:push.admin.new_booking",
  ]));
});

test("dispatcher can target one safe manual job without widening scope", async () => {
  const seen = [];
  await runIntegrationDispatchSequence(
    async (jobType) => {
      seen.push(jobType);
      return { jobType, outcome: "completed" };
    },
    ["email.admin.new_booking"],
  );
  assert.deepEqual(seen, ["email.admin.new_booking"]);
});

test("worker identifiers are explicit, bounded, and reject unsafe run ids", () => {
  const runId = "70000000-0000-4000-8000-000000000001";
  assert.equal(
    buildIntegrationWorkerId("scheduled-outbox", runId),
    `scheduled-outbox:${runId}`,
  );
  assert.ok(buildIntegrationWorkerId("inline-public-booking", runId).length <= 96);
  assert.throws(
    () => buildIntegrationWorkerId("scheduled-outbox", "../../unbounded worker"),
    /valid UUID/,
  );
});

test("provider mutations reject on a bounded timeout", async () => {
  await assert.rejects(
    withProviderMutationTimeout(
      new Promise(() => {}),
      5,
      "quickbooks.invoice.create",
    ),
    ProviderMutationTimeoutError,
  );
});

test("provider timeouts preserve lease evidence and settlement calls are bounded", () => {
  assert.match(dispatcherSource, /ProviderMutationTimeoutError/);
  assert.match(dispatcherSource, /outcome:\s*"provider_timeout_pending"/);
  assert.match(dispatcherSource, /withProviderMutationTimeout\(\s*finishIntegrationJob\(/);
  const timeoutBranches = dispatcherSource.match(
    /if \(error instanceof ProviderMutationTimeoutError\) \{\s*return \{ jobType, outcome: "provider_timeout_pending" \};\s*\}/g,
  ) ?? [];
  assert.equal(timeoutBranches.length, 4);
});

test("claim and settlement failures remain distinct from not-claimable work", () => {
  assert.match(jobsSource, /outcome:\s*"not_claimable"/);
  assert.match(jobsSource, /outcome:\s*"claim_failed"/);
  assert.match(dispatcherSource, /outcome:\s*"settlement_failed"/);
  assert.match(dispatcherSource, /claim\.payload/);
  assert.doesNotMatch(dispatcherSource, /\.from\("booking_line_items"\)/);
  assert.doesNotMatch(dispatcherSource, /\.from\("profiles"\)/);
});

test("scheduled provider helpers never log recipients or raw provider errors", () => {
  assert.doesNotMatch(emailSource, /console\.(warn|error)\([^\n]*args\.to/);
  assert.doesNotMatch(emailSource, /console\.error\([^\n]*body/);
  assert.doesNotMatch(emailSource, /console\.error\([^\n]*err\)/);
  assert.doesNotMatch(quickBooksInvoiceSource, /err\.body\.slice/);
  assert.doesNotMatch(
    quickBooksInvoiceSource,
    /console\.warn\([^\n]*customer lookup[^\n]*err/,
  );
  assert.doesNotMatch(pushSource, /console\.(warn|error)\([^\n]*safeErrorMessage/);
  assert.doesNotMatch(pushSource, /message:\s*safeErrorMessage/);
});

test("public booking delegates all provider work to the shared dispatcher", () => {
  assert.match(publicBookingSource, /dispatchBookingIntegrationJobs\(/);
  assert.doesNotMatch(publicBookingSource, /createInvoiceForBooking\(/);
  assert.doesNotMatch(publicBookingSource, /getGoogleCalendarClient\(/);
  assert.doesNotMatch(publicBookingSource, /sendPushBestEffort\(/);
});
